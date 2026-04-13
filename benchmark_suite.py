#!/usr/bin/env python3
"""
Autonomous Pollination UAV — Benchmark Suite
============================================
Runs 7 real timed experiments on every code path executable without hardware.
All timings use time.perf_counter(). Results saved to benchmark_results/.

Benchmarks
----------
B1  Mock Detector Latency          altitude × flower-count grid, 1000 calls/cell
B2  Sensor Interpolation Speed     100k lookups + altitude sweep curve
B3  TSP Planning Scalability       N=2..50 flowers, 500 trials/N
B4  Full Frame Pipeline Throughput 2700 mission frames end-to-end
B5  Detection Confidence vs Altitude   altitude 8m→1.5m, 4 proximity offsets
B6  UCB1 Confidence Bandit         500-step simulated mission
B7  LLM Agent /decide Latency      10 Claude Haiku tool-calling calls
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import random
import sys
import time
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

# ─── Output dirs ──────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent
OUT  = ROOT / "benchmark_results"
PLOTS = OUT / "plots"
OUT.mkdir(exist_ok=True)
PLOTS.mkdir(exist_ok=True)

# ─── Plot style (clean white academic style) ──────────────────────────────────
plt.rcParams.update({
    "figure.facecolor":  "white",
    "axes.facecolor":    "white",
    "axes.edgecolor":    "#cccccc",
    "axes.labelcolor":   "#222222",
    "axes.titlecolor":   "#111111",
    "axes.spines.top":   False,
    "axes.spines.right": False,
    "xtick.color":       "#444444",
    "ytick.color":       "#444444",
    "grid.color":        "#e5e5e5",
    "grid.linestyle":    "--",
    "grid.alpha":        0.8,
    "text.color":        "#222222",
    "legend.facecolor":  "white",
    "legend.edgecolor":  "#cccccc",
    "figure.dpi":        150,
    "font.size":         10,
})

BLUE   = "#1f77b4"
ORANGE = "#ff7f0e"
GREEN  = "#2ca02c"
RED    = "#d62728"
PURPLE = "#9467bd"
TEAL   = "#17becf"
GRAY   = "#7f7f7f"

# ─── Inlined sensor model (mirrors detection_bridge.py) ───────────────────────
_SENSOR_TABLE = [
    (0,   255, 10),  (12,  240, 40),  (24,  220, 75),  (36,  200, 95),
    (48,  180, 110), (60,  160, 120), (72,  140, 130),  (84,  120, 140),
    (96,  105, 145), (108, 95,  148), (120, 85,  150),  (132, 75,  148),
    (144, 65,  145), (156, 55,  140), (168, 50,  135),  (180, 45,  130),
    (192, 40,  120), (204, 35,  110), (216, 30,  100),  (228, 28,  90),
    (240, 25,  80),  (252, 22,  70),  (264, 20,  60),   (276, 18,  50),
    (315, 10,  20),
]

IMG_SIZE = 640
FX = FY = IMG_SIZE / 2
CX = CY = IMG_SIZE / 2


def _sensor_at_dist_in(dist_in: float) -> tuple[float, float]:
    clamped = max(0.0, min(315.0, dist_in))
    for i in range(len(_SENSOR_TABLE) - 1):
        d0, s0, q0 = _SENSOR_TABLE[i]
        d1, s1, q1 = _SENSOR_TABLE[i + 1]
        if d0 <= clamped <= d1:
            if d1 == d0:
                return float(s0), float(q0)
            t = (clamped - d0) / (d1 - d0)
            st = t * t * (3 - 2 * t)
            return s0 + (s1 - s0) * st, q0 + (q1 - q0) * st
    return float(_SENSOR_TABLE[-1][1]), float(_SENSOR_TABLE[-1][2])


def _project_flower(flower: dict, drone: dict) -> dict | None:
    alt = max(0.1, drone["z"])
    rel_x = flower["x"] - drone["x"]
    rel_y = flower["y"] - drone["y"]
    yaw_rad = math.radians(drone.get("yaw", 0))
    cam_x = rel_x * math.cos(yaw_rad) + rel_y * math.sin(yaw_rad)
    cam_y = -rel_x * math.sin(yaw_rad) + rel_y * math.cos(yaw_rad)
    u = FX * cam_x / alt + CX
    v = FY * cam_y / alt + CY
    r = max(3, flower["radius"] / alt * FX)
    if u < -r or u > IMG_SIZE + r or v < -r or v > IMG_SIZE + r:
        return None
    return {"u": u, "v": v, "radius": r}


def mock_detect(drone: dict, flowers: list[dict]) -> list[dict]:
    alt = max(0.1, drone.get("z", 1.0))
    dist_in = alt * 39.37
    strength, quality = _sensor_at_dist_in(dist_in)
    stability = min(1.0, quality / 150.0)
    norm_strength = strength / 255.0
    detections = []
    for flower in flowers:
        proj = _project_flower(flower, drone)
        if proj is None:
            continue
        hdist = math.hypot(flower["x"] - drone["x"], flower["y"] - drone["y"])
        base = max(0.0, 1.0 - hdist / (alt * 1.8))
        conf = base * (0.6 + 0.4 * stability) * (0.6 + 0.4 * norm_strength)
        if conf < 0.12:
            continue
        r = proj["radius"]
        u, v = proj["u"], proj["v"]
        detections.append({
            "id": flower["id"],
            "confidence": round(float(conf), 3),
            "cls": "flower_open",
            "bbox": [max(0, int(u-r)), max(0, int(v-r)),
                     min(IMG_SIZE, int(u+r)), min(IMG_SIZE, int(v+r))],
        })
    return sorted(detections, key=lambda d: -d["confidence"])


# ─── Inlined UCB1 bandit (mirrors confidence_bandit.py) ───────────────────────
ARMS = [0.40, 0.60, 0.75]

class ConfidenceBandit:
    def __init__(self):
        self._arms: dict[str, list[list[float]]] = {}
        self._total_pulls = 0

    def _ensure(self, key: str) -> list[list[float]]:
        if key not in self._arms:
            self._arms[key] = [[1.0, 0.5] for _ in ARMS]
        return self._arms[key]

    def select(self, key: str) -> int:
        arms = self._ensure(key)
        total = sum(a[0] for a in arms) + 1
        scores = [a[1]/a[0] + math.sqrt(2*math.log(total)/a[0]) for a in arms]
        return scores.index(max(scores))

    def update(self, key: str, arm_idx: int, reward: float):
        arms = self._ensure(key)
        arms[arm_idx][0] += 1
        arms[arm_idx][1] += reward
        self._total_pulls += 1

    def arm_counts(self, key: str) -> list[int]:
        return [int(a[0]) for a in self._ensure(key)]


# ─── Helper fixtures ───────────────────────────────────────────────────────────
def make_flowers(n: int, rng: random.Random | None = None) -> list[dict]:
    rng = rng or random.Random(42)
    return [
        {"id": f"f{i}", "x": rng.uniform(2, 18), "y": rng.uniform(2, 18),
         "radius": rng.uniform(0.5, 1.2)}
        for i in range(n)
    ]

def make_drone(x=10.0, y=10.0, z=5.0, yaw=0.0) -> dict:
    return {"x": x, "y": y, "z": z, "yaw": yaw}

MISSION_FLOWERS = make_flowers(8, random.Random(42))
MISSION_WAYPOINTS = [
    (4.5,3.5), (8.0,5.0), (12.0,4.0), (15.5,6.5),
    (16.5,10.5),(14.0,15.0),(6.0,11.5),(9.0,14.0),
]


def stat(data: list[float]) -> dict:
    a = np.array(data)
    return {
        "mean_ms":   round(float(np.mean(a)), 4),
        "median_ms": round(float(np.median(a)), 4),
        "p95_ms":    round(float(np.percentile(a, 95)), 4),
        "p99_ms":    round(float(np.percentile(a, 99)), 4),
        "min_ms":    round(float(np.min(a)), 4),
        "max_ms":    round(float(np.max(a)), 4),
        "std_ms":    round(float(np.std(a)), 4),
        "n":         len(data),
    }


results: dict[str, Any] = {}

print("=" * 66)
print("  AUTONOMOUS POLLINATION UAV — BENCHMARK SUITE")
print("=" * 66)


# ══════════════════════════════════════════════════════════════════════════════
# B1 — Mock Detector Latency Distribution
# ══════════════════════════════════════════════════════════════════════════════
print("\n[B1] Mock Detector Latency  (altitude × flower-count grid) ...")

ALTITUDES   = [1.5, 3.0, 5.0, 8.0]
FLOWER_CNTS = [1, 3, 5, 8, 10]
REPS        = 1000
WARMUP      = 20

b1_grid: dict[str, dict] = {}
b1_mean_matrix = np.zeros((len(ALTITUDES), len(FLOWER_CNTS)))

for ai, alt in enumerate(ALTITUDES):
    for fi, n_fl in enumerate(FLOWER_CNTS):
        flowers = make_flowers(n_fl)
        drone   = make_drone(z=alt)
        for _ in range(WARMUP):
            mock_detect(drone, flowers)
        times = []
        for _ in range(REPS):
            t0 = time.perf_counter()
            mock_detect(drone, flowers)
            times.append((time.perf_counter() - t0) * 1000)
        s = stat(times)
        key = f"alt_{alt}m_n{n_fl}"
        b1_grid[key] = {"altitude_m": alt, "n_flowers": n_fl, **s}
        b1_mean_matrix[ai, fi] = s["mean_ms"]
        print(f"  alt={alt:.1f}m  n={n_fl:2d}  mean={s['mean_ms']:.4f}ms  p99={s['p99_ms']:.4f}ms")

results["B1_mock_detector"] = {
    "description": "MockDetector.detect() latency across altitude × flower-count",
    "reps_per_cell": REPS,
    "warmup": WARMUP,
    "grid": b1_grid,
    "overall_mean_ms": round(float(np.mean(b1_mean_matrix)), 4),
    "overall_p99_ms":  round(max(v["p99_ms"] for v in b1_grid.values()), 4),
}

# Plot B1 — heatmap
fig, ax = plt.subplots(figsize=(7, 4))
im = ax.imshow(b1_mean_matrix * 1000, cmap="Blues", aspect="auto")
ax.set_xticks(range(len(FLOWER_CNTS)))
ax.set_xticklabels([str(n) for n in FLOWER_CNTS])
ax.set_yticks(range(len(ALTITUDES)))
ax.set_yticklabels([f"{a}m" for a in ALTITUDES])
ax.set_xlabel("Flowers in scene")
ax.set_ylabel("Drone altitude")
ax.set_title("B1 — Mock Detector Mean Latency (µs)", fontweight="bold")
for ai in range(len(ALTITUDES)):
    for fi in range(len(FLOWER_CNTS)):
        val = b1_mean_matrix[ai, fi] * 1000
        ax.text(fi, ai, f"{val:.1f}", ha="center", va="center",
                fontsize=9, color="white" if val > 7 else "#222222")
cbar = plt.colorbar(im, ax=ax)
cbar.set_label("µs")
plt.tight_layout()
plt.savefig(PLOTS / "b1_mock_detector_heatmap.png", facecolor="white")
plt.close()
print(f"  → saved b1_mock_detector_heatmap.png")


# ══════════════════════════════════════════════════════════════════════════════
# B2 — Sensor Interpolation Throughput
# ══════════════════════════════════════════════════════════════════════════════
print("\n[B2] Sensor Interpolation Throughput  (100 k lookups) ...")

N_LOOKUPS = 100_000
rng = random.Random(0)
distances = [rng.uniform(0, 315) for _ in range(N_LOOKUPS)]

for d in distances[:200]:
    _sensor_at_dist_in(d)

t0 = time.perf_counter()
for d in distances:
    _sensor_at_dist_in(d)
elapsed_s = time.perf_counter() - t0
lookups_per_sec = N_LOOKUPS / elapsed_s
mean_us = elapsed_s / N_LOOKUPS * 1e6

altitudes_m = np.linspace(0.0, 8.0, 80)
strengths, qualities, stabilities = [], [], []
for alt in altitudes_m:
    dist_in = alt * 39.37
    s, q = _sensor_at_dist_in(dist_in)
    strengths.append(s)
    qualities.append(q)
    stabilities.append(min(1.0, q / 150.0))

results["B2_sensor_interpolation"] = {
    "description": "_sensor_at_dist_in() throughput over 100k random altitudes",
    "n_lookups": N_LOOKUPS,
    "total_time_ms": round(elapsed_s * 1000, 2),
    "lookups_per_sec": round(lookups_per_sec, 0),
    "mean_us_per_lookup": round(mean_us, 4),
}
print(f"  {N_LOOKUPS:,} lookups in {elapsed_s*1000:.1f}ms  →  {lookups_per_sec:,.0f} lookups/sec  ({mean_us:.3f}µs each)")

# Plot B2
fig, axes = plt.subplots(3, 1, figsize=(8, 7), sharex=True)
axes[0].plot(altitudes_m, strengths, color=BLUE, lw=2)
axes[0].fill_between(altitudes_m, strengths, alpha=0.12, color=BLUE)
axes[0].set_ylabel("Strength (0–255)")
axes[0].set_title("B2 — Optical Flow Sensor Model vs Altitude", fontweight="bold")
axes[0].axvline(5.0, color=ORANGE, lw=1.2, ls="--", label="5 m degradation onset")
axes[0].legend(fontsize=8)

axes[1].plot(altitudes_m, qualities, color=GREEN, lw=2)
axes[1].fill_between(altitudes_m, qualities, alpha=0.12, color=GREEN)
axes[1].set_ylabel("Quality (0–255)")
axes[1].axhline(150, color=PURPLE, lw=1.2, ls="--", label="peak quality @ 3.05 m")
axes[1].legend(fontsize=8)

axes[2].plot(altitudes_m, stabilities, color=ORANGE, lw=2)
axes[2].fill_between(altitudes_m, stabilities, alpha=0.12, color=ORANGE)
axes[2].axhline(0.7, color=RED, lw=1.2, ls="--", label="stability 0.7 threshold")
axes[2].axhline(0.4, color=RED, lw=1.0, ls=":",  label="stability 0.4 threshold")
axes[2].set_ylabel("Stability (0–1)")
axes[2].set_xlabel("Altitude (m)")
axes[2].set_ylim(0, 1.05)
axes[2].legend(fontsize=8)

for ax in axes:
    ax.grid(True)
plt.tight_layout()
plt.savefig(PLOTS / "b2_sensor_interpolation.png", facecolor="white")
plt.close()
print(f"  → saved b2_sensor_interpolation.png")


# ══════════════════════════════════════════════════════════════════════════════
# B3 — TSP Route Planning Scalability
# ══════════════════════════════════════════════════════════════════════════════
print("\n[B3] TSP Route Planning Scalability ...")

def tsp_nearest_neighbor(home: tuple, flowers: list[dict]) -> list[str]:
    cx, cy = home
    remaining = list(flowers)
    route = []
    while remaining:
        best = min(remaining, key=lambda f: math.hypot(f["x"]-cx, f["y"]-cy))
        route.append(best["id"])
        cx, cy = best["x"], best["y"]
        remaining.remove(best)
    return route

FLOWER_NS = [2, 4, 6, 8, 10, 20, 50]
TSP_REPS  = 500
b3 = {}

tsp_means, tsp_p95s = [], []
for n in FLOWER_NS:
    flowers = make_flowers(n, random.Random(7))
    for _ in range(10):
        tsp_nearest_neighbor((2.0, 2.0), flowers)
    times = []
    for _ in range(TSP_REPS):
        t0 = time.perf_counter()
        tsp_nearest_neighbor((2.0, 2.0), flowers)
        times.append((time.perf_counter() - t0) * 1000)
    s = stat(times)
    b3[f"n{n}"] = {"n_flowers": n, **s}
    tsp_means.append(s["mean_ms"])
    tsp_p95s.append(s["p95_ms"])
    print(f"  n={n:3d}  mean={s['mean_ms']:.4f}ms  p95={s['p95_ms']:.4f}ms")

results["B3_tsp_planning"] = {
    "description": "Greedy nearest-neighbor TSP latency vs. flower count",
    "reps_per_n": TSP_REPS,
    "results": b3,
    "mission_n8_mean_ms": b3["n8"]["mean_ms"],
    "mission_n8_p95_ms":  b3["n8"]["p95_ms"],
}

# Plot B3
fig, ax = plt.subplots(figsize=(7, 4))
x = np.arange(len(FLOWER_NS))
bar_colors = [GREEN if n == 8 else BLUE for n in FLOWER_NS]
bars = ax.bar(x, [v*1000 for v in tsp_means], color=bar_colors, alpha=0.85, width=0.6)
ax.errorbar(x, [v*1000 for v in tsp_means],
            yerr=[[0]*len(tsp_means), [(p-m)*1000 for p,m in zip(tsp_p95s, tsp_means)]],
            fmt="none", color="#444444", capsize=4, lw=1.5, label="p95 cap")
ax.set_xticks(x)
ax.set_xticklabels([str(n) for n in FLOWER_NS])
ax.set_xlabel("Number of flowers (N)")
ax.set_ylabel("Latency (µs)")
ax.set_title("B3 — TSP Route Planning Scalability", fontweight="bold")
mission_patch = mpatches.Patch(color=GREEN, label="Mission scale (N=8)")
other_patch   = mpatches.Patch(color=BLUE,  label="Other")
ax.legend(handles=[mission_patch, other_patch], fontsize=8)
ax.grid(True, axis="y")
for bar, val in zip(bars, [v*1000 for v in tsp_means]):
    ax.text(bar.get_x() + bar.get_width()/2, val + 1, f"{val:.1f}", ha="center",
            va="bottom", fontsize=8, color="#333333")
plt.tight_layout()
plt.savefig(PLOTS / "b3_tsp_scalability.png", facecolor="white")
plt.close()
print(f"  → saved b3_tsp_scalability.png")


# ══════════════════════════════════════════════════════════════════════════════
# B4 — Full Frame Pipeline Throughput (2700 frames)
# ══════════════════════════════════════════════════════════════════════════════
print("\n[B4] Full Frame Pipeline Throughput  (2700 frames) ...")

def simulate_mission_frame(frame_idx: int, total: int) -> float:
    t = frame_idx / 30.0
    progress = t / 90.0
    battery = 100.0 - 28.0 * progress
    wp_idx = min(7, int(frame_idx / (total / 8)))
    wx, wy = MISSION_WAYPOINTS[wp_idx]
    cycle_pos = (frame_idx % (total // 8)) / (total // 8)
    if cycle_pos < 0.3:
        alt = 8.0
    elif cycle_pos < 0.5:
        alt = 8.0 - (cycle_pos - 0.3) / 0.2 * 6.5
    elif cycle_pos < 0.7:
        alt = 1.5
    else:
        alt = 1.5 + (cycle_pos - 0.7) / 0.3 * 6.5
    drone = {"x": wx, "y": wy, "z": max(0.1, alt), "yaw": frame_idx * 0.5 % 360}
    dets  = mock_detect(drone, MISSION_FLOWERS)
    dist_in   = alt * 39.37
    strength, quality = _sensor_at_dist_in(dist_in)
    stability = min(1.0, quality / 150.0)
    for d in dets:
        d["confidence"] *= (0.6 + 0.4 * stability) * (0.6 + 0.4 * strength / 255.0)
    return battery

TOTAL_FRAMES = 2700
for i in range(30):
    simulate_mission_frame(i, TOTAL_FRAMES)

frame_times = []
t_pipeline_start = time.perf_counter()
for i in range(TOTAL_FRAMES):
    t0 = time.perf_counter()
    simulate_mission_frame(i, TOTAL_FRAMES)
    frame_times.append((time.perf_counter() - t0) * 1_000_000)

total_pipeline_ms = (time.perf_counter() - t_pipeline_start) * 1000
fps = TOTAL_FRAMES / (total_pipeline_ms / 1000)

results["B4_frame_pipeline"] = {
    "description": "Full sensor→detect→confidence pipeline across 2700 mission frames",
    "total_frames": TOTAL_FRAMES,
    "total_time_ms": round(total_pipeline_ms, 2),
    "frames_per_sec": round(fps, 1),
    "mean_frame_us": round(float(np.mean(frame_times)), 2),
    "median_frame_us": round(float(np.median(frame_times)), 2),
    "p95_frame_us": round(float(np.percentile(frame_times, 95)), 2),
    "p99_frame_us": round(float(np.percentile(frame_times, 99)), 2),
    "min_frame_us": round(float(np.min(frame_times)), 2),
    "max_frame_us": round(float(np.max(frame_times)), 2),
}
print(f"  2700 frames in {total_pipeline_ms:.1f}ms  →  {fps:.0f} frames/sec")
print(f"  mean={np.mean(frame_times):.2f}µs  p99={np.percentile(frame_times,99):.2f}µs  max={np.max(frame_times):.2f}µs")

# Plot B4
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4))

ax1.hist(frame_times, bins=60, color=BLUE, alpha=0.8, edgecolor="white")
ax1.axvline(np.mean(frame_times), color=RED, lw=1.8, label=f"mean {np.mean(frame_times):.1f} µs")
ax1.axvline(np.percentile(frame_times,99), color=ORANGE, lw=1.8, ls="--",
            label=f"p99 {np.percentile(frame_times,99):.1f} µs")
ax1.set_xlabel("Frame latency (µs)")
ax1.set_ylabel("Count")
ax1.set_title("B4 — Frame Latency Distribution", fontweight="bold")
ax1.legend(fontsize=8)
ax1.grid(True, axis="y")

stride = 10
idx = np.arange(0, TOTAL_FRAMES, stride)
ft_stride = [frame_times[i] for i in idx]
ax2.plot(idx / 30, ft_stride, color=BLUE, lw=0.7, alpha=0.8)
ax2.axhline(np.mean(frame_times), color=RED, lw=1.5, ls="--", label="mean")
ax2.set_xlabel("Mission time (s)")
ax2.set_ylabel("Frame latency (µs)")
ax2.set_title("B4 — Frame Latency Over Mission", fontweight="bold")
ax2.legend(fontsize=8)
ax2.grid(True)

plt.tight_layout()
plt.savefig(PLOTS / "b4_frame_pipeline_histogram.png", facecolor="white")
plt.close()
print(f"  → saved b4_frame_pipeline_histogram.png")


# ══════════════════════════════════════════════════════════════════════════════
# B5 — Detection Confidence vs Altitude Sweep
# ══════════════════════════════════════════════════════════════════════════════
print("\n[B5] Detection Confidence vs Altitude Sweep ...")

target_flower = {"id": "target", "x": 10.0, "y": 10.0, "radius": 1.0}
altitudes_sweep = np.linspace(8.0, 1.5, 100)
h_offsets = [0.0, 1.0, 2.0, 4.0]
colors_b5 = [BLUE, GREEN, ORANGE, RED]

b5_curves = {}
strengths_b5, quals_b5 = [], []
for h_off in h_offsets:
    confs = []
    for alt in altitudes_sweep:
        drone = {"x": 10.0 + h_off, "y": 10.0, "z": alt, "yaw": 0.0}
        dets  = mock_detect(drone, [target_flower])
        confs.append(dets[0]["confidence"] if dets else 0.0)
    b5_curves[f"offset_{h_off}m"] = {
        "h_offset_m": h_off,
        "altitudes": list(altitudes_sweep),
        "confidences": confs,
        "peak_confidence": max(confs),
        "lock_altitude_m": float(altitudes_sweep[next((i for i,c in enumerate(confs) if c >= 0.75), -1)])
                           if any(c >= 0.75 for c in confs) else None,
    }

# sensor curve for 0m offset
for alt in altitudes_sweep:
    dist_in = alt * 39.37
    s, q = _sensor_at_dist_in(dist_in)
    strengths_b5.append(s)
    quals_b5.append(q)

results["B5_confidence_altitude"] = {
    "description": "Detection confidence vs altitude sweep at 4 horizontal offsets",
    "target_lock_threshold": 0.75,
    "candidate_threshold": 0.40,
    "curves": b5_curves,
}

# Plot B5
fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(8, 7), sharex=True)

for h_off, col in zip(h_offsets, colors_b5):
    data = b5_curves[f"offset_{h_off}m"]
    ax1.plot(altitudes_sweep[::-1], data["confidences"][::-1],
             color=col, lw=2, label=f"{h_off} m offset")

ax1.axhline(0.75, color=RED,    lw=1.5, ls="--", label="lock threshold 0.75")
ax1.axhline(0.40, color=ORANGE, lw=1.2, ls=":",  label="candidate threshold 0.40")
ax1.fill_between(altitudes_sweep[::-1],
                 b5_curves["offset_0.0m"]["confidences"][::-1],
                 alpha=0.08, color=BLUE)
ax1.set_ylabel("Detection confidence")
ax1.set_title("B5 — Detection Confidence vs Altitude (target approach)", fontweight="bold")
ax1.legend(fontsize=8, ncol=2)
ax1.set_ylim(-0.02, 1.05)
ax1.grid(True)

ax2.plot(altitudes_sweep[::-1], strengths_b5[::-1], color=BLUE,  lw=2, label="Strength (0–255)")
ax2.plot(altitudes_sweep[::-1], quals_b5[::-1],     color=GREEN, lw=2, label="Quality (0–255)")
ax2.set_ylabel("Sensor raw value")
ax2.set_xlabel("Altitude (m)")
ax2.set_title("B5 — Sensor State During Descent (0 m offset)", fontweight="bold")
ax2.legend(fontsize=8)
ax2.grid(True)
ax2.invert_xaxis()
ax1.invert_xaxis()

plt.tight_layout()
plt.savefig(PLOTS / "b5_confidence_altitude.png", facecolor="white")
plt.close()

b5_lock_0m = b5_curves["offset_0.0m"]["lock_altitude_m"]
print(f"  Lock threshold first reached: {b5_lock_0m:.2f}m (0m offset)")
print(f"  → saved b5_confidence_altitude.png")


# ══════════════════════════════════════════════════════════════════════════════
# B6 — UCB1 Confidence Bandit Convergence
# ══════════════════════════════════════════════════════════════════════════════
print("\n[B6] UCB1 Confidence Bandit Convergence ...")

BANDIT_STEPS = 500
bandit = ConfidenceBandit()
rng = random.Random(99)
arm_sel_history   = []
cum_rewards       = []
cumulative_reward = 0.0
phases = ["scanning", "descent", "hover_align"]

t_bandit_start = time.perf_counter()
for step in range(BANDIT_STEPS):
    phase     = phases[step % 3]
    stability = rng.uniform(0.3, 1.0)
    battery   = 100.0 - step * 0.05
    ctx_phase = ("hover" if phase == "hover_align" else
                 "approach" if phase == "descent" else "scanning")
    ctx_qual  = "high" if stability > 0.7 else "med" if stability >= 0.4 else "low"
    ctx_bat   = "high" if battery >= 50 else "low"
    key = f"{ctx_phase}_{ctx_qual}_{ctx_bat}"
    arm_idx = bandit.select(key)
    threshold = ARMS[arm_idx]
    if phase == "hover_align":
        success_prob = 0.9 if threshold == 0.75 else 0.6 if threshold == 0.60 else 0.3
    elif phase == "descent":
        success_prob = 0.75 if threshold == 0.75 else 0.7 if threshold == 0.60 else 0.5
    else:
        success_prob = 0.8 if threshold == 0.40 else 0.5 if threshold == 0.60 else 0.3
    success = rng.random() < success_prob
    reward  = 1.0 if success else -1.0
    bandit.update(key, arm_idx, reward)
    arm_sel_history.append(arm_idx)
    cumulative_reward += reward
    cum_rewards.append(cumulative_reward)

bandit_time_ms = (time.perf_counter() - t_bandit_start) * 1000
steps_per_sec  = BANDIT_STEPS / (bandit_time_ms / 1000)
arm_counts_total = [arm_sel_history.count(i) for i in range(3)]

results["B6_ucb1_bandit"] = {
    "description": "UCB1 confidence bandit over 500-step simulated mission",
    "steps": BANDIT_STEPS,
    "total_time_ms": round(bandit_time_ms, 3),
    "steps_per_sec": round(steps_per_sec, 0),
    "arm_selection_counts": {
        "0.40": arm_counts_total[0],
        "0.60": arm_counts_total[1],
        "0.75": arm_counts_total[2],
    },
    "final_cumulative_reward": round(cum_rewards[-1], 2),
    "mean_reward_per_step": round(cum_rewards[-1] / BANDIT_STEPS, 4),
}
print(f"  {BANDIT_STEPS} steps in {bandit_time_ms:.2f}ms  →  {steps_per_sec:,.0f} steps/sec")
print(f"  Arm selections: 0.40→{arm_counts_total[0]}  0.60→{arm_counts_total[1]}  0.75→{arm_counts_total[2]}")

# Plot B6
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4))

arm_labels  = ["0.40\n(scanning)", "0.60\n(mid)", "0.75\n(lock)"]
arm_colors  = [ORANGE, TEAL, GREEN]
bars = ax1.bar(arm_labels, arm_counts_total, color=arm_colors, alpha=0.85,
               edgecolor="white", width=0.5)
for bar, cnt in zip(bars, arm_counts_total):
    ax1.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 2,
             str(cnt), ha="center", va="bottom", fontsize=10, fontweight="bold")
ax1.set_ylabel("Times selected")
ax1.set_title("B6 — UCB1 Arm Selection\n(500-step mission simulation)", fontweight="bold")
ax1.grid(True, axis="y")

ax2.plot(cum_rewards, color=BLUE, lw=1.8, label="Cumulative reward")
ax2.fill_between(range(BANDIT_STEPS), cum_rewards, alpha=0.12, color=BLUE)
ax2.axhline(0, color=GRAY, lw=1, ls="--")
ax2.set_xlabel("Bandit step")
ax2.set_ylabel("Cumulative reward")
ax2.set_title("B6 — Bandit Cumulative Reward Convergence", fontweight="bold")
ax2.legend(fontsize=8)
ax2.grid(True)

plt.tight_layout()
plt.savefig(PLOTS / "b6_bandit_convergence.png", facecolor="white")
plt.close()
print(f"  → saved b6_bandit_convergence.png")


# ══════════════════════════════════════════════════════════════════════════════
# B7 — LLM Agent /decide Latency
# ══════════════════════════════════════════════════════════════════════════════
print("\n[B7] LLM Agent /decide Latency  (Claude Haiku) ...")

LLM_CALLS = 10
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

b7_times: list[float] = []
b7_errors: list[str]  = []
b7_tool_calls_per_decision: list[int] = []

sample_states = [
    {"phase": "scanning",          "drone": {"x": 4.5,  "y": 3.5,  "z": 8.0},
     "battery_pct": 98, "sensor": {"ofStability": 0.85}, "time": 5.0,
     "flowers": [{"id":"f1","x":4.5,"y":3.5,"state":"undiscovered","confidence":0.0}],
     "discovered_ids": [], "pollinated_ids": []},
    {"phase": "candidate_detected","drone": {"x": 4.5,  "y": 3.5,  "z": 8.0},
     "battery_pct": 96, "sensor": {"ofStability": 0.80}, "time": 8.0,
     "flowers": [{"id":"f1","x":4.5,"y":3.5,"state":"detected","confidence":0.52}],
     "discovered_ids": ["f1"], "pollinated_ids": []},
    {"phase": "hover_align",       "drone": {"x": 8.0,  "y": 5.0,  "z": 1.5},
     "battery_pct": 91, "sensor": {"ofStability": 0.92}, "time": 22.0,
     "flowers": [{"id":"f1","x":4.5,"y":3.5,"state":"pollinated","confidence":0.9},
                 {"id":"f2","x":8.0,"y":5.0,"state":"target","confidence":0.88}],
     "discovered_ids": ["f1","f2"], "pollinated_ids": ["f1"]},
    {"phase": "transit",           "drone": {"x": 12.0, "y": 4.0,  "z": 8.0},
     "battery_pct": 85, "sensor": {"ofStability": 0.75}, "time": 40.0,
     "flowers": [{"id":f"f{i}","x":MISSION_WAYPOINTS[i][0],"y":MISSION_WAYPOINTS[i][1],
                  "state":"pollinated" if i<2 else "undiscovered","confidence":0.0}
                 for i in range(8)],
     "discovered_ids": ["f1","f2"], "pollinated_ids": ["f1","f2"]},
    {"phase": "scanning",          "drone": {"x": 16.5, "y": 10.5, "z": 8.0},
     "battery_pct": 72, "sensor": {"ofStability": 0.60}, "time": 70.0,
     "flowers": [{"id":f"f{i}","x":MISSION_WAYPOINTS[i][0],"y":MISSION_WAYPOINTS[i][1],
                  "state":"pollinated" if i<5 else "undiscovered","confidence":0.0}
                 for i in range(8)],
     "discovered_ids": [f"f{i}" for i in range(6)],
     "pollinated_ids": [f"f{i}" for i in range(5)]},
]
llm_states = [sample_states[i % len(sample_states)] for i in range(LLM_CALLS)]

async def _run_b7() -> None:
    try:
        from langchain_anthropic import ChatAnthropic
        from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
        from langchain_core.tools import StructuredTool
        import json as _json, math as _math

        def _tsp(drone_x, drone_y, battery_pct, flowers_json="[]",
                 prioritize_confidence=False):
            flowers = _json.loads(flowers_json) if isinstance(flowers_json, str) else flowers_json
            undiscovered = [f for f in flowers if f.get("state") not in ("pollinated",)]
            if not undiscovered:
                return _json.dumps({"route": [], "estimated_flowers_reachable": 0})
            cx, cy = drone_x, drone_y
            remaining = list(undiscovered)
            route = []
            while remaining:
                best = min(remaining, key=lambda f: _math.hypot(f.get("x",0)-cx, f.get("y",0)-cy))
                route.append(best["id"])
                cx, cy = best.get("x",cx), best.get("y",cy)
                remaining.remove(best)
            return _json.dumps({"route": route,
                                "estimated_flowers_reachable": max(0,min(len(route),int((battery_pct-20)/8)))})

        def _bat(battery_pct, remaining_flowers, avg_flower_distance=3.0):
            return _json.dumps({"reachable_flowers": max(0,min(remaining_flowers,
                int((battery_pct-20)/(8+avg_flower_distance*0.5))))})

        def _conf(phase, of_stability, battery_pct, flowers_remaining=0):
            base = 0.40 if phase in ("scanning","planning") else 0.75
            return _json.dumps({"threshold": base})

        def _scan(garden_size, discovered_count, total_passes, current_pass=0):
            sp = 3.5 if discovered_count > 3 else 5.5 if discovered_count==0 else 4.5
            return _json.dumps({"spacing": sp, "passes": max(2, int(garden_size/sp))})

        lc_tools = [
            StructuredTool.from_function(_tsp,  name="compute_tsp_route",
                description="Compute TSP route. flowers_json is JSON array."),
            StructuredTool.from_function(_bat,  name="estimate_battery_range",
                description="Estimate reachable flowers from battery."),
            StructuredTool.from_function(_conf, name="recommend_confidence_threshold",
                description="Recommend confidence threshold for phase."),
            StructuredTool.from_function(_scan, name="plan_scan_pattern",
                description="Recommend scan spacing and passes."),
        ]

        model = ChatAnthropic(
            model="claude-haiku-4-5-20251001",
            api_key=ANTHROPIC_API_KEY,
            max_tokens=512,
        ).bind_tools(lc_tools)

        sys_msg = ("You are an autonomous drone mission planner. "
                   "Use tools to analyse the situation, then give a concise decision.")

        def _user_msg(state):
            d = state.get("drone", {})
            return (
                f"Phase: {state.get('phase')}  |  "
                f"Pos: ({d.get('x',0):.1f}, {d.get('y',0):.1f}) z={d.get('z',0):.1f}m  |  "
                f"Battery: {state.get('battery_pct',100):.0f}%  |  "
                f"Stability: {state.get('sensor',{}).get('ofStability',0.8):.2f}  |  "
                f"Pollinated: {len(state.get('pollinated_ids',[]))}/{len(state.get('flowers',[]))}\n"
                f"Flowers JSON: {_json.dumps(state.get('flowers',[]))}\n"
                f"Decide: continue, replan, adjust threshold, or abort target?"
            )

        for i, state in enumerate(llm_states):
            print(f"  call {i+1}/{LLM_CALLS} phase={state['phase']}...", end=" ", flush=True)
            t0 = time.perf_counter()
            n_tool_calls = 0
            try:
                messages = [SystemMessage(content=sys_msg),
                            HumanMessage(content=_user_msg(state))]
                for _round in range(3):
                    resp = await asyncio.get_event_loop().run_in_executor(
                        None, lambda m=messages: model.invoke(m))
                    tcs = getattr(resp, "tool_calls", []) or []
                    if not tcs:
                        break
                    n_tool_calls += len(tcs)
                    messages.append(resp)
                    tool_msgs = []
                    for tc in tcs:
                        fn, args = tc.get("name",""), tc.get("args",{})
                        try:
                            raw = {"compute_tsp_route": _tsp,
                                   "estimate_battery_range": _bat,
                                   "recommend_confidence_threshold": _conf,
                                   "plan_scan_pattern": _scan}.get(fn, lambda **k: '{}')(**args)
                        except Exception as e:
                            raw = _json.dumps({"error": str(e)})
                        tool_msgs.append(ToolMessage(content=raw, tool_call_id=tc.get("id","")))
                    messages.extend(tool_msgs)
                elapsed = (time.perf_counter() - t0) * 1000
                b7_times.append(elapsed)
                b7_tool_calls_per_decision.append(n_tool_calls)
                print(f"{elapsed:.0f}ms  ({n_tool_calls} tool calls)")
            except Exception as ex:
                b7_errors.append(str(ex))
                print(f"ERROR: {ex}")
    except ImportError as e:
        print(f"  SKIP — langchain-anthropic not importable: {e}")
    except Exception as e:
        print(f"  SKIP — {e}")

if not ANTHROPIC_API_KEY:
    print("  SKIP — ANTHROPIC_API_KEY not set")
    results["B7_agent_latency"] = {"skipped": True, "reason": "no ANTHROPIC_API_KEY"}
else:
    asyncio.run(_run_b7())
    if b7_times:
        b7s = stat(b7_times)
        results["B7_agent_latency"] = {
            "description": "Claude Haiku /decide end-to-end latency via LangChain",
            "model": "claude-haiku-4-5-20251001",
            "n_calls": len(b7_times),
            "n_errors": len(b7_errors),
            "mean_tool_calls_per_decision": round(sum(b7_tool_calls_per_decision)/max(1,len(b7_tool_calls_per_decision)), 2),
            **{k: v for k, v in b7s.items()},
        }
        # Plot B7
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 4))
        bar_colors_b7 = [GREEN if t <= np.median(b7_times) else BLUE if t <= np.percentile(b7_times,75) else ORANGE
                         for t in b7_times]
        ax1.barh(range(len(b7_times)), b7_times, color=bar_colors_b7, alpha=0.85)
        ax1.axvline(np.mean(b7_times), color=RED, lw=1.8, ls="--",
                    label=f"mean {np.mean(b7_times):.0f} ms")
        ax1.set_yticks(range(len(b7_times)))
        ax1.set_yticklabels([f"Call {i+1}" for i in range(len(b7_times))], fontsize=8)
        ax1.set_xlabel("Latency (ms)")
        ax1.set_title("B7 — Claude Haiku /decide Latency", fontweight="bold")
        ax1.legend(fontsize=8)
        ax1.grid(True, axis="x")

        labels = ["mean", "median", "p95", "min", "max"]
        vals   = [b7s["mean_ms"], b7s["median_ms"], b7s["p95_ms"], b7s["min_ms"], b7s["max_ms"]]
        colors_b7 = [BLUE, GREEN, ORANGE, GREEN, RED]
        ax2.bar(labels, vals, color=colors_b7, alpha=0.85, edgecolor="white")
        for i, v in enumerate(vals):
            ax2.text(i, v + max(vals)*0.01, f"{v:.0f}", ha="center", fontsize=9)
        ax2.set_ylabel("Latency (ms)")
        ax2.set_title("B7 — Latency Summary", fontweight="bold")
        ax2.grid(True, axis="y")
        plt.tight_layout()
        plt.savefig(PLOTS / "b7_agent_latency.png", facecolor="white")
        plt.close()
        print(f"  mean={b7s['mean_ms']:.0f}ms  median={b7s['median_ms']:.0f}ms  p95={b7s['p95_ms']:.0f}ms")
        print(f"  → saved b7_agent_latency.png")
    else:
        results["B7_agent_latency"] = {"skipped": True, "reason": "all calls errored", "errors": b7_errors}


# ══════════════════════════════════════════════════════════════════════════════
# Save JSON + markdown report
# ══════════════════════════════════════════════════════════════════════════════
results["metadata"] = {
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "python_version": sys.version.split()[0],
    "platform": sys.platform,
    "all_timings_from": "time.perf_counter()",
    "note": "All latency values measured on development machine, not Raspberry Pi 4 hardware.",
}

with open(OUT / "benchmark_results.json", "w") as f:
    json.dump(results, f, indent=2)

b1 = results["B1_mock_detector"]
b2 = results["B2_sensor_interpolation"]
b3r = results["B3_tsp_planning"]
b4 = results["B4_frame_pipeline"]
b5 = results["B5_confidence_altitude"]
b6 = results["B6_ucb1_bandit"]
b7d = results.get("B7_agent_latency", {})

md = f"""# Benchmark Report — Autonomous Pollination UAV
**Generated:** {results['metadata']['timestamp']}
**Environment:** Python {results['metadata']['python_version']} on {results['metadata']['platform']}
> All timings from `time.perf_counter()` on development machine (not Raspberry Pi 4).

