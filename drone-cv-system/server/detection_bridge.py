"""
Detection bridge — three-tier inference hierarchy for the simulation server.

Priority order:
  1. CoralBridge  — Google Coral USB TPU (pycoral + _edgetpu.tflite model)
  2. OnnxDetector — YOLOv8n ONNX Runtime CPU (~8-12 FPS at 640×640)
  3. MockDetector — physics-based projection model (always available)

All paths return the same JSON-serialisable dict format:
  [{ 'id': str, 'confidence': float, 'cls': str, 'bbox': [x1,y1,x2,y2] }]

The 'mode' field returned by DetectionBridge.detect() reflects which path ran:
  'coral', 'onnx', or 'mock'
"""

from __future__ import annotations
import math
import time
import os
import logging
from typing import Any

logger = logging.getLogger(__name__)

IMG_SIZE = 640
FX = FY = IMG_SIZE / 2
CX = CY = IMG_SIZE / 2

# Sensor model constants (mirrors TypeScript sensorInterpolation.ts data)
# strength / quality at representative altitudes (from raw_opticalflow_data.csv)
_SENSOR_TABLE = [
    (0,   255, 10),
    (12,  240, 40),
    (24,  220, 75),
    (36,  200, 95),
    (48,  180, 110),
    (60,  160, 120),
    (72,  140, 130),
    (84,  120, 140),
    (96,  105, 145),
    (108, 95,  148),
    (120, 85,  150),
    (132, 75,  148),
    (144, 65,  145),
    (156, 55,  140),
    (168, 50,  135),
    (180, 45,  130),
    (192, 40,  120),
    (204, 35,  110),
    (216, 30,  100),
    (228, 28,  90),
    (240, 25,  80),
    (252, 22,  70),
    (264, 20,  60),
    (276, 18,  50),
    (315, 10,  20),
]


def _sensor_at_dist_in(dist_in: float) -> tuple[float, float]:
    """Interpolate strength and quality from distance in inches."""
    clamped = max(0, min(315, dist_in))
    for i in range(len(_SENSOR_TABLE) - 1):
        d0, s0, q0 = _SENSOR_TABLE[i]
        d1, s1, q1 = _SENSOR_TABLE[i + 1]
        if d0 <= clamped <= d1:
            if d1 == d0:
                return float(s0), float(q0)
            t = (clamped - d0) / (d1 - d0)
            st = t * t * (3 - 2 * t)
            return s0 + (s1 - s0) * st, q0 + (q1 - q0) * st
    d, s, q = _SENSOR_TABLE[-1]
    return float(s), float(q)


def _project_flower(flower: dict[str, Any], drone: dict[str, Any]) -> dict[str, Any] | None:
    import math
    alt = max(0.1, drone['z'])
    rel_x = flower['x'] - drone['x']
    rel_y = flower['y'] - drone['y']

    yaw_rad = math.radians(drone.get('yaw', 0))
    cam_x = rel_x * math.cos(yaw_rad) + rel_y * math.sin(yaw_rad)
    cam_y = -rel_x * math.sin(yaw_rad) + rel_y * math.cos(yaw_rad)

    u = FX * cam_x / alt + CX
    v = FY * cam_y / alt + CY
    r = max(3, flower['radius'] / alt * FX)

    if u < -r or u > IMG_SIZE + r or v < -r or v > IMG_SIZE + r:
        return None

    return {'u': u, 'v': v, 'radius': r}


class MockDetector:
    """Physics-based detection model — no ML required."""

    def detect(self, drone: dict[str, Any],
               flowers: list[dict[str, Any]]) -> list[dict[str, Any]]:
        alt = max(0.1, drone.get('z', 1.0))
        dist_in = alt * 39.37
        strength, quality = _sensor_at_dist_in(dist_in)
        stability = min(1.0, quality / 150.0)
        norm_strength = strength / 255.0

        detections = []
        for flower in flowers:
            proj = _project_flower(flower, drone)
            if proj is None:
                continue

            # Base confidence from horizontal proximity and sensor model
            hdist = math.hypot(flower['x'] - drone['x'], flower['y'] - drone['y'])
            base = max(0.0, 1.0 - hdist / (alt * 1.8))  # falls off with distance
            conf = base * (0.6 + 0.4 * stability) * (0.6 + 0.4 * norm_strength)

            if conf < 0.12:
                continue

            r = proj['radius']
            u, v = proj['u'], proj['v']
            detections.append({
                'id': flower['id'],
                'confidence': round(float(conf), 3),
                'cls': 'flower_open',
                'bbox': [
                    max(0, int(u - r)),
                    max(0, int(v - r)),
                    min(IMG_SIZE, int(u + r)),
                    min(IMG_SIZE, int(v + r)),
                ],
            })

        return sorted(detections, key=lambda d: -d['confidence'])


