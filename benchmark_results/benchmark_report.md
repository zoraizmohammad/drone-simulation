# Benchmark Report — Autonomous Pollination UAV
**Generated:** 2026-04-13T15:09:30Z
**Environment:** Python 3.14.2 on darwin
> All timings from `time.perf_counter()` on development machine (not Raspberry Pi 4).

---

## B1 — Mock Detector Latency (µs)
*1000 calls/cell, 20 warmup discarded*

| Altitude | N=1 | N=3 | N=5 | N=8 | N=10 |
|---|---|---|---|---|---|
| **1.5 m** | 2.4 | 3.7 | 5.0 | 7.1 | 8.5 |
| **3.0 m** | 2.9 | 4.3 | 5.6 | 9.2 | 10.7 |
| **5.0 m** | 3.7 | 6.6 | 8.0 | 13.0 | 14.5 |
| **8.0 m** | 5.9 | 10.3 | 14.6 | 20.9 | 25.3 |

- **Overall mean:** 9.1 µs — **overall p99:** 27.4 µs
- **Mission scenario (hover, N=8):** mean 7.1 µs — p99 7.3 µs
- **Patrol scenario (alt=8 m, N=8):** mean 20.9 µs — p99 21.4 µs

---

## B2 — Sensor Interpolation Throughput
*100,000 random altitude lookups*

| Metric | Value |
|---|---|
| Total time | 198.3 ms |
| **Throughput** | **504,218 lookups/sec** |
| Mean latency | 1.983 µs/lookup |

---

## B3 — TSP Route Planning Scalability
*500 trials per N*

| N flowers | Mean (µs) | p95 (µs) |
|---|---|---|
| 2 | 1.30 | 1.30 |
| 4 | 3.10 | 3.20 |
| 6 | 5.50 | 5.60 |
| 8 ←mission | 8.60 | 8.80 |
| 10 | 12.70 | 12.80 |
| 20 | 42.40 | 42.90 |
| 50 | 237.40 | 240.60 |

- **Mission scale (N=8):** mean 8.60 µs — leaves >99.99% of 50 ms loop budget available.

---

## B4 — Full Frame Pipeline Throughput
*sensor lookup + detect (8 flowers) + confidence coupling × 2700 frames*

| Metric | Value |
|---|---|
| Total pipeline time | 45.3 ms |
| **Frames per second** | **59571 fps** |
| Mean frame latency | 16.6 µs |
| p99 frame latency | 26.7 µs |
| Worst frame | 37.5 µs |

Pipeline sustains **59571 fps** — 1986× faster than 30 fps simulation target.

---

## B5 — Detection Confidence vs Altitude

| Horizontal offset | Lock threshold (0.75) first reached |
|---|---|
| 0.0 m | 2.55 m |
| 1.0 m | never reached |
| 2.0 m | never reached |
| 4.0 m | never reached |

---

## B6 — UCB1 Confidence Bandit

| Metric | Value |
|---|---|
| Steps | 500 |
| Total time | 1.55 ms |
| **Throughput** | **323,328 steps/sec** |
| Arm 0.40 selected | 182 |
| Arm 0.60 selected | 88 |
| Arm 0.75 selected | 230 |
| Final cumulative reward | 242.0 |
| Mean reward/step | 0.4840 |

---

## B7 — LLM Agent /decide Latency

*Skipped: no ANTHROPIC_API_KEY*

---

## Summary — Poster-Ready Numbers

| Metric | Measured Value | Source |
|---|---|---|
| Mock detector (hover, 8 flowers) | 7.1 µs mean | B1 |
| Mock detector p99 | 27.4 µs | B1 |
| Sensor interpolation throughput | 504,218 lookups/sec | B2 |
| TSP planning (N=8) | 8.60 µs | B3 |
| End-to-end pipeline | 59571 fps | B4 |
| Target lock altitude (0 m offset) | 2.55 m | B5 |
| UCB1 bandit throughput | 323,328 steps/sec | B6 |
