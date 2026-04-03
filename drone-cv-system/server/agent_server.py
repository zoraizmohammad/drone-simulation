"""
FastAPI agent server for the autonomous pollinator drone AI planner.

Endpoints:
  POST /decide      — LLM planning decision with tool_use (Claude claude-haiku-4-5-20251001)
  GET  /stream      — SSE streaming mission commentary
  WS   /agent       — WebSocket mirror of /decide
  GET  /health      — agent server status
  GET  /metrics     — decision/override/latency metrics
  GET  /decisions/recent — last 10 decisions
  POST /feedback    — reward signal for confidence bandit

Port: 8766
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import sys
import time
from collections import deque
from typing import Any, AsyncIterator

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

try:
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import StreamingResponse
    import uvicorn
except ImportError:
    print(
        "Missing fastapi/uvicorn. Run:\n"
        "  pip install -r drone-cv-system/server/requirements_agent.txt",
        file=sys.stderr,
    )
    sys.exit(1)

try:
    import anthropic as _anthropic_mod
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False
    _anthropic_mod = None  # type: ignore

try:
    from confidence_bandit import ConfidenceBandit
    bandit = ConfidenceBandit()
    BANDIT_AVAILABLE = True
except Exception:
    bandit = None  # type: ignore
    BANDIT_AVAILABLE = False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
log = logging.getLogger("agent_server")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL = "claude-haiku-4-5-20251001"

# ── Metrics state ────────────────────────────────────────────────────────────
_decisions_total = 0
_overrides_issued = 0
_decision_times: deque[float] = deque(maxlen=50)
_recent_decisions: deque[dict] = deque(maxlen=10)

# ── Tool definitions ─────────────────────────────────────────────────────────
TOOLS = [
    {
        "name": "compute_tsp_route",
        "description": (
            "Compute optimized TSP visit order for flowers given drone position and "
            "battery level. Returns ordered list of flower IDs."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "drone_x": {"type": "number"},
                "drone_y": {"type": "number"},
                "flowers": {"type": "array", "items": {"type": "object"}},
                "battery_pct": {"type": "number"},
                "prioritize_confidence": {"type": "boolean"},
            },
            "required": ["drone_x", "drone_y", "flowers", "battery_pct"],
        },
    },
    {
        "name": "estimate_battery_range",
        "description": (
            "Estimate how many more flowers the drone can visit given current "
            "battery and distance to remaining flowers."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "battery_pct": {"type": "number"},
                "remaining_flowers": {"type": "integer"},
                "avg_flower_distance": {"type": "number"},
            },
            "required": ["battery_pct", "remaining_flowers"],
        },
    },
    {
        "name": "recommend_confidence_threshold",
        "description": (
            "Recommend optimal detection confidence threshold based on current "
            "sensor conditions and phase."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "phase": {"type": "string"},
                "of_stability": {"type": "number"},
                "battery_pct": {"type": "number"},
                "flowers_remaining": {"type": "integer"},
            },
            "required": ["phase", "of_stability", "battery_pct"],
        },
    },
    {
        "name": "plan_scan_pattern",
        "description": (
            "Recommend adaptive scan pattern spacing based on garden area "
            "and discovery density."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "garden_size": {"type": "number"},
                "discovered_count": {"type": "integer"},
                "total_passes": {"type": "integer"},
                "current_pass": {"type": "integer"},
            },
            "required": ["garden_size", "discovered_count", "total_passes"],
        },
    },
]


# ── Tool implementations ─────────────────────────────────────────────────────

def _tool_compute_tsp_route(
    drone_x: float,
    drone_y: float,
    flowers: list[dict],
    battery_pct: float,
    prioritize_confidence: bool = False,
) -> dict:
    """Greedy nearest-neighbor TSP with optional confidence weighting."""
    undiscovered = [
        f for f in flowers
        if f.get("state") not in ("pollinated",) and f.get("id")
    ]
    if not undiscovered:
        return {"route": [], "estimated_flowers_reachable": 0}

    cx, cy = drone_x, drone_y
    remaining = list(undiscovered)
    route: list[str] = []

    while remaining:
        if prioritize_confidence:
            def score(f: dict) -> float:
                dist = math.hypot(f.get("x", 0) - cx, f.get("y", 0) - cy)
                conf = f.get("confidence", 0.5)
                return -(conf / max(dist, 0.1))
            best = min(remaining, key=score)
        else:
            best = min(remaining, key=lambda f: math.hypot(f.get("x", 0) - cx, f.get("y", 0) - cy))
        route.append(best["id"])
        cx, cy = best.get("x", cx), best.get("y", cy)
        remaining.remove(best)

    reachable = min(len(route), int((battery_pct - 20) / max(8, 1)))
    return {"route": route, "estimated_flowers_reachable": max(0, reachable)}


def _tool_estimate_battery_range(
    battery_pct: float,
    remaining_flowers: int,
    avg_flower_distance: float = 3.0,
) -> dict:
    reachable = min(
        remaining_flowers,
        int((battery_pct - 20) / (8 + avg_flower_distance * 0.5)),
    )
    reachable = max(0, reachable)
    rec = (
        "Sufficient battery for all remaining flowers."
        if reachable >= remaining_flowers
        else f"Battery may only allow {reachable} more visits — consider prioritising."
    )
    return {"reachable_flowers": reachable, "recommendation": rec}


def _tool_recommend_confidence_threshold(
    phase: str,
    of_stability: float,
    battery_pct: float,
    flowers_remaining: int = 0,
) -> dict:
    # Try bandit first
    if BANDIT_AVAILABLE and bandit is not None:
        threshold = bandit.select_threshold(phase, of_stability, battery_pct)
        return {
            "threshold": round(threshold, 2),
            "reasoning": f"UCB1 bandit selected {threshold:.2f} for phase={phase}",
        }

    # Fallback heuristic
    approach_phases = ("descent", "hover_align", "approach")
    base = 0.40 if phase in ("scanning", "planning") else 0.75 if phase in approach_phases else 0.60

    adj = 0.0
    if of_stability > 0.8:
        adj += 0.05
    elif of_stability < 0.4:
        adj -= 0.05
    if battery_pct < 40:
        adj -= 0.03
    if flowers_remaining <= 2:
        adj += 0.05

    threshold = round(min(0.85, max(0.40, base + adj)), 2)
    reasoning = (
        f"Base {base:.2f} for phase={phase}, stability={of_stability:.2f}, "
        f"battery={battery_pct:.0f}%, adj={adj:+.2f}"
    )
    return {"threshold": threshold, "reasoning": reasoning}


def _tool_plan_scan_pattern(
    garden_size: float,
    discovered_count: int,
    total_passes: int,
    current_pass: int = 0,
) -> dict:
    if discovered_count > 3:
        spacing = 3.5
    elif discovered_count == 0:
        spacing = 5.5
    else:
        spacing = 4.5

    passes = max(2, int(garden_size / spacing))
    return {"spacing": spacing, "passes": passes}


def _dispatch_tool(name: str, inputs: dict) -> dict:
    try:
        if name == "compute_tsp_route":
            return _tool_compute_tsp_route(**inputs)
        elif name == "estimate_battery_range":
            return _tool_estimate_battery_range(**inputs)
        elif name == "recommend_confidence_threshold":
            return _tool_recommend_confidence_threshold(**inputs)
        elif name == "plan_scan_pattern":
            return _tool_plan_scan_pattern(**inputs)
        else:
            return {"error": f"Unknown tool: {name}"}
    except Exception as exc:
        log.warning(f"Tool {name} failed: {exc}")
        return {"error": str(exc)}


# ── Mock decision (no API key) ───────────────────────────────────────────────

def _mock_decision(state: dict) -> dict:
    phase = state.get("phase", "scanning")
    battery = state.get("battery_pct", 100)
    return {
        "action": "continue",
        "reasoning": (
            f"[MOCK — no ANTHROPIC_API_KEY] Phase={phase}, battery={battery:.0f}%. "
            "Continuing current mission plan."
        ),
        "priorityOverride": [],
        "altitudeOverride": None,
        "confidenceThreshold": 0.75,
        "scanSpacing": None,
        "decisionMs": 0,
        "modelUsed": "mock",
    }


# ── LLM decision ─────────────────────────────────────────────────────────────

def _build_user_message(state: dict) -> str:
    drone = state.get("drone", {})
    flowers = state.get("flowers", [])
    phase = state.get("phase", "unknown")
    sensor = state.get("sensor", {})
    battery = state.get("battery_pct", 100)
    pollinated = state.get("pollinated_ids", [])
    discovered = state.get("discovered_ids", [])
    t = state.get("time", 0)

    total = len(flowers)
    n_disc = len(discovered)
    n_poll = len(pollinated)
    remaining = [f["id"] for f in flowers if f.get("state") != "pollinated" and f.get("id") in discovered]

    of_stab = sensor.get("ofStability", sensor.get("of_stability", 0.8))
    x = drone.get("x", 0)
    y = drone.get("y", 0)
    z = drone.get("z", 0)

    return (
        f"Current mission state (T+{t:.1f}s):\n"
        f"- Phase: {phase}\n"
        f"- Drone position: ({x:.1f}, {y:.1f}) at {z:.1f}m altitude\n"
        f"- Battery: {battery:.1f}%\n"
        f"- Optical flow stability: {of_stab:.2f}\n"
        f"- Flowers: {n_poll}/{total} pollinated, {n_disc} discovered\n"
        f"- Remaining targets: {remaining}\n"
        "\n"
        "Please use the available tools to analyse this situation and decide the best action. "
        "Return a concise recommendation: should the drone continue, replan its route, "
        "adjust altitude, adjust scan pattern, or abort the current target?"
    )


async def _llm_decide(state: dict) -> dict:
    """Call Claude with tool_use loop. Returns AgentDecision dict."""
    if not ANTHROPIC_API_KEY or not ANTHROPIC_AVAILABLE:
        return _mock_decision(state)

    client = _anthropic_mod.Anthropic(api_key=ANTHROPIC_API_KEY)
    t_start = time.perf_counter()

    system_prompt = (
        "You are an autonomous drone mission planner AI for a pollinator drone. "
        "Your goal is to maximise flower pollination efficiency while managing "
        "battery life and sensor conditions. You have access to planning tools. "
        "Be concise and decisive."
    )

    messages: list[dict] = [{"role": "user", "content": _build_user_message(state)}]

    action = "continue"
    reasoning = ""
    priority_override: list[str] = []
    altitude_override: float | None = None
    confidence_threshold = 0.75
    scan_spacing: float | None = None

    try:
        for _round in range(3):
            resp = client.messages.create(
                model=MODEL,
                max_tokens=1024,
                system=system_prompt,
                tools=TOOLS,  # type: ignore[arg-type]
                messages=messages,
            )

            # Collect text blocks for reasoning
            for block in resp.content:
                if hasattr(block, "text"):
                    reasoning = block.text

            if resp.stop_reason != "tool_use":
                break

            # Process tool calls
            tool_results = []
            for block in resp.content:
                if block.type != "tool_use":
                    continue
                result = _dispatch_tool(block.name, block.input)
                log.info(f"Tool {block.name} → {result}")

                # Extract planning info from tool results
                if block.name == "compute_tsp_route":
                    priority_override = result.get("route", [])
                    if priority_override:
                        action = "replan"
                elif block.name == "recommend_confidence_threshold":
                    confidence_threshold = result.get("threshold", 0.75)
                elif block.name == "plan_scan_pattern":
                    scan_spacing = result.get("spacing")
                    if scan_spacing:
                        action = "adjust_scan"

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(result),
                })

            # Continue conversation with tool results
            messages.append({"role": "assistant", "content": resp.content})
            messages.append({"role": "user", "content": tool_results})

    except Exception as exc:
        log.error(f"LLM call failed: {exc}")
        return _mock_decision(state)

    elapsed_ms = (time.perf_counter() - t_start) * 1000
    _decision_times.append(elapsed_ms)

    # Parse action from reasoning if not set by tools
    if not reasoning:
        reasoning = "Mission analysis complete."
    reasoning_lower = reasoning.lower()
    if action == "continue":
        if "abort" in reasoning_lower:
            action = "abort_target"
        elif "altitude" in reasoning_lower:
            action = "adjust_altitude"

    return {
        "action": action,
        "reasoning": reasoning[:500],
        "priorityOverride": priority_override,
        "altitudeOverride": altitude_override,
        "confidenceThreshold": confidence_threshold,
        "scanSpacing": scan_spacing,
        "decisionMs": round(elapsed_ms, 1),
        "modelUsed": MODEL,
    }


# ── FastAPI app ──────────────────────────────────────────────────────────────

app = FastAPI(title="Pollinator Drone Agent Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/decide")
async def decide(request: dict) -> dict:
    global _decisions_total, _overrides_issued

    loop = asyncio.get_event_loop()
    decision = await loop.run_in_executor(None, lambda: asyncio.run(_llm_decide(request)))

    _decisions_total += 1
    if decision.get("priorityOverride"):
        _overrides_issued += 1

    # Store in recent decisions
    _recent_decisions.append({
        "ts": time.time(),
        "decision": decision,
        "phase": request.get("phase", "unknown"),
        "battery": request.get("battery_pct", 0),
    })

    return decision


@app.get("/stream")
async def stream_commentary(
    phase: str = "scanning",
    battery: str = "100",
    discovered: str = "0",
    pollinated: str = "0",
    total: str = "0",
    altitude: str = "8.0",
    of_stability: str = "0.8",
    target: str = "",
) -> StreamingResponse:

    async def event_generator() -> AsyncIterator[str]:
        if not ANTHROPIC_API_KEY or not ANTHROPIC_AVAILABLE:
            mock_text = (
                f"[MOCK] Drone in {phase} phase at {altitude}m. "
                f"Battery {battery}%. "
                f"Pollinated {pollinated}/{total} flowers."
            )
            yield f'data: {json.dumps({"text": mock_text, "done": False})}\n\n'
            yield f'data: {json.dumps({"text": "", "done": True})}\n\n'
            return

        system_prompt = (
            "You are a concise mission AI analyst for an autonomous pollinator drone. "
            "Given the current drone state, narrate what is happening and why in 1-2 sentences. "
            "Be technical but accessible. Focus on the most interesting aspect of the current moment."
        )

        phase_meanings = {
            "scanning": "performing lawnmower scan pattern to detect flowers",
            "planning": "computing optimal TSP route for discovered flowers",
            "approach": "flying toward target flower cluster at patrol altitude",
            "descent": "descending from 8m patrol altitude to 1.5m hover altitude",
            "hover_align": "precision hover alignment above target — EKF lock active",
            "pollinating": "pollination mechanism active — vibrating pollen brush contacts flower",
            "ascent": "climbing back to 8m patrol altitude post-pollination",
            "resume": "resuming transit to next flower target in TSP route",
            "mission_complete": "all targets visited — returning to home base",
            "arming": "pre-flight checks and motor arm sequence",
            "takeoff": "climbing from ground to 8m patrol altitude",
            "landing": "final descent to ground — mission ending",
        }
        phase_meaning = phase_meanings.get(phase, phase)

        bat_f = float(battery)
        stab_f = float(of_stability)
        bat_interp = (
            "battery healthy" if bat_f > 70
            else "battery moderate — monitoring range" if bat_f > 40
            else "battery LOW — efficiency critical"
        )
        stab_interp = (
            "optical flow stable — high sensor confidence" if stab_f > 0.7
            else "moderate optical flow — some sensor noise" if stab_f > 0.4
            else "optical flow degraded — reduced detection confidence"
        )
        on_track = int(pollinated) > 0 or int(discovered) > int(int(total) // 2)
        track_str = "mission progressing well" if on_track else "early mission — establishing coverage"

        user_msg = (
            f"Drone state: phase={phase} ({phase_meaning}), altitude={altitude}m, "
            f"{bat_interp} ({battery}%), {stab_interp} (stability={of_stability}), "
            f"discovered={discovered}/{total} flowers, pollinated={pollinated}/{total}, "
            f"current target={target or 'none'}, {track_str}. "
            "Narrate this mission moment in 1-2 sentences. Be technical and specific."
        )

        try:
            client = _anthropic_mod.Anthropic(api_key=ANTHROPIC_API_KEY)
            with client.messages.stream(
                model=MODEL,
                max_tokens=150,
                system=system_prompt,
                messages=[{"role": "user", "content": user_msg}],
            ) as stream:
                for text_chunk in stream.text_stream:
                    yield f'data: {json.dumps({"text": text_chunk, "done": False})}\n\n'

        except Exception as exc:
            log.error(f"Stream commentary failed: {exc}")
            yield f'data: {json.dumps({"text": f"[Agent error: {exc}]", "done": False})}\n\n'

        yield f'data: {json.dumps({"text": "", "done": True})}\n\n'

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.websocket("/agent")
async def agent_ws(ws: WebSocket) -> None:
    await ws.accept()
    log.info(f"Agent WS connected: {ws.client}")
    try:
        while True:
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=10.0)
            except asyncio.TimeoutError:
                await ws.send_json({"type": "keepalive"})
                continue

            try:
                state = json.loads(raw)
            except json.JSONDecodeError:
                continue

            decision = await _llm_decide(state)
            await ws.send_json(decision)

    except WebSocketDisconnect:
        log.info(f"Agent WS disconnected: {ws.client}")
    except Exception as exc:
        log.error(f"Agent WS error: {exc}")


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "model": MODEL,
        "api_key_set": bool(ANTHROPIC_API_KEY),
        "anthropic_available": ANTHROPIC_AVAILABLE,
        "bandit_available": BANDIT_AVAILABLE,
        "decisions_total": _decisions_total,
    }


@app.get("/metrics")
async def metrics() -> dict:
    avg_ms = (
        sum(_decision_times) / len(_decision_times)
        if _decision_times
        else 0
    )
    return {
        "decisions_total": _decisions_total,
        "overrides_issued": _overrides_issued,
        "avg_decision_ms": round(avg_ms, 1),
        "bandit_stats": bandit.get_stats() if BANDIT_AVAILABLE and bandit else {},
    }


@app.get("/decisions/recent")
async def recent_decisions() -> dict:
    return {"decisions": list(_recent_decisions)}


@app.post("/feedback")
async def feedback(body: dict) -> dict:
    """Receive reward signal for the confidence bandit."""
    if BANDIT_AVAILABLE and bandit is not None:
        bandit.update_reward(
            phase=body.get("phase", "scanning"),
            of_stability=float(body.get("of_stability", 0.8)),
            battery_pct=float(body.get("battery_pct", 100)),
            success=bool(body.get("success", True)),
        )
    return {"ok": True}


if __name__ == "__main__":
    log.info("Starting agent server on http://localhost:8766")
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8766,
        log_level="warning",
    )