class OnnxDetector:
    """YOLOv8-compatible ONNX detector with confidence-threshold filtering."""

    def __init__(self, model_path: str):
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.inter_op_num_threads = 2
        opts.intra_op_num_threads = 2
        self.session = ort.InferenceSession(model_path, opts)
        self.input_name = self.session.get_inputs()[0].name
        logger.info(f'ONNX model loaded: {model_path}')

    def detect(self, frame_arr: 'Any',
               flowers: list[dict[str, Any]],
               drone: dict[str, Any]) -> list[dict[str, Any]]:
        import numpy as np

        # Convert HWC float32 → NCHW float32
        img = np.transpose(frame_arr, (2, 0, 1))[np.newaxis]  # [1,3,640,640]
        raw = self.session.run(None, {self.input_name: img})[0]  # [1,84,8400]

        # YOLOv8 format: [cx,cy,w,h, cls_scores×80]
        preds = raw[0].T  # [8400,84]
        scores = preds[:, 4:]
        best_cls = scores.argmax(axis=1)
        best_conf = scores.max(axis=1)
        mask = best_conf > 0.20
        if not mask.any():
            return []

        boxes_xywh = preds[mask, :4]
        confs = best_conf[mask]
        x1 = np.clip(boxes_xywh[:, 0] - boxes_xywh[:, 2] / 2, 0, IMG_SIZE)
        y1 = np.clip(boxes_xywh[:, 1] - boxes_xywh[:, 3] / 2, 0, IMG_SIZE)
        x2 = np.clip(boxes_xywh[:, 0] + boxes_xywh[:, 2] / 2, 0, IMG_SIZE)
        y2 = np.clip(boxes_xywh[:, 1] + boxes_xywh[:, 3] / 2, 0, IMG_SIZE)

        # Match each ONNX box to the nearest projected flower
        detections = []
        matched: set[str] = set()
        for i in range(len(x1)):
            box_cx = (x1[i] + x2[i]) / 2
            box_cy = (y1[i] + y2[i]) / 2
            best_fid, best_dist = None, 999
            for fl in flowers:
                proj = _project_flower(fl, drone)
                if proj is None:
                    continue
                d = math.hypot(box_cx - proj['u'], box_cy - proj['v'])
                if d < best_dist and d < proj['radius'] * 2.5:
                    best_dist, best_fid = d, fl['id']
            if best_fid and best_fid not in matched:
                matched.add(best_fid)
                detections.append({
                    'id': best_fid,
                    'confidence': round(float(confs[i]), 3),
                    'cls': 'flower_open',
                    'bbox': [int(x1[i]), int(y1[i]), int(x2[i]), int(y2[i])],
                })

        return sorted(detections, key=lambda d: -d['confidence'])