---

## B1 — Mock Detector Latency (µs)
*{REPS} calls/cell, {WARMUP} warmup discarded*

| Altitude | N=1 | N=3 | N=5 | N=8 | N=10 |
|---|---|---|---|---|---|
"""
for alt in ALTITUDES:
    row = f"| **{alt} m** |"
    for n in FLOWER_CNTS:
        cell = b1["grid"][f"alt_{alt}m_n{n}"]
        row += f" {cell['mean_ms']*1000:.1f} |"
    md += row + "\n"

b1_n8_1_5 = b1["grid"]["alt_1.5m_n8"]
b1_n8_8   = b1["grid"]["alt_8.0m_n8"]
md += f"""
- **Overall mean:** {b1['overall_mean_ms']*1000:.1f} µs — **overall p99:** {b1['overall_p99_ms']*1000:.1f} µs
- **Mission scenario (hover, N=8):** mean {b1_n8_1_5['mean_ms']*1000:.1f} µs — p99 {b1_n8_1_5['p99_ms']*1000:.1f} µs
- **Patrol scenario (alt=8 m, N=8):** mean {b1_n8_8['mean_ms']*1000:.1f} µs — p99 {b1_n8_8['p99_ms']*1000:.1f} µs

---

## B2 — Sensor Interpolation Throughput
*{b2['n_lookups']:,} random altitude lookups*

