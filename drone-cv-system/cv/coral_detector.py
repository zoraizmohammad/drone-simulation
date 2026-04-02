"""
Google Coral USB TPU — Flower Detector
---------------------------------------
Runs an EdgeTPU-compiled TFLite model on the Google Coral USB Accelerator
attached to the Raspberry Pi via USB 3.0.

Hardware:
  Google Coral USB Edge TPU connected to Raspberry Pi USB port.
  The Coral provides ~4 TOPS (INT8) inference, achieving ~15–30 FPS on a
  MobileNet-sized model (320×320 or 640×640 depending on architecture).

Model requirements:
  The model MUST be compiled with the Edge TPU compiler:
    edgetpu_compiler flower_detector.tflite
  Output: flower_detector_edgetpu.tflite  (~fine-tuned MobileNet-SSD or
          YOLOv5n converted to TFLite INT8 + EdgeTPU delegate)

  Input tensor:  [1, 320, 320, 3] uint8  (NHWC — NOT NCHW)
  Output tensors (SSD MobileNet style):
    [0]: [1, N, 4]  — bounding boxes [ymin, xmin, ymax, xmax] normalized 0-1
    [1]: [1, N]     — class indices (0-based)
    [2]: [1, N]     — confidence scores 0.0-1.0
    [3]: [1]        — number of valid detections

Install (Raspberry Pi):
  # Add Coral apt repo
  echo "deb https://packages.cloud.google.com/apt coral-edgetpu-stable main" | \\
      sudo tee /etc/apt/sources.list.d/coral-edgetpu.list
  curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo apt-key add -
  sudo apt update && sudo apt install libedgetpu1-std

  pip install pycoral tflite-runtime
  # or: pip install pycoral --extra-index-url https://google-coral.github.io/py-packages/

Classes (must match training labels):
  0: flower_open     — fully open, visible pistil/stamens
  1: flower_closed   — budded or partially open
  2: flower_cluster  — dense group of flowers
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import List, Optional, Tuple

import numpy as np
from loguru import logger


# Class names matching the trained model labels
CLASSES = {0: "flower_open", 1: "flower_closed", 2: "flower_cluster"}

# Input size expected by the EdgeTPU-compiled model
CORAL_INPUT_SIZE = (320, 320)   # (width, height) — resize to this before inference


@dataclass
class CoralDetection:
    """Single flower detection from Coral TPU inference."""
    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float
    class_id: int
    class_name: str

    @property
    def cx(self) -> float:
        return (self.x1 + self.x2) / 2

    @property
    def cy(self) -> float:
        return (self.y1 + self.y2) / 2

    @property
    def area(self) -> float:
        return (self.x2 - self.x1) * (self.y2 - self.y1)


class CoralDetector:
    """
    Flower detector using Google Coral USB Edge TPU.

    Requires:
      - pycoral package installed
      - libedgetpu1-std installed (Coral USB runtime)
      - EdgeTPU-compiled TFLite model (_edgetpu.tflite)

    Falls back gracefully when Coral hardware or pycoral is unavailable,
    returning an empty detection list so the caller can try ONNX instead.

    Usage:
        detector = CoralDetector("models/flower_detector_edgetpu.tflite")
        if detector.available:
            detections = detector.detect(frame_rgb_320x320)
    """

    def __init__(
        self,
        model_path: str,
        conf_threshold: float = 0.35,
    ):
        self.model_path = model_path
        self.conf_threshold = conf_threshold
        self._interpreter = None
        self._input_details = None
        self._output_details = None
        self.available = False

        self._load_model()

    def _load_model(self) -> None:
        """
        Attempt to load the EdgeTPU-compiled TFLite model onto the Coral USB TPU.
        Sets self.available = True on success.
        """
        try:
            from pycoral.utils.edgetpu import make_interpreter
            from pycoral.adapters import common as coral_common

            self._interpreter = make_interpreter(self.model_path)
            self._interpreter.allocate_tensors()
            self._input_details  = self._interpreter.get_input_details()
            self._output_details = self._interpreter.get_output_details()

            # Verify input shape matches expectations
            input_shape = self._input_details[0]['shape']  # [1, H, W, 3]
            logger.info(
                f"Coral TPU model loaded: {self.model_path} "
                f"input={input_shape} dtype={self._input_details[0]['dtype'].__name__}"
            )
            self.available = True

        except ImportError:
            logger.warning(
                "pycoral not installed — Coral TPU path unavailable. "
                "Install with: pip install pycoral"
            )
        except ValueError as e:
            logger.warning(f"Coral model load failed (no EdgeTPU delegate?): {e}")
        except Exception as e:
            logger.warning(f"Coral TPU init failed: {e}")

    def preprocess(self, frame_rgb: np.ndarray) -> np.ndarray:
        """
        Resize and cast frame to uint8 NHWC [1, H, W, 3] for Coral inference.
        The Coral requires uint8 input (quantized INT8 model) — NOT float32.

        Args:
            frame_rgb: numpy array (H, W, 3) uint8, any resolution, RGB order.

        Returns:
            numpy array [1, input_H, input_W, 3] uint8 ready for set_tensor().
        """
        import cv2
        target_h = self._input_details[0]['shape'][1]
        target_w = self._input_details[0]['shape'][2]
        resized = cv2.resize(frame_rgb, (target_w, target_h), interpolation=cv2.INTER_LINEAR)
        return np.expand_dims(resized, axis=0)   # [1, H, W, 3] uint8

    def detect(self, frame_rgb: np.ndarray) -> Tuple[List[CoralDetection], float]:
        """
        Run inference on a uint8 RGB frame using the Coral USB TPU.

        Args:
            frame_rgb: (H, W, 3) uint8 RGB frame at any resolution.
                       Will be resized internally to model input size.

        Returns:
            (detections, elapsed_ms) where detections are sorted by confidence desc.
            Returns ([], 0.0) if Coral is not available.
        """
        if not self.available or self._interpreter is None:
            return [], 0.0

        t0 = time.perf_counter()

        # Preprocess: resize + expand dims → [1, H, W, 3] uint8
        tensor = self.preprocess(frame_rgb)
        self._interpreter.set_tensor(self._input_details[0]['index'], tensor)

        # Run inference on Coral TPU
        self._interpreter.invoke()

        # Retrieve SSD output tensors
        # Output 0: boxes [1, N, 4] — [ymin, xmin, ymax, xmax] in [0,1]
        # Output 1: class indices [1, N]
        # Output 2: scores [1, N]
        # Output 3: num_detections [1]
        boxes   = self._interpreter.get_tensor(self._output_details[0]['index'])[0]   # [N, 4]
        classes = self._interpreter.get_tensor(self._output_details[1]['index'])[0]   # [N]
        scores  = self._interpreter.get_tensor(self._output_details[2]['index'])[0]   # [N]
        n_valid = int(self._interpreter.get_tensor(self._output_details[3]['index'])[0])

        elapsed_ms = (time.perf_counter() - t0) * 1000

        # Parse into CoralDetection objects
        img_h = self._input_details[0]['shape'][1]
        img_w = self._input_details[0]['shape'][2]

        detections: List[CoralDetection] = []
        for i in range(n_valid):
            score = float(scores[i])
            if score < self.conf_threshold:
                continue

            cls_id = int(classes[i])
            ymin, xmin, ymax, xmax = boxes[i]

            # Denormalize to pixel coordinates at inference resolution
            x1 = float(xmin) * img_w
            y1 = float(ymin) * img_h
            x2 = float(xmax) * img_w
            y2 = float(ymax) * img_h

            detections.append(CoralDetection(
                x1=max(0.0, x1), y1=max(0.0, y1),
                x2=min(float(img_w), x2), y2=min(float(img_h), y2),
                confidence=score,
                class_id=cls_id,
                class_name=CLASSES.get(cls_id, f"class_{cls_id}"),
            ))

        logger.debug(
            f"Coral inference: {len(detections)} detections in {elapsed_ms:.1f}ms"
        )
        return sorted(detections, key=lambda d: -d.confidence), elapsed_ms
