"""
Flower Detector
---------------
Detects flowers from camera frames using a three-tier inference backend:

  1. Google Coral USB TPU (primary — fastest, ~15-30 FPS on RPi)
       Requires flower_detector_edgetpu.tflite (EdgeTPU-compiled model)
       and pycoral / libedgetpu1-std installed on the Raspberry Pi.

  2. ONNX Runtime CPU (fallback — slower, ~8-12 FPS at 640×640 on RPi)
       YOLOv8n exported to ONNX. Used when Coral is unavailable.

  3. PyTorch / Ultralytics (last resort — slowest, requires torch installed)

Returns structured Detection objects with bounding boxes, class, confidence,
and a camera-space bearing vector to the flower center.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import cv2
import numpy as np
import yaml
from loguru import logger


@dataclass
class Detection:
    """A single flower detection from one inference pass."""

    # Bounding box in pixel coordinates (full-res frame)
    x1: float
    y1: float
    x2: float
    y2: float

    confidence: float       # 0.0 – 1.0
    class_id: int
    class_name: str

    # Derived fields
    cx: float = field(init=False)   # Center x (pixels)
    cy: float = field(init=False)   # Center y (pixels)
    width: float = field(init=False)
    height: float = field(init=False)

    # Camera-space unit vector pointing from camera toward flower
    bearing: Optional[np.ndarray] = field(default=None, repr=False)

    # Estimated distance (meters) — filled by DepthEstimator
    estimated_distance_m: Optional[float] = None

    def __post_init__(self):
        self.cx = (self.x1 + self.x2) / 2
        self.cy = (self.y1 + self.y2) / 2
        self.width = self.x2 - self.x1
        self.height = self.y2 - self.y1

    @property
    def area(self) -> float:
        return self.width * self.height

    @property
    def is_open_flower(self) -> bool:
        return self.class_name == "flower_open"

    def to_dict(self) -> dict:
        return {
            "bbox": [self.x1, self.y1, self.x2, self.y2],
            "center": [self.cx, self.cy],
            "confidence": self.confidence,
            "class": self.class_name,
            "distance_m": self.estimated_distance_m,
        }


class FlowerDetector:
    """
    Wraps YOLOv8 inference with support for both PyTorch (.pt) and ONNX (.onnx)
    backends. ONNX is strongly preferred on Raspberry Pi for 2-3x speedup.

    Usage:
        detector = FlowerDetector("config/model_config.yaml", "config/camera_config.yaml")
        detections = detector.detect(inference_rgb_frame)
    """

    def __init__(
        self,
        model_config: str = "config/model_config.yaml",
        camera_config: str = "config/camera_config.yaml",
    ):
        with open(model_config) as f:
            mcfg = yaml.safe_load(f)["model"]
        with open(camera_config) as f:
            ccfg = yaml.safe_load(f)

        self.conf_threshold = ccfg["inference"]["conf_threshold"]
        self.iou_threshold = ccfg["inference"]["iou_threshold"]
        self.max_det = ccfg["inference"]["max_detections"]
        self.input_size = tuple(ccfg["inference"]["input_size"])   # (w, h)
        self.classes: dict[int, str] = {int(k): v for k, v in mcfg["classes"].items()}
        self.use_onnx = mcfg["use_onnx"]

        # Camera intrinsics for bearing computation
        intr = ccfg["camera"]["intrinsic_matrix"]
        self.fx = intr["fx"]
        self.fy = intr["fy"]
        self.cx_px = intr["cx"]
        self.cy_px = intr["cy"]

        self._model = None
        self._ort_session = None
        self._coral = None
        self._backend = 'none'

        # Try Coral TPU first (fastest on RPi with Google Coral USB Accelerator)
        coral_path = mcfg.get("coral_path", "")
        if coral_path:
            self._load_coral(coral_path)

        # Fall back to ONNX if Coral unavailable
        if self._coral is None:
            if self.use_onnx:
                self._load_onnx(mcfg["onnx_path"])
            else:
                self._load_pytorch(mcfg["weights_path"])

        logger.info(f"FlowerDetector ready — backend={self._backend}")

    # ------------------------------------------------------------------
    # Model Loading
    # ------------------------------------------------------------------

    def _load_coral(self, coral_path: str):
        try:
            from cv.coral_detector import CoralDetector
            detector = CoralDetector(coral_path, conf_threshold=self.conf_threshold)
            if detector.available:
                self._coral = detector
                self._backend = 'coral'
                logger.info(f"Coral TPU detector ready: {coral_path}")
            else:
                logger.warning("Coral model loaded but TPU not available — falling back to ONNX")
        except Exception as e:
            logger.warning(f"Coral load failed ({e}) — falling back to ONNX")

    def _load_pytorch(self, weights_path: str):
        try:
            from ultralytics import YOLO
            self._model = YOLO(weights_path)
            self._backend = 'pytorch'
            logger.info(f"Loaded PyTorch model: {weights_path}")
        except Exception as e:
            logger.error(f"Failed to load PyTorch model: {e}")
            raise

    def _load_onnx(self, onnx_path: str):
        try:
            import onnxruntime as ort
            # Use CPU provider — RPi has no GPU
            self._ort_session = ort.InferenceSession(
                onnx_path,
                providers=["CPUExecutionProvider"],
            )
            self._onnx_input_name = self._ort_session.get_inputs()[0].name
            self._backend = 'onnx'
            logger.info(f"Loaded ONNX model: {onnx_path}")
        except Exception as e:
            logger.warning(f"ONNX load failed ({e}), falling back to PyTorch")
            self.use_onnx = False
            pt_path = onnx_path.replace(".onnx", ".pt")
            self._load_pytorch(pt_path)

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------

    def detect(self, frame_rgb: np.ndarray) -> List[Detection]:
        """
        Run detection on an RGB frame (already resized to inference_size).

        Args:
            frame_rgb: numpy array of shape (H, W, 3), dtype uint8, RGB color order

        Returns:
            List of Detection objects sorted by confidence descending.
        """
        t0 = time.perf_counter()

        # Coral TPU path (primary — fastest on RPi with Coral USB accelerator)
        if self._coral is not None:
            coral_dets, _ = self._coral.detect(frame_rgb)
            detections = [
                Detection(
                    x1=d.x1, y1=d.y1, x2=d.x2, y2=d.y2,
                    confidence=d.confidence,
                    class_id=d.class_id,
                    class_name=d.class_name,
                )
                for d in coral_dets
                if d.confidence >= self.conf_threshold
            ]
        elif self.use_onnx and self._ort_session is not None:
            raw_detections = self._infer_onnx(frame_rgb)
            detections = self._parse_detections(raw_detections, frame_rgb.shape)
        else:
            raw_detections = self._infer_pytorch(frame_rgb)
            detections = self._parse_detections(raw_detections, frame_rgb.shape)

        for det in detections:
            det.bearing = self._compute_bearing(det.cx, det.cy)

        elapsed_ms = (time.perf_counter() - t0) * 1000
        logger.debug(f"Inference: {len(detections)} detections in {elapsed_ms:.1f}ms")

        return sorted(detections, key=lambda d: d.confidence, reverse=True)

    def _infer_pytorch(self, frame_rgb: np.ndarray) -> list:
        results = self._model(
            frame_rgb,
            conf=self.conf_threshold,
            iou=self.iou_threshold,
            max_det=self.max_det,
            verbose=False,
        )
        return results[0].boxes.data.cpu().numpy() if results[0].boxes else []

    def _infer_onnx(self, frame_rgb: np.ndarray) -> np.ndarray:
        """
        ONNX inference follows the YOLOv8 export format:
        Input: float32 NCHW [1, 3, H, W] normalized to [0, 1]
        Output: float32 [1, 84, 8400] for COCO-like models
                        where 84 = 4 box coords + 80 classes
                        (our model will have 4 box coords + num_classes)
        """
        # Normalize and convert HWC -> NCHW
        img = frame_rgb.astype(np.float32) / 255.0
        img = np.transpose(img, (2, 0, 1))          # HWC -> CHW
        img = np.expand_dims(img, axis=0)            # CHW -> NCHW

        outputs = self._ort_session.run(None, {self._onnx_input_name: img})
        return self._nms_onnx_output(outputs[0])

    def _nms_onnx_output(self, output: np.ndarray) -> np.ndarray:
        """
        Parse YOLOv8 ONNX output and apply NMS.
        output shape: [1, 4+num_classes, num_anchors]
        Returns array of [x1, y1, x2, y2, conf, class_id] rows.
        """
        output = output[0].T   # [num_anchors, 4+num_classes]
        num_classes = output.shape[1] - 4

        boxes_xywh = output[:, :4]
        class_scores = output[:, 4:]

        class_ids = np.argmax(class_scores, axis=1)
        confidences = class_scores[np.arange(len(class_scores)), class_ids]

        # Filter by confidence
        mask = confidences >= self.conf_threshold
        boxes_xywh = boxes_xywh[mask]
        confidences = confidences[mask]
        class_ids = class_ids[mask]

        if len(boxes_xywh) == 0:
            return np.empty((0, 6))

        # xywh -> xyxy
        boxes_xyxy = np.empty_like(boxes_xywh)
        boxes_xyxy[:, 0] = boxes_xywh[:, 0] - boxes_xywh[:, 2] / 2
        boxes_xyxy[:, 1] = boxes_xywh[:, 1] - boxes_xywh[:, 3] / 2
        boxes_xyxy[:, 2] = boxes_xywh[:, 0] + boxes_xywh[:, 2] / 2
        boxes_xyxy[:, 3] = boxes_xywh[:, 1] + boxes_xywh[:, 3] / 2

        # OpenCV NMS
        indices = cv2.dnn.NMSBoxes(
            boxes_xyxy.tolist(),
            confidences.tolist(),
            self.conf_threshold,
            self.iou_threshold,
        )

        if len(indices) == 0:
            return np.empty((0, 6))

        indices = indices.flatten()
        results = np.column_stack([
            boxes_xyxy[indices],
            confidences[indices],
            class_ids[indices].astype(float),
        ])
        return results

    def _parse_detections(self, raw: np.ndarray, frame_shape: tuple) -> List[Detection]:
        if len(raw) == 0:
            return []

        detections = []
        h, w = frame_shape[:2]
        # raw columns: [x1, y1, x2, y2, confidence, class_id]
        for row in raw:
            x1, y1, x2, y2, conf, cls_id = (
                float(row[0]), float(row[1]), float(row[2]),
                float(row[3]), float(row[4]), int(row[5])
            )

            # Clamp to frame bounds
            x1 = max(0.0, min(x1, w - 1))
            y1 = max(0.0, min(y1, h - 1))
            x2 = max(0.0, min(x2, w - 1))
            y2 = max(0.0, min(y2, h - 1))

            class_name = self.classes.get(cls_id, f"class_{cls_id}")
            detections.append(Detection(
                x1=x1, y1=y1, x2=x2, y2=y2,
                confidence=conf,
                class_id=cls_id,
                class_name=class_name,
            ))

        return detections

    def _compute_bearing(self, px: float, py: float) -> np.ndarray:
        """
        Back-project pixel center to a unit direction vector in camera space.
        Camera frame: Z points down (toward ground), X right, Y forward.
        """
        ray = np.array([
            (px - self.cx_px) / self.fx,
            (py - self.cy_px) / self.fy,
            1.0,
        ])
        return ray / np.linalg.norm(ray)

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    def best_target(self, detections: List[Detection]) -> Optional[Detection]:
        """
        Select the highest-priority target from a list of detections.
        Priority: open flowers > clusters > closed flowers.
        Within same class, prefer largest detection (closest to drone).
        """
        priority = {"flower_open": 0, "flower_cluster": 1, "flower_closed": 2}
        candidates = [d for d in detections if d.confidence >= self.conf_threshold]
        if not candidates:
            return None
        return min(candidates, key=lambda d: (priority.get(d.class_name, 9), -d.area))

    def draw_detections(
        self, frame_bgr: np.ndarray, detections: List[Detection]
    ) -> np.ndarray:
        """Draw bounding boxes on frame for debugging/display."""
        colors = {
            "flower_open":    (0, 255, 100),
            "flower_closed":  (0, 100, 255),
            "flower_cluster": (255, 200, 0),
        }
        out = frame_bgr.copy()
        for det in detections:
            color = colors.get(det.class_name, (200, 200, 200))
            cv2.rectangle(out, (int(det.x1), int(det.y1)), (int(det.x2), int(det.y2)), color, 2)
            label = f"{det.class_name} {det.confidence:.2f}"
            if det.estimated_distance_m is not None:
                label += f" {det.estimated_distance_m:.2f}m"
            cv2.putText(out, label, (int(det.x1), int(det.y1) - 6),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
        return out