| Metric | Value |
|---|---|
| Total time | {b2['total_time_ms']:.1f} ms |
| **Throughput** | **{b2['lookups_per_sec']:,.0f} lookups/sec** |
| Mean latency | {b2['mean_us_per_lookup']:.3f} µs/lookup |

---

## B3 — TSP Route Planning Scalability
*{b3r['reps_per_n']} trials per N*

| N flowers | Mean (µs) | p95 (µs) |
|---|---|---|
"""
for n in FLOWER_NS:
    r = b3r["results"][f"n{n}"]
    star = " ←mission" if n == 8 else ""
    md += f"| {n}{star} | {r['mean_ms']*1000:.2f} | {r['p95_ms']*1000:.2f} |\n"

md += f"""
- **Mission scale (N=8):** mean {b3r['mission_n8_mean_ms']*1000:.2f} µs — leaves >99.99% of 50 ms loop budget available.

---

## B4 — Full Frame Pipeline Throughput
*sensor lookup + detect (8 flowers) + confidence coupling × {TOTAL_FRAMES} frames*

| Metric | Value |
|---|---|
| Total pipeline time | {b4['total_time_ms']:.1f} ms |
| **Frames per second** | **{b4['frames_per_sec']:.0f} fps** |
| Mean frame latency | {b4['mean_frame_us']:.1f} µs |
| p99 frame latency | {b4['p99_frame_us']:.1f} µs |
| Worst frame | {b4['max_frame_us']:.1f} µs |

