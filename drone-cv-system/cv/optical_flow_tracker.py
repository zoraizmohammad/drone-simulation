"""
Optical Flow Tracker
--------------------
Uses Lucas-Kanade sparse optical flow (OpenCV) to track detected flowers
between frames. This serves two purposes:

1. Temporal smoothing — stabilizes detection bounding boxes jitter
2. Track continuity — maintains flower identity when the YOLO detector
   momentarily misses a flower (motion blur, partial occlusion)

Separate from the Pixhawk optical flow sensor (which measures drone ego-motion).
This is purely visual tracking on the camera frames.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
from loguru import logger

from cv.flower_detector import Detection


@dataclass
class Track:
    """A tracked flower across multiple frames."""

    track_id: int
    class_name: str

    # Current smoothed bounding box
    x1: float
    y1: float
    x2: float
    y2: float

    # Tracking keypoints (corners of bounding box) in previous frame
    keypoints: np.ndarray       # shape (N, 1, 2) float32

    confidence: float
    estimated_distance_m: Optional[float] = None

    # Track health
    age_frames: int = 0
    missed_frames: int = 0
    last_seen_ts: float = field(default_factory=time.time)

    # Smoothed center (exponential moving average)
    _alpha: float = 0.6        # EMA weight for new measurements

    @property
    def cx(self) -> float:
        return (self.x1 + self.x2) / 2

    @property
    def cy(self) -> float:
        return (self.y1 + self.y2) / 2

    @property
    def is_stale(self) -> bool:
        return self.missed_frames > 10

    def update_from_detection(self, det: Detection):
        """Update track with new detection using EMA smoothing."""
        a = self._alpha
        self.x1 = a * det.x1 + (1 - a) * self.x1
        self.y1 = a * det.y1 + (1 - a) * self.y1
        self.x2 = a * det.x2 + (1 - a) * self.x2
        self.y2 = a * det.y2 + (1 - a) * self.y2
        self.confidence = a * det.confidence + (1 - a) * self.confidence
        if det.estimated_distance_m is not None:
            self.estimated_distance_m = det.estimated_distance_m
        self.missed_frames = 0
        self.age_frames += 1
        self.last_seen_ts = time.time()
        self._update_keypoints()

    def _update_keypoints(self):
        """Refresh corner keypoints from current bounding box."""
        cx, cy = self.cx, self.cy
        hw, hh = (self.x2 - self.x1) / 2, (self.y2 - self.y1) / 2
        self.keypoints = np.array([
            [[cx - hw * 0.7, cy - hh * 0.7]],
            [[cx + hw * 0.7, cy - hh * 0.7]],
            [[cx - hw * 0.7, cy + hh * 0.7]],
            [[cx + hw * 0.7, cy + hh * 0.7]],
            [[cx,            cy            ]],
        ], dtype=np.float32)


class OpticalFlowTracker:
    """
    Maintains a set of active flower tracks, updating them each frame using
    Lucas-Kanade optical flow when YOLO detections are available, or pure flow
    prediction when they are not.

    Typical usage:
        tracker = OpticalFlowTracker()
        for frame in camera:
            detections = detector.detect(frame)
            tracks = tracker.update(frame_gray, detections)
            target = tracker.best_target()
    """

    # LK optical flow parameters
    LK_PARAMS = dict(
        winSize=(15, 15),
        maxLevel=2,
        criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 10, 0.03),
    )

    def __init__(
        self,
        iou_match_threshold: float = 0.35,
        max_missed_frames: int = 10,
    ):
        self.iou_threshold = iou_match_threshold
        self.max_missed = max_missed_frames
        self._tracks: Dict[int, Track] = {}
        self._next_id = 0
        self._prev_gray: Optional[np.ndarray] = None
        logger.info("OpticalFlowTracker initialized")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def update(
        self,
        frame_gray: np.ndarray,
        detections: List[Detection],
    ) -> List[Track]:
        """
        Update all tracks for this frame.

        Args:
            frame_gray: grayscale version of the current full-res camera frame
            detections: list of Detection objects from FlowerDetector

        Returns:
            List of active Track objects (not stale).
        """
        if self._prev_gray is not None and self._tracks:
            self._propagate_with_flow(frame_gray)

        # Match detections to existing tracks
        unmatched_detections = self._associate(detections)

        # Create new tracks for unmatched detections
        for det in unmatched_detections:
            self._create_track(det)

        # Age out stale tracks
        stale = [tid for tid, t in self._tracks.items() if t.is_stale]
        for tid in stale:
            logger.debug(f"Dropping stale track {tid} ({self._tracks[tid].class_name})")
            del self._tracks[tid]

        self._prev_gray = frame_gray.copy()
        return list(self._tracks.values())

    def best_target(self) -> Optional[Track]:
        """Return the most confident, closest open flower track."""
        candidates = [t for t in self._tracks.values() if not t.is_stale]
        open_flowers = [t for t in candidates if t.class_name == "flower_open"]
        pool = open_flowers if open_flowers else candidates
        if not pool:
            return None
        # Prefer closest (smallest estimated distance), then most confident
        return min(pool, key=lambda t: (
            t.estimated_distance_m or 999.0,
            -t.confidence
        ))

    def reset(self):
        self._tracks.clear()
        self._prev_gray = None
        logger.info("Tracker reset")

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _propagate_with_flow(self, curr_gray: np.ndarray):
        """
        Predict each track's new position using LK optical flow on its
        corner keypoints, before we try to associate new detections.
        """
        for tid, track in self._tracks.items():
            if track.keypoints is None or len(track.keypoints) == 0:
                track.missed_frames += 1
                continue

            new_pts, status, _ = cv2.calcOpticalFlowPyrLK(
                self._prev_gray, curr_gray,
                track.keypoints, None,
                **self.LK_PARAMS,
            )

            good_new = new_pts[status.flatten() == 1]
            if len(good_new) < 2:
                track.missed_frames += 1
                continue

            # Compute displacement of keypoint cluster centroid
            old_center = track.keypoints[status.flatten() == 1].mean(axis=0)[0]
            new_center = good_new.mean(axis=0)
            dx = new_center[0] - old_center[0]
            dy = new_center[1] - old_center[1]

            # Shift bounding box by the same displacement
            track.x1 += dx
            track.y1 += dy
            track.x2 += dx
            track.y2 += dy
            track.keypoints = good_new.reshape(-1, 1, 2)
            track.missed_frames += 1   # Will be reset to 0 if matched

    def _associate(self, detections: List[Detection]) -> List[Detection]:
        """
        Greedy IoU matching between detections and current tracks.
        Returns unmatched detections that need new tracks.
        """
        if not self._tracks or not detections:
            for t in self._tracks.values():
                if t.missed_frames == 0:
                    t.missed_frames = 1
            return detections

        track_list = list(self._tracks.items())
        matched_tracks = set()
        matched_dets = set()

        # Build IoU matrix
        iou_matrix = np.zeros((len(detections), len(track_list)))
        for di, det in enumerate(detections):
            for ti, (tid, track) in enumerate(track_list):
                iou_matrix[di, ti] = self._iou(
                    (det.x1, det.y1, det.x2, det.y2),
                    (track.x1, track.y1, track.x2, track.y2),
                )

        # Greedy matching by highest IoU
        while True:
            if iou_matrix.size == 0:
                break
            max_val = iou_matrix.max()
            if max_val < self.iou_threshold:
                break
            di, ti = np.unravel_index(iou_matrix.argmax(), iou_matrix.shape)
            tid = track_list[ti][0]
            self._tracks[tid].update_from_detection(detections[di])
            matched_tracks.add(ti)
            matched_dets.add(di)
            iou_matrix[di, :] = -1
            iou_matrix[:, ti] = -1

        # Increment missed for unmatched tracks
        for ti, (tid, track) in enumerate(track_list):
            if ti not in matched_tracks:
                pass  # already incremented in _propagate_with_flow

        return [det for di, det in enumerate(detections) if di not in matched_dets]

    def _create_track(self, det: Detection) -> Track:
        tid = self._next_id
        self._next_id += 1
        track = Track(
            track_id=tid,
            class_name=det.class_name,
            x1=det.x1, y1=det.y1, x2=det.x2, y2=det.y2,
            keypoints=np.zeros((5, 1, 2), dtype=np.float32),
            confidence=det.confidence,
            estimated_distance_m=det.estimated_distance_m,
        )
        track._update_keypoints()
        self._tracks[tid] = track
        logger.debug(f"New track {tid}: {det.class_name} @ ({det.cx:.0f}, {det.cy:.0f})")
        return track

    @staticmethod
    def _iou(box_a: Tuple, box_b: Tuple) -> float:
        """Compute IoU between two (x1, y1, x2, y2) boxes."""
        ax1, ay1, ax2, ay2 = box_a
        bx1, by1, bx2, by2 = box_b
        ix1 = max(ax1, bx1)
        iy1 = max(ay1, by1)
        ix2 = min(ax2, bx2)
        iy2 = min(ay2, by2)
        if ix2 <= ix1 or iy2 <= iy1:
            return 0.0
        inter = (ix2 - ix1) * (iy2 - iy1)
        area_a = (ax2 - ax1) * (ay2 - ay1)
        area_b = (bx2 - bx1) * (by2 - by1)
        union = area_a + area_b - inter
        return inter / union if union > 0 else 0.0
