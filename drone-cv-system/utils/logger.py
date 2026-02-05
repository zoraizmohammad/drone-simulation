"""
Logging Utilities
-----------------
Structured logging setup and telemetry CSV logger.
"""

from __future__ import annotations

import csv
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

from loguru import logger


def setup_logging(level: str = "INFO", log_dir: str = "logs"):
    """
    Configure loguru with console + file output.
    File rotates daily, kept for 7 days.
    """
    Path(log_dir).mkdir(parents=True, exist_ok=True)
    log_file = Path(log_dir) / f"mission_{datetime.now():%Y%m%d_%H%M%S}.log"

    logger.remove()

    # Console: colored, concise
    logger.add(
        sys.stderr,
        level=level,
        format="<green>{time:HH:mm:ss.SSS}</green> | <level>{level: <8}</level> | {message}",
        colorize=True,
    )

    # File: full detail
    logger.add(
        str(log_file),
        level="DEBUG",
        format="{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | {name}:{line} | {message}",
        rotation="100 MB",
        retention=7,
        compression="zip",
    )

    logger.info(f"Logging initialized — file: {log_file}")


class TelemetryLogger:
    """
    Writes all sensor telemetry to a CSV file for post-flight analysis.
    Columns: timestamp, phase, altitude, lat, lon, yaw, vx, vy, vz,
             battery_pct, flow_quality, flow_vx, flow_vy, rangefinder,
             ekf_healthy, num_detections
    """

    COLUMNS = [
        "timestamp_s",
        "phase",
        "alt_rel_m",
        "rangefinder_m",
        "lat_deg",
        "lon_deg",
        "yaw_deg",
        "vx_ms",
        "vy_ms",
        "vz_ms",
        "battery_pct",
        "flow_quality",
        "flow_vx",
        "flow_vy",
        "ekf_healthy",
        "num_detections",
    ]

    def __init__(self, output_path: str = "logs/telemetry.csv"):
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        self._file = open(output_path, "w", newline="", buffering=1)  # Line-buffered
        self._writer = csv.DictWriter(self._file, fieldnames=self.COLUMNS)
        self._writer.writeheader()
        self._t0 = __import__("time").time()
        logger.info(f"Telemetry logging to {output_path}")

    def log(self, telem, phase, num_detections: int = 0):
        import time
        self._writer.writerow({
            "timestamp_s":    round(time.time() - self._t0, 3),
            "phase":          phase.value if hasattr(phase, "value") else str(phase),
            "alt_rel_m":      round(telem.alt_rel_m, 3),
            "rangefinder_m":  round(telem.rangefinder_m, 3),
            "lat_deg":        round(telem.lat_deg, 7),
            "lon_deg":        round(telem.lon_deg, 7),
            "yaw_deg":        round(telem.yaw_deg, 2),
            "vx_ms":          round(telem.vx_ms, 3),
            "vy_ms":          round(telem.vy_ms, 3),
            "vz_ms":          round(telem.vz_ms, 3),
            "battery_pct":    round(telem.battery_pct, 1),
            "flow_quality":   telem.flow_quality,
            "flow_vx":        round(telem.flow_comp_m_x, 4),
            "flow_vy":        round(telem.flow_comp_m_y, 4),
            "ekf_healthy":    int(telem.ekf_healthy),
            "num_detections": num_detections,
        })

    def close(self):
        self._file.flush()
        self._file.close()
        logger.info("Telemetry log closed")
