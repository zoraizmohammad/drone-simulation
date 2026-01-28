"""
Depth Estimator
---------------
Estimates the distance from the drone's camera to a detected flower using
two complementary methods that are fused together:

1. MONOCULAR SIZE METHOD
   Known: average flower head is ~5cm wide.
   Known: camera focal length in pixels (from calibration).
   Observed: pixel width of bounding box.
   => distance = (known_width_m * focal_length_px) / pixel_width

2. RANGEFINDER FUSION
   The Pixhawk downward rangefinder gives total altitude above ground.
   If the flower is on the ground plane, this is our ground-truth distance.
   We use this to correct/calibrate the monocular estimate in real-time.

3. BEARING PROJECTION
   Given camera bearing vector + estimated distance, compute the 3D
   offset from drone to flower in NED (North-East-Down) frame for
   precision positioning commands.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np
from loguru import logger

from cv.flower_detector import Detection


@dataclass
class FlowerPosition3D:
    """3D position of a flower relative to the drone."""

    # Offset in camera/body frame (meters)
    # x = right, y = forward, z = down
    dx_m: float
    dy_m: float
    dz_m: float

    # Horizontal distance in ground plane
    ground_distance_m: float

    # Confidence in this estimate (0–1)
    confidence: float

    @property
    def ned_offset(self) -> np.ndarray:
        """Convert body-frame offset to NED (North-East-Down)."""
        # Assumes camera is mounted directly downward, drone heading = north
        # Full implementation would use drone yaw from Pixhawk telemetry
        return np.array([self.dy_m, self.dx_m, self.dz_m])


class DepthEstimator:
    """
    Fuses monocular size-based depth estimation with rangefinder altitude
    to produce accurate distance estimates for detected flowers.
    """

    def __init__(
        self,
        focal_length_px: float = 984.25,
        known_flower_width_m: float = 0.05,
        known_flower_height_m: float = 0.05,
        frame_width_px: int = 1280,
        frame_height_px: int = 720,
    ):
        self.fx = focal_length_px
        self.fy = focal_length_px
        self.known_flower_w = known_flower_width_m
        self.known_flower_h = known_flower_height_m
        self.frame_w = frame_width_px
        self.frame_h = frame_height_px

        # Running bias correction factor (updated when rangefinder available)
        self._scale_correction = 1.0

        logger.info("DepthEstimator initialized")

    def estimate(
        self,
        detection: Detection,
        rangefinder_altitude_m: Optional[float] = None,
        drone_yaw_deg: float = 0.0,
    ) -> FlowerPosition3D:
        """
        Estimate the 3D position of a detected flower.

        Args:
            detection: Detection with bounding box in full-res pixel coords
            rangefinder_altitude_m: Current altitude from Pixhawk rangefinder.
                                    If None, monocular estimate is used alone.
            drone_yaw_deg: Current drone heading (for NED conversion)

        Returns:
            FlowerPosition3D with position estimate and confidence.
        """
        # --- Method 1: Monocular size ---
        mono_dist = self._monocular_distance(detection)

        # --- Method 2: Rangefinder fusion ---
        if rangefinder_altitude_m is not None and rangefinder_altitude_m > 0.2:
            # If the flower subtends a small angle (far away), trust rangefinder
            # If bbox is large (flower is close), monocular is more reliable
            flower_angular_size = detection.width / self.frame_w
            rf_weight = max(0.0, 1.0 - flower_angular_size * 5.0)  # 0 when very close
            mono_weight = 1.0 - rf_weight

            # Update scale correction using rangefinder as ground truth
            if mono_dist > 0:
                new_correction = rangefinder_altitude_m / mono_dist
                # Smooth the correction with EMA
                self._scale_correction = 0.9 * self._scale_correction + 0.1 * new_correction

            fused_dist = (rf_weight * rangefinder_altitude_m +
                          mono_weight * mono_dist * self._scale_correction)
            confidence = 0.85 + rf_weight * 0.1
        else:
            fused_dist = mono_dist * self._scale_correction
            confidence = 0.55 if fused_dist < 5.0 else 0.35

        # Update detection
        detection.estimated_distance_m = fused_dist

        # --- Compute 3D offset ---
        # Back-project center pixel to a ray direction
        cx_norm = (detection.cx - self.frame_w / 2) / self.fx
        cy_norm = (detection.cy - self.frame_h / 2) / self.fy

        # Camera points down: Z_cam = altitude (depth along boresight)
        # X offset = cx_norm * depth, Y offset = cy_norm * depth
        dx = cx_norm * fused_dist    # lateral (right)
        dy = cy_norm * fused_dist    # fore-aft (forward, if cam points down)
        dz = fused_dist              # downward

        # Rotate by drone yaw to get NED offsets
        yaw_rad = np.radians(drone_yaw_deg)
        north_offset = dx * np.sin(yaw_rad) + dy * np.cos(yaw_rad)
        east_offset  = dx * np.cos(yaw_rad) - dy * np.sin(yaw_rad)

        return FlowerPosition3D(
            dx_m=east_offset,
            dy_m=north_offset,
            dz_m=dz,
            ground_distance_m=np.sqrt(dx**2 + dy**2),
            confidence=confidence,
        )

    def _monocular_distance(self, detection: Detection) -> float:
        """
        Distance estimation using apparent size:
            D = (W_real * f) / W_pixel
        Combines width and height estimates and averages them.
        """
        estimates = []
        if detection.width > 5:
            estimates.append((self.known_flower_w * self.fx) / detection.width)
        if detection.height > 5:
            estimates.append((self.known_flower_h * self.fy) / detection.height)

        if not estimates:
            return 5.0  # Fallback: assume 5m if box too small to measure

        return float(np.mean(estimates))

    def estimate_hover_error(
        self,
        detection: Detection,
        target_altitude_m: float,
        rangefinder_altitude_m: float,
    ) -> Tuple[float, float, float]:
        """
        During precision hover, compute the X/Y/Z error from the ideal
        position directly above the flower.

        Returns:
            (error_north_m, error_east_m, error_down_m)
            These are sent as velocity corrections to the flight controller.
        """
        pos = self.estimate(detection, rangefinder_m=rangefinder_altitude_m)

        # Altitude error (positive = need to descend)
        alt_error = rangefinder_altitude_m - target_altitude_m

        return (pos.dy_m, pos.dx_m, alt_error)
