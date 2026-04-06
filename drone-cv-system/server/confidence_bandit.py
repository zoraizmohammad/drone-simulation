"""
UCB1 contextual bandit for adaptive confidence thresholds.

Tracks reward (successful pollination = +1, missed/timeout = -1) per
context bucket (phase × sensor_quality_tier × battery_tier).

Context key: "{phase_tier}_{quality_tier}_{battery_tier}"
Arms: 3 confidence thresholds per context — [0.40, 0.60, 0.75]
"""

from __future__ import annotations

import math
from typing import Dict, List

# Arms: confidence threshold options
ARMS = [0.40, 0.60, 0.75]

# Phase tiers
PHASE_SCANNING = "scanning"
PHASE_APPROACH = "approach"
PHASE_HOVER    = "hover"

# Quality tiers
QUAL_HIGH = "high"   # stability > 0.7
QUAL_MED  = "med"    # stability 0.4–0.7
QUAL_LOW  = "low"    # stability < 0.4

# Battery tiers
BAT_HIGH = "high"    # >= 50%
BAT_LOW  = "low"     # < 50%


def _phase_tier(phase: str) -> str:
    approach_phases = {"descent", "approach", "target_lock", "candidate_detected"}
    hover_phases = {"hover_align", "pollinating"}
    if phase in approach_phases:
        return PHASE_APPROACH
    if phase in hover_phases:
        return PHASE_HOVER
    return PHASE_SCANNING


def _quality_tier(of_stability: float) -> str:
    if of_stability > 0.7:
        return QUAL_HIGH
    if of_stability >= 0.4:
        return QUAL_MED
    return QUAL_LOW


def _battery_tier(battery_pct: float) -> str:
    return BAT_HIGH if battery_pct >= 50 else BAT_LOW


def _context_key(phase: str, of_stability: float, battery_pct: float) -> str:
    return f"{_phase_tier(phase)}_{_quality_tier(of_stability)}_{_battery_tier(battery_pct)}"


class ConfidenceBandit:
    """
    UCB1 multi-armed bandit per context bucket.

    Each arm stores [pulls, reward_sum].
    UCB score = reward/pulls + sqrt(2 * log(total_pulls) / pulls)
    """

    def __init__(self) -> None:
        # Key: context_key → List of [pulls, reward_sum] per arm
        self._arms: Dict[str, List[List[float]]] = {}
        self._total_pulls = 0

    def _ensure_context(self, key: str) -> List[List[float]]:
        if key not in self._arms:
            # Initialise each arm with 1 pull and a neutral reward so UCB is defined
            self._arms[key] = [[1.0, 0.5] for _ in ARMS]
        return self._arms[key]

    def select_threshold(self, phase: str, of_stability: float, battery_pct: float) -> float:
        """Return the threshold (arm) with highest UCB score for this context."""
        key = _context_key(phase, of_stability, battery_pct)
        arms = self._ensure_context(key)

        total = sum(a[0] for a in arms) + 1  # +1 prevents log(0)
        ucb_scores: List[float] = []
        for pulls, reward_sum in arms:
            avg = reward_sum / pulls
            exploration = math.sqrt(2 * math.log(total) / pulls)
            ucb_scores.append(avg + exploration)

        best_idx = ucb_scores.index(max(ucb_scores))
        return ARMS[best_idx]

    def update_reward(
        self,
        phase: str,
        of_stability: float,
        battery_pct: float,
        success: bool,
    ) -> None:
        """Update the bandit after observing a reward signal."""
        key = _context_key(phase, of_stability, battery_pct)
        arms = self._ensure_context(key)

        # We update the arm that was most recently selected for this context
        # (we use the current best arm as a proxy — full tracking not needed here)
        total = sum(a[0] for a in arms) + 1
        ucb_scores: List[float] = []
        for pulls, reward_sum in arms:
            avg = reward_sum / pulls
            exploration = math.sqrt(2 * math.log(total) / pulls)
            ucb_scores.append(avg + exploration)

        best_idx = ucb_scores.index(max(ucb_scores))
        reward = 1.0 if success else -1.0
        arms[best_idx][0] += 1
        arms[best_idx][1] += reward
        self._total_pulls += 1

    def get_stats(self) -> dict:
        stats: dict = {}
        for ctx_key, arms in self._arms.items():
            arm_info = []
            for i, (pulls, reward_sum) in enumerate(arms):
                arm_info.append({
                    "threshold": ARMS[i],
                    "pulls": int(pulls),
                    "avg_reward": round(reward_sum / pulls, 3),
                })
            stats[ctx_key] = arm_info
        return {
            "contexts": stats,
            "total_pulls": self._total_pulls,
            "num_contexts": len(self._arms),
        }