class CoralBridge:
    """
    Coral USB TPU inference path for the simulation server.
    Wraps the CoralDetector (pycoral) and matches detected boxes to garden
    flowers using the same projection used by OnnxDetector.

    Only active when:
      - A *_edgetpu.tflite model file is found
      - pycoral is installed
      - A physical Coral USB TPU is connected (or Coral PCIe on desktop)
    """

    def __init__(self, model_path: str):
        self._detector = None
        self._available = False

        try:
            import sys, os
            # Add parent dir so coral_detector is importable from server context
            parent = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            if parent not in sys.path:
                sys.path.insert(0, parent)
            from cv.coral_detector import CoralDetector
            det = CoralDetector(model_path, conf_threshold=0.30)
            if det.available:
                self._detector = det
                self._available = True
                logger.info(f'CoralBridge ready: {model_path}')
            else:
                logger.warning('CoralDetector loaded but Coral TPU not detected')
        except Exception as e:
            logger.warning(f'CoralBridge init failed ({e})')

    @property
    def available(self) -> bool:
        return self._available

    def detect(
        self,
        frame_arr: 'Any',           # float32 HWC [640,640,3] from scene_renderer
        flowers: list[dict[str, Any]],
        drone: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], float]:
        """
        Run Coral TPU inference and match detections to garden flowers.
        Returns (detections_list, elapsed_ms).
        """
        import numpy as np
        # scene_renderer gives float32 [0,1] — convert to uint8 for Coral
        if frame_arr.dtype != np.uint8:
            frame_u8 = (np.clip(frame_arr, 0.0, 1.0) * 255).astype(np.uint8)
        else:
            frame_u8 = frame_arr

        coral_dets, elapsed_ms = self._detector.detect(frame_u8)

        # Match Coral boxes to projected garden flowers (same as OnnxDetector)
        coral_input_h = self._detector._input_details[0]['shape'][1]
        coral_input_w = self._detector._input_details[0]['shape'][2]

        detections = []
        matched: set[str] = set()
        for d in coral_dets:
            # Scale bbox from Coral input resolution to IMG_SIZE (640)
            scale_x = IMG_SIZE / coral_input_w
            scale_y = IMG_SIZE / coral_input_h
            box_cx = (d.x1 + d.x2) / 2 * scale_x
            box_cy = (d.y1 + d.y2) / 2 * scale_y
            x1 = d.x1 * scale_x
            y1 = d.y1 * scale_y
            x2 = d.x2 * scale_x
            y2 = d.y2 * scale_y

            best_fid, best_dist = None, 999
            for fl in flowers:
                proj = _project_flower(fl, drone)
                if proj is None:
                    continue
                dist = math.hypot(box_cx - proj['u'], box_cy - proj['v'])
                if dist < best_dist and dist < proj['radius'] * 2.5:
                    best_dist, best_fid = dist, fl['id']

            if best_fid and best_fid not in matched:
                matched.add(best_fid)
                detections.append({
                    'id': best_fid,
                    'confidence': round(float(d.confidence), 3),
                    'cls': d.class_name,
                    'bbox': [int(x1), int(y1), int(x2), int(y2)],
                })

        return sorted(detections, key=lambda d: -d['confidence']), elapsed_ms


class DetectionBridge:
    """
    Unified detection interface — three-tier hierarchy:
      1. CoralBridge  (Google Coral USB TPU, fastest)
      2. OnnxDetector (YOLOv8n ONNX CPU, fallback)
      3. MockDetector (physics model, always available)
    """

    TIMEOUT_S = 2.0

    def __init__(self, model_path: str | None = None, coral_path: str | None = None):
        self.mock = MockDetector()
        self.onnx: OnnxDetector | None = None
        self.coral: CoralBridge | None = None
        self._mode = 'mock'

        # Try Coral TPU first
        if coral_path and os.path.exists(coral_path):
            bridge = CoralBridge(coral_path)
            if bridge.available:
                self.coral = bridge
                self._mode = 'coral'

        # ONNX fallback if no Coral
        if self.coral is None and model_path and os.path.exists(model_path):
            try:
                self.onnx = OnnxDetector(model_path)
                self._mode = 'onnx'
            except Exception as e:
                logger.warning(f'ONNX load failed ({e}), using mock detector')

    @property
    def mode(self) -> str:
        return self._mode

    def detect(
        self,
        frame_arr: 'Any',
        drone: dict[str, Any],
        flowers: list[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], str, float]:
        """
        Returns (detections, mode_used, elapsed_ms).
        Tries coral → onnx → mock in order; always returns a result.
        """
        t0 = time.perf_counter()

        # --- Coral TPU path ---
        if self.coral is not None:
            try:
                dets, elapsed = self.coral.detect(frame_arr, flowers, drone)
                if (time.perf_counter() - t0) > self.TIMEOUT_S:
                    raise TimeoutError(f'Coral took {elapsed:.0f}ms')
                return dets, 'coral', elapsed
            except Exception as e:
                logger.warning(f'Coral inference failed ({e}), falling back to ONNX/mock')
                self.coral = None
                self._mode = 'onnx' if self.onnx else 'mock'

        # --- ONNX path ---
        if self.onnx is not None:
            try:
                dets = self.onnx.detect(frame_arr, flowers, drone)
                elapsed = (time.perf_counter() - t0) * 1000
                if elapsed > self.TIMEOUT_S * 1000:
                    raise TimeoutError(f'ONNX took {elapsed:.0f}ms')
                return dets, 'onnx', elapsed
            except Exception as e:
                logger.warning(f'ONNX inference failed ({e}), falling back to mock')
                self._mode = 'mock'
                self.onnx = None

        # --- Mock fallback (always available) ---
        dets = self.mock.detect(drone, flowers)
        elapsed = (time.perf_counter() - t0) * 1000
        return dets, 'mock', elapsed