Pipeline sustains **{b4['frames_per_sec']:.0f} fps** — {b4['frames_per_sec']/30:.0f}× faster than 30 fps simulation target.

---

## B5 — Detection Confidence vs Altitude

| Horizontal offset | Lock threshold (0.75) first reached |
|---|---|
"""
for h_off in h_offsets:
    lk = b5["curves"][f"offset_{h_off}m"]["lock_altitude_m"]
    md += f"| {h_off} m | {f'{lk:.2f} m' if lk else 'never reached'} |\n"

md += f"""
---

## B6 — UCB1 Confidence Bandit

| Metric | Value |
|---|---|
| Steps | {b6['steps']} |
| Total time | {b6['total_time_ms']:.2f} ms |
| **Throughput** | **{b6['steps_per_sec']:,.0f} steps/sec** |
| Arm 0.40 selected | {b6['arm_selection_counts']['0.40']} |
| Arm 0.60 selected | {b6['arm_selection_counts']['0.60']} |
| Arm 0.75 selected | {b6['arm_selection_counts']['0.75']} |
| Final cumulative reward | {b6['final_cumulative_reward']:.1f} |
| Mean reward/step | {b6['mean_reward_per_step']:.4f} |

---

## B7 — LLM Agent /decide Latency
"""
if b7d.get("skipped"):
    md += f"\n*Skipped: {b7d.get('reason')}*\n\n"
else:
    md += f"""
