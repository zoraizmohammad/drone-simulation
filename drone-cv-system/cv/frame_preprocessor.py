"""
Frame Preprocessor
------------------
Handles camera capture from the Raspberry Pi camera, undistortion using
calibration parameters, and normalization before inference.
"""

import cv2
import numpy as np
import yaml
from pathlib import Path
from typing import Optional, Tuple
from loguru import logger


class FramePreprocessor:
    """
    Captures frames from the downward-facing camera, undistorts them using the
    camera calibration matrix, and prepares them for ML inference.

    On Raspberry Pi, use:
        cap = cv2.VideoCapture(0)
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
    for best performance with the RPi Camera Module.
    """

    def __init__(self, config_path: str = "config/camera_config.yaml"):
        with open(config_path) as f:
            cfg = yaml.safe_load(f)

        cam_cfg = cfg["camera"]
        self.resolution = tuple(cam_cfg["resolution"])   # (width, height)
        self.fps = cam_cfg["fps"]
        self.inference_size = tuple(cfg["inference"]["input_size"])  # (w, h)

        # Build OpenCV calibration matrices
        intr = cam_cfg["intrinsic_matrix"]
        self.K = np.array([
            [intr["fx"], 0,          intr["cx"]],
            [0,          intr["fy"], intr["cy"]],
            [0,          0,          1         ],
        ], dtype=np.float64)
        self.dist_coeffs = np.array(cam_cfg["distortion_coeffs"], dtype=np.float64)

        # Precompute undistortion maps (faster than per-frame undistort)
        self.map1, self.map2 = cv2.initUndistortRectifyMap(
            self.K, self.dist_coeffs, None, self.K,
            self.resolution, cv2.CV_16SC2
        )

        self.cap: Optional[cv2.VideoCapture] = None
        logger.info(f"FramePreprocessor ready — {self.resolution[0]}x{self.resolution[1]} @ {self.fps}fps")

    def open(self) -> bool:
        """Open the camera device."""
        self.cap = cv2.VideoCapture(0)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.resolution[0])
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.resolution[1])
        self.cap.set(cv2.CAP_PROP_FPS, self.fps)
        # MJPEG reduces USB bandwidth significantly on RPi
        self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))

        if not self.cap.isOpened():
            logger.error("Failed to open camera")
            return False
        logger.info("Camera opened successfully")
        return True

    def read_raw(self) -> Tuple[bool, Optional[np.ndarray]]:
        """Read a raw frame without any processing."""
        if self.cap is None:
            return False, None
        ret, frame = self.cap.read()
        return ret, frame

    def read_frame(self) -> Tuple[bool, Optional[np.ndarray], Optional[np.ndarray]]:
        """
        Read and preprocess a frame.

        Returns:
            (success, undistorted_bgr, inference_rgb)
            - undistorted_bgr: full-res undistorted frame for display/tracking
            - inference_rgb:   resized RGB frame ready for ML model input
        """
        ret, raw = self.read_raw()
        if not ret or raw is None:
            return False, None, None

        # Undistort using precomputed maps (fast remap)
        undistorted = cv2.remap(raw, self.map1, self.map2, cv2.INTER_LINEAR)

        # Resize for inference
        inference_bgr = cv2.resize(undistorted, self.inference_size, interpolation=cv2.INTER_LINEAR)

        # Convert to RGB for PyTorch/YOLO (which expects RGB)
        inference_rgb = cv2.cvtColor(inference_bgr, cv2.COLOR_BGR2RGB)

        return True, undistorted, inference_rgb

    def pixel_to_camera_ray(self, px: float, py: float) -> np.ndarray:
        """
        Convert a pixel coordinate to a normalized camera-space direction vector.
        Used to compute the bearing to a detected flower.

        Returns a unit vector [x, y, z] in camera frame (z = forward/down).
        """
        pt = np.array([[[px, py]]], dtype=np.float32)
        undistorted_pt = cv2.undistortPoints(pt, self.K, self.dist_coeffs, P=self.K)
        px_u = undistorted_pt[0, 0, 0]
        py_u = undistorted_pt[0, 0, 1]

        # Back-project through K
        ray = np.array([
            (px_u - self.K[0, 2]) / self.K[0, 0],
            (py_u - self.K[1, 2]) / self.K[1, 1],
            1.0
        ])
        return ray / np.linalg.norm(ray)

    def release(self):
        if self.cap is not None:
            self.cap.release()
            logger.info("Camera released")

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, *_):
        self.release()
