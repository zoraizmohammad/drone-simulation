# Benchmark Report — Autonomous Pollination UAV
**Generated:** 2026-04-13T04:58:41Z
**Environment:** Python 3.14.2 on darwin
**Note:** All timings from `time.perf_counter()` on development machine (not Raspberry Pi 4).

---

## B1 — Mock Detector Latency

Physics-based inference pipeline (sensor interpolation + camera projection + confidence coupling).
**1000 timed calls per cell**, with 20 warmup calls discarded.

| Altitude | N=1 | N=3 | N=5 | N=8 | N=10 |
|---|---|---|---|---|---|
| **1.5m** | 1.1µs | 1.9µs | 2.4µs | 3.6µs | 4.2µs |
| **3.0m** | 1.5µs | 2.1µs | 2.8µs | 4.7µs | 5.4µs |
| **5.0m** | 1.9µs | 3.3µs | 4.0µs | 6.7µs | 7.4µs |
| **8.0m** | 3.0µs | 5.3µs | 7.4µs | 10.5µs | 12.7µs |

**Overall mean latency:** 4.6 µs
**Overall p99 latency:** 13.3 µs
**Mission scenario (alt=1.5m, N=8):** mean=3.6µs  p99=3.9µs
**Patrol scenario (alt=8.0m, N=8):** mean=10.5µs  p99=11.0µs

---

## B2 — Sensor Interpolation Throughput

100,000 altitude lookups via smooth-step binary-search interpolation engine.

| Metric | Value |
|---|---|
| Total time | 99.0 ms |
| Throughput | **1,009,709 lookups/sec** |
| Mean latency per lookup | 0.990 µs |

Sensor quality peaks at **3.05m altitude** (quality=150, strength=85), consistent with real CSV data.
Degradation onset at **5.0m** (strength drops below 45, quality below 130).

---

## B3 — TSP Route Planning Scalability

Greedy nearest-neighbor TSP, 500 trials per flower count.

| N flowers | Mean (µs) | p95 (µs) |
|---|---|---|
| 2 | 0.70 | 0.70 |
| 4 | 1.60 | 1.70 |
| 6 | 2.90 | 3.00 |
| 8 | 4.50 | 4.70 |
| 10 | 6.70 | 6.80 |
| 20 | 22.40 | 22.90 |
| 50 | 124.30 | 126.00 |

**Mission scale (N=8):** mean=4.50µs  p95=4.70µs
Route planning is effectively instantaneous at mission scale — leaves >99.99% of the 50ms hardware loop budget available.

---

## B4 — Full Frame Pipeline Throughput

Sensor lookup + mock detect (8 flowers) + confidence coupling, across all 2700 mission frames.

| Metric | Value |
|---|---|
| Total pipeline time | 22.8 ms |
| **Frames per second** | **118273 fps** |
| Mean frame latency | 8.4 µs |
| Median frame latency | 8.8 µs |
| p95 frame latency | 12.7 µs |
| p99 frame latency | 13.6 µs |
| Worst frame | 17.5 µs |

The detection pipeline can sustain **118273 fps** — **3942× faster than the 30fps simulation target** and **5914× faster than the 20Hz hardware loop**.

---

## B5 — Detection Confidence vs Altitude

Drone descending from 8.0m → 1.5m toward a target flower at 4 horizontal offsets.

| Horizontal offset | Lock threshold (0.75) first reached |
|---|---|
| 0.0m | 2.55m |
| 1.0m | never reached |
| 2.0m | never reached |
| 4.0m | never reached |

At 0m offset, confidence rises from **~0** at 8m patrol altitude to **>0.75** lock threshold at **2.55m**.
At 2m horizontal offset, confidence peaks below the lock threshold — requiring the drone to approach closer.
Detection confidence is modulated by real sensor strength and quality data throughout descent.

---

## B6 — UCB1 Confidence Bandit Convergence

500-step simulated mission with phase-conditioned reward functions (hover→0.75 arm, scanning→0.40 arm).

| Metric | Value |
|---|---|
| Steps | 500 |
| Total time | 0.73 ms |
| **Throughput** | **683,839 bandit steps/sec** |
| Arm 0.40 selections | 182 |
| Arm 0.60 selections | 88 |
| Arm 0.75 selections | 230 |
| Final cumulative reward | 242.0 |
| Mean reward/step | 0.4840 |

---

## B7 — LLM Agent /decide Latency

*Skipped: no ANTHROPIC_API_KEY*
---

## Summary — Poster-Ready Numbers

| Metric | Measured Value | Benchmark |
|---|---|---|
| Mock detector mean latency (8 flowers, 1.5m) | 3.6 µs | B1 |
| Mock detector p99 latency | 13.3 µs | B1 |
| Sensor interpolation throughput | 1,009,709 lookups/sec | B2 |
| TSP planning (N=8 flowers) | 4.50 µs | B3 |
| End-to-end pipeline throughput | 118273 fps | B4 |
| Target lock altitude (0m offset) | 2.55 m | B5 |
| UCB1 bandit throughput | 683,839 steps/sec | B6 |

---

## Figures

- `plots/b1_mock_detector_heatmap.png` — Latency heatmap (altitude × flower count)
- `plots/b2_sensor_interpolation.png` — Sensor strength/quality/stability vs altitude
- `plots/b3_tsp_scalability.png` — TSP latency vs flower count
- `plots/b4_frame_pipeline_histogram.png` — Frame latency distribution + timeline
- `plots/b5_confidence_altitude.png` — Detection confidence during descent
- `plots/b6_bandit_convergence.png` — UCB1 arm selection + cumulative reward