| Metric | Value |
|---|---|
| Model | {b7d.get('model')} |
| Calls | {b7d.get('n_calls')} |
| **Mean latency** | **{b7d.get('mean_ms', 0):.0f} ms** |
| Median latency | {b7d.get('median_ms', 0):.0f} ms |
| p95 latency | {b7d.get('p95_ms', 0):.0f} ms |
| Mean tool calls/decision | {b7d.get('mean_tool_calls_per_decision')} |

"""

md += """---

## Summary — Poster-Ready Numbers

| Metric | Measured Value | Source |
|---|---|---|
"""
md += f"| Mock detector (hover, 8 flowers) | {b1_n8_1_5['mean_ms']*1000:.1f} µs mean | B1 |\n"
md += f"| Mock detector p99 | {b1['overall_p99_ms']*1000:.1f} µs | B1 |\n"
md += f"| Sensor interpolation throughput | {b2['lookups_per_sec']:,.0f} lookups/sec | B2 |\n"
md += f"| TSP planning (N=8) | {b3r['mission_n8_mean_ms']*1000:.2f} µs | B3 |\n"
md += f"| End-to-end pipeline | {b4['frames_per_sec']:.0f} fps | B4 |\n"
md += f"| Target lock altitude (0 m offset) | {b5_lock_0m:.2f} m | B5 |\n"
md += f"| UCB1 bandit throughput | {b6['steps_per_sec']:,.0f} steps/sec | B6 |\n"
if not b7d.get("skipped") and b7_times:
    md += f"| Claude Haiku /decide mean | {b7d.get('mean_ms',0):.0f} ms | B7 |\n"

with open(OUT / "benchmark_report.md", "w") as f:
    f.write(md)

print(f"\n✓ benchmark_results.json written")
print(f"✓ benchmark_report.md written")
print(f"\n{'='*66}")
print(f"  All results in: {OUT}/")
print(f"{'='*66}\n")
