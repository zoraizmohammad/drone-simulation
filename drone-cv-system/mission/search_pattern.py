"""
Search Pattern Generator
------------------------
Generates the drone's search flight path over the garden.

Two strategies:
1. LAWNMOWER (boustrophedon) — systematic back-and-forth strips covering
   the entire search area. Used for initial garden mapping if no pre-known
   flower positions are available.

2. WAYPOINT SEQUENCE — visit a known list of flower cluster GPS positions.
   Used when we have prior knowledge (e.g., from a previous mapping flight
   or a manually entered garden plan).

All positions are in NED frame relative to the takeoff point (home base).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Optional

import yaml
from loguru import logger


@dataclass
class Waypoint:
    """A navigation waypoint in NED frame."""
    name: str
    north_m: float
    east_m: float
    altitude_m: float       # Positive = above home (patrol altitude)
    is_scan_point: bool = True   # Should we scan for flowers here?
    cluster_id: Optional[str] = None

    def distance_to(self, other: "Waypoint") -> float:
        return math.sqrt(
            (self.north_m - other.north_m) ** 2 +
            (self.east_m - other.east_m) ** 2
        )

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "north_m": self.north_m,
            "east_m": self.east_m,
            "altitude_m": self.altitude_m,
            "is_scan_point": self.is_scan_point,
        }


class SearchPatternGenerator:
    """
    Generates flight path waypoints for systematic garden coverage.
    """

    def __init__(self, config_path: str = "config/mission_config.yaml"):
        with open(config_path) as f:
            cfg = yaml.safe_load(f)
        self.patrol_alt = cfg["mission"]["patrol_altitude_m"]
        self.garden_size = cfg["mission"]["garden_size_m"]
        self.overlap = cfg["mission"]["search_overlap_pct"]

        # Camera footprint at patrol altitude
        # Assuming 90° FOV camera: footprint = 2 * altitude * tan(45°) = 2 * alt
        self.camera_fov_deg = 90.0
        self.footprint_m = 2 * self.patrol_alt * math.tan(math.radians(self.camera_fov_deg / 2))
        self.strip_spacing_m = self.footprint_m * (1 - self.overlap)

        logger.info(
            f"Search pattern: footprint={self.footprint_m:.1f}m "
            f"strip_spacing={self.strip_spacing_m:.1f}m"
        )

    # ------------------------------------------------------------------
    # Lawnmower Pattern
    # ------------------------------------------------------------------

    def lawnmower(
        self,
        area_north_m: float,
        area_east_m: float,
        width_m: Optional[float] = None,
        height_m: Optional[float] = None,
    ) -> List[Waypoint]:
        """
        Generate a lawnmower (boustrophedon) search pattern.

        Args:
            area_north_m: NED north start of search area
            area_east_m: NED east start of search area
            width_m: East-West extent of search area (default: garden_size)
            height_m: North-South extent of search area (default: garden_size)

        Returns:
            Ordered list of Waypoints forming the lawnmower path.
        """
        width = width_m or self.garden_size
        height = height_m or self.garden_size

        waypoints: List[Waypoint] = []
        east = area_east_m
        strip = 0

        while east <= area_east_m + width:
            if strip % 2 == 0:
                # South to north
                n_start = area_north_m
                n_end = area_north_m + height
            else:
                # North to south
                n_start = area_north_m + height
                n_end = area_north_m

            waypoints.append(Waypoint(
                name=f"lm_{strip}_start",
                north_m=n_start,
                east_m=east,
                altitude_m=self.patrol_alt,
                is_scan_point=True,
            ))
            waypoints.append(Waypoint(
                name=f"lm_{strip}_end",
                north_m=n_end,
                east_m=east,
                altitude_m=self.patrol_alt,
                is_scan_point=True,
            ))

            east += self.strip_spacing_m
            strip += 1

        logger.info(f"Lawnmower: {len(waypoints)} waypoints covering {width}m × {height}m")
        return waypoints

    # ------------------------------------------------------------------
    # Waypoint Sequence (pre-known flower positions)
    # ------------------------------------------------------------------

    def from_cluster_positions(
        self,
        clusters: List[dict],
        home_north: float = 0.0,
        home_east: float = 0.0,
    ) -> List[Waypoint]:
        """
        Build a waypoint sequence visiting known flower cluster positions.

        Args:
            clusters: List of dicts with keys: name, north_m, east_m
            home_north, home_east: Home position in NED frame

        Returns:
            TSP-ordered list of Waypoints (nearest-neighbor heuristic).
        """
        if not clusters:
            return []

        waypoints = [
            Waypoint(
                name=c.get("name", f"cluster_{i}"),
                north_m=c["north_m"],
                east_m=c["east_m"],
                altitude_m=self.patrol_alt,
                is_scan_point=True,
                cluster_id=c.get("id"),
            )
            for i, c in enumerate(clusters)
        ]

        # Nearest-neighbor TSP starting from home
        ordered = self._nearest_neighbor_tsp(
            waypoints,
            start_north=home_north,
            start_east=home_east,
        )

        logger.info(f"Cluster route: {len(ordered)} waypoints")
        return ordered

    # ------------------------------------------------------------------
    # Spiral Search (when hovering and scanning)
    # ------------------------------------------------------------------

    def spiral_hover_scan(
        self,
        center_north: float,
        center_east: float,
        radius_m: float = 3.0,
        loops: int = 2,
        points_per_loop: int = 8,
    ) -> List[Waypoint]:
        """
        Generate a tight spiral hover scan pattern around a suspected flower
        cluster position. Used during the SCANNING phase when drone hovers
        and slowly spirals to maximize camera coverage.
        """
        waypoints: List[Waypoint] = []
        for loop in range(loops):
            r = radius_m * (loop + 1) / loops
            for i in range(points_per_loop):
                angle = 2 * math.pi * i / points_per_loop
                n = center_north + r * math.cos(angle)
                e = center_east + r * math.sin(angle)
                waypoints.append(Waypoint(
                    name=f"spiral_{loop}_{i}",
                    north_m=n,
                    east_m=e,
                    altitude_m=self.patrol_alt,
                    is_scan_point=True,
                ))

        logger.info(f"Spiral scan: {len(waypoints)} points, radius={radius_m}m")
        return waypoints

    # ------------------------------------------------------------------
    # TSP (nearest-neighbor heuristic)
    # ------------------------------------------------------------------

    def _nearest_neighbor_tsp(
        self,
        waypoints: List[Waypoint],
        start_north: float,
        start_east: float,
    ) -> List[Waypoint]:
        """
        Simple nearest-neighbor TSP ordering.
        Not optimal but runs in O(n²) — fine for ≤20 waypoints.
        """
        remaining = list(waypoints)
        ordered: List[Waypoint] = []
        cur_n, cur_e = start_north, start_east

        while remaining:
            nearest = min(remaining, key=lambda w: math.sqrt(
                (w.north_m - cur_n)**2 + (w.east_m - cur_e)**2
            ))
            ordered.append(nearest)
            remaining.remove(nearest)
            cur_n, cur_e = nearest.north_m, nearest.east_m

        return ordered


# ------------------------------------------------------------------
# Pre-configured garden layout (matches the simulation's flower clusters)
# ------------------------------------------------------------------

GARDEN_FLOWER_CLUSTERS = [
    {"id": "f1",  "name": "Cluster A", "north_m":  4.0, "east_m":  3.0},
    {"id": "f2",  "name": "Cluster B", "north_m":  8.0, "east_m":  2.0},
    {"id": "f3",  "name": "Cluster C", "north_m": 12.0, "east_m":  5.0},
    {"id": "f4",  "name": "Cluster D", "north_m": 16.0, "east_m":  4.0},
    {"id": "f5",  "name": "Cluster E", "north_m":  5.0, "east_m": 10.0},
    {"id": "f6",  "name": "Cluster F", "north_m": 10.0, "east_m": 12.0},
    {"id": "f7",  "name": "Cluster G", "north_m": 15.0, "east_m": 10.0},
    {"id": "f8",  "name": "Cluster H", "north_m":  7.0, "east_m": 16.0},
    {"id": "f9",  "name": "Cluster I", "north_m": 13.0, "east_m": 17.0},
    {"id": "f10", "name": "Cluster J", "north_m": 18.0, "east_m": 15.0},
]
