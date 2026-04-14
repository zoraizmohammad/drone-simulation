"""
FastAPI agent server for the autonomous pollinator drone AI planner.

Endpoints
---------
  POST /decide            — LLM planning decision via LangChain ChatAnthropic
                            with tool-calling loop (max 3 rounds).
                            RAG context from past missions injected into prompt.
  GET  /stream            — SSE streaming mission commentary
  WS   /agent             — WebSocket mirror of /decide
  WS   /terminal          — Real-time LangChain callback events → drone terminal
  GET  /health            — server status
  GET  /metrics           — decision/override/latency metrics
  GET  /decisions/recent  — last 10 decisions
  POST /feedback          — reward signal for the UCB1 confidence bandit
  POST /mission/save      — embed completed mission into RAG vector store

Port: 8766

LangChain integration
---------------------
  The /decide endpoint uses ChatAnthropic from langchain-anthropic with
  .bind_tools() so tool calls are handled natively by LangChain's message
  protocol.  A DroneTerminalCallbackHandler (langchain_core BaseCallbackHandler
  subclass) is attached to every invoke() call and queues events — LLM
  thoughts, tool invocations, and tool results — that the /terminal WebSocket
  drains every 100 ms.

  RAG retrieval (MissionStore / Chroma / all-MiniLM-L6-v2) runs before each
  /decide call.  The top-3 similar past missions are injected into the Claude
  system prompt so the agent can reason from accumulated experience.
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

# ── LangChain imports ────────────────────────────────────────────────────────
try:
    from langchain_anthropic import ChatAnthropic
    from langchain_core.messages import (
        HumanMessage, SystemMessage, AIMessage, ToolMessage,
    )
    from langchain_core.tools import StructuredTool
    LANGCHAIN_AVAILABLE = True
except ImportError:
    LANGCHAIN_AVAILABLE = False
    ChatAnthropic = None  # type: ignore

# ── Fallback: raw anthropic SDK ──────────────────────────────────────────────
try:
    import anthropic as _anthropic_mod
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False
    _anthropic_mod = None  # type: ignore

# ── Local modules ─────────────────────────────────────────────────────────────
try:
    from confidence_bandit import ConfidenceBandit  # type: ignore
    bandit: ConfidenceBandit | None = ConfidenceBandit()
    BANDIT_AVAILABLE = True
except Exception:
    bandit = None
    BANDIT_AVAILABLE = False

try:
    from drone_callback import DroneTerminalCallbackHandler  # type: ignore
    _terminal_callback = DroneTerminalCallbackHandler()
    CALLBACK_AVAILABLE = True
except Exception:
    _terminal_callback = None  # type: ignore
    CALLBACK_AVAILABLE = False

try:
    from mission_store import MissionStore  # type: ignore
    _mission_store = MissionStore()
    RAG_AVAILABLE = _mission_store.available
except Exception:
    _mission_store = None  # type: ignore
    RAG_AVAILABLE = False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
log = logging.getLogger("agent_server")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL = "claude-haiku-4-5-20251001"

log.info(
    f"Agent server init — langchain={LANGCHAIN_AVAILABLE}, "
    f"anthropic={ANTHROPIC_AVAILABLE}, bandit={BANDIT_AVAILABLE}, "
    f"callbacks={CALLBACK_AVAILABLE}, rag={RAG_AVAILABLE}"
)

# ── Metrics ──────────────────────────────────────────────────────────────────
_decisions_total = 0
_overrides_issued = 0
_decision_times: deque[float] = deque(maxlen=50)
_recent_decisions: deque[dict] = deque(maxlen=10)

# ── WebSocket terminal clients ────────────────────────────────────────────────
_terminal_clients: set[WebSocket] = set()


# ── Tool implementations ─────────────────────────────────────────────────────

def _tool_compute_tsp_route(
    drone_x: float,
    drone_y: float,
    battery_pct: float,
    flowers_json: str = "[]",
    prioritize_confidence: bool = False,
) -> str:
    """
    Compute optimized TSP visit order for flowers given drone position and
    battery level. flowers_json is a JSON-encoded array of flower objects.
    """
    try:
        flowers: list[dict] = json.loads(flowers_json) if isinstance(flowers_json, str) else flowers_json
    except Exception:
        flowers = []

    undiscovered = [
        f for f in flowers
        if f.get("state") not in ("pollinated",) and f.get("id")
    ]
    if not undiscovered:
        return json.dumps({"route": [], "estimated_flowers_reachable": 0})

    cx, cy = drone_x, drone_y
    remaining = list(undiscovered)
    route: list[str] = []

    while remaining:
        if prioritize_confidence:
            def _score(f: dict) -> float:
                dist = math.hypot(f.get("x", 0) - cx, f.get("y", 0) - cy)
                conf = f.get("confidence", 0.5)
                return -(conf / max(dist, 0.1))
            best = min(remaining, key=_score)
        else:
            best = min(
                remaining,
                key=lambda f: math.hypot(f.get("x", 0) - cx, f.get("y", 0) - cy),
            )
        route.append(best["id"])
        cx, cy = best.get("x", cx), best.get("y", cy)
        remaining.remove(best)

    reachable = max(0, min(len(route), int((battery_pct - 20) / max(8, 1))))
    return json.dumps({"route": route, "estimated_flowers_reachable": reachable})


def _tool_estimate_battery_range(
    battery_pct: float,
    remaining_flowers: int,
    avg_flower_distance: float = 3.0,
) -> str:
    reachable = max(
        0,
        min(remaining_flowers, int((battery_pct - 20) / (8 + avg_flower_distance * 0.5))),
    )
    rec = (
        "Sufficient battery for all remaining flowers."
        if reachable >= remaining_flowers
        else f"Battery may only support {reachable} more visits — prioritise nearest."
    )
    return json.dumps({"reachable_flowers": reachable, "recommendation": rec})


def _tool_recommend_confidence_threshold(
    phase: str,
    of_stability: float,
    battery_pct: float,
    flowers_remaining: int = 0,
) -> str:
    if BANDIT_AVAILABLE and bandit is not None:
        threshold = bandit.select_threshold(phase, of_stability, battery_pct)
        return json.dumps({
            "threshold": round(threshold, 2),
            "reasoning": f"UCB1 bandit: {threshold:.2f} for phase={phase}, stability={of_stability:.2f}",
        })
    approach = ("descent", "hover_align", "approach")
    base = 0.40 if phase in ("scanning", "planning") else 0.75 if phase in approach else 0.60
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
    return json.dumps({
        "threshold": threshold,
        "reasoning": f"Heuristic: base={base:.2f} phase={phase} adj={adj:+.2f}",
    })


def _tool_plan_scan_pattern(
    garden_size: float,
    discovered_count: int,
    total_passes: int,
    current_pass: int = 0,
) -> str:
    spacing = 3.5 if discovered_count > 3 else 5.5 if discovered_count == 0 else 4.5
    passes = max(2, int(garden_size / spacing))
    return json.dumps({"spacing": spacing, "passes": passes})


# ── LangChain StructuredTools ─────────────────────────────────────────────────

def _make_lc_tools() -> list:
    if not LANGCHAIN_AVAILABLE:
        return []
    return [
        StructuredTool.from_function(
            func=_tool_compute_tsp_route,
            name="compute_tsp_route",
            description=(
                "Compute optimized TSP visit order for flowers. "
                "Pass flowers_json as a JSON-encoded array of flower objects "
                "with keys: id, x, y, state, confidence."
            ),
        ),
        StructuredTool.from_function(
            func=_tool_estimate_battery_range,
            name="estimate_battery_range",
            description=(
                "Estimate how many more flowers the drone can visit given "
                "current battery percentage and distance to remaining flowers."
            ),
        ),
        StructuredTool.from_function(
            func=_tool_recommend_confidence_threshold,
            name="recommend_confidence_threshold",
            description=(
                "Recommend optimal detection confidence threshold based on "
                "current phase, optical flow stability, and battery level."
            ),
        ),
        StructuredTool.from_function(
            func=_tool_plan_scan_pattern,
            name="plan_scan_pattern",
            description=(
                "Recommend adaptive scan pattern spacing and number of passes "
                "based on garden size and how many flowers have been discovered."
            ),
        ),
    ]


_lc_tools = _make_lc_tools()


# ── System prompt builder ─────────────────────────────────────────────────────

def _build_system_prompt(rag_context: str) -> str:
    base = (
        "You are an autonomous drone mission planner AI for a pollinator drone. "
        "Your goal is to maximise flower pollination efficiency while managing "
        "battery life and sensor conditions. "
        "You have access to planning tools — use them to analyse the situation "
        "before deciding. Be concise and decisive."
    )
    if rag_context:
        return f"{base}\n\n{rag_context}"
    return base


def _build_user_message(state: dict) -> str:
    drone   = state.get("drone", {})
    flowers = state.get("flowers", [])
    phase   = state.get("phase", "unknown")
    sensor  = state.get("sensor", {})
    battery = float(state.get("battery_pct", 100))
    pollinated = state.get("pollinated_ids", [])
    discovered = state.get("discovered_ids", [])
    t = float(state.get("time", 0))

    remaining = [
        f["id"] for f in flowers
        if f.get("state") != "pollinated" and f.get("id") in discovered
    ]
    of_stab = float(sensor.get("ofStability", sensor.get("of_stability", 0.8)))
    x, y, z = drone.get("x", 0), drone.get("y", 0), drone.get("z", 0)

    return (
        f"Current mission state (T+{t:.1f}s):\n"
        f"- Phase: {phase}\n"
        f"- Drone position: ({x:.1f}, {y:.1f}) at {z:.1f}m altitude\n"
        f"- Battery: {battery:.1f}%\n"
        f"- Optical flow stability: {of_stab:.2f}\n"
        f"- Flowers: {len(pollinated)}/{len(flowers)} pollinated, "
        f"{len(discovered)} discovered\n"
        f"- Remaining targets: {remaining}\n"
        f"\nUse the available tools to analyse this situation and decide the "
        f"best action. Should the drone continue, replan its route, adjust "
        f"altitude, adjust scan pattern, or abort the current target?"
    )


# ── Mock decision (no API key / LangChain unavailable) ───────────────────────

def _mock_decision(state: dict) -> dict:
    return {
        "action": "continue",
        "reasoning": (
            f"[MOCK — no API key] Phase={state.get('phase')}, "
            f"battery={state.get('battery_pct', 100):.0f}%. "
            "Continuing current plan."
        ),
        "priorityOverride": [],
        "altitudeOverride": None,
        "confidenceThreshold": 0.75,
        "scanSpacing": None,
        "decisionMs": 0,
        "modelUsed": "mock",
    }


# ── LangChain tool-calling loop ───────────────────────────────────────────────

async def _llm_decide(state: dict) -> dict:
    """
    Call Claude claude-haiku-4-5-20251001 via LangChain ChatAnthropic with:
      1. RAG context from similar past missions injected into system prompt
      2. DroneTerminalCallbackHandler attached for real-time terminal events
      3. Tool-calling loop (max 3 rounds)

    Falls back to _mock_decision when API key or LangChain is unavailable.
    """
    if not ANTHROPIC_API_KEY or not LANGCHAIN_AVAILABLE or ChatAnthropic is None:
        return _mock_decision(state)

    t_start = time.perf_counter()

    # RAG retrieval — build a semantic query from the current mission state
    rag_context = ""
    if RAG_AVAILABLE and _mission_store is not None:
        drone  = state.get("drone", {})
        sensor = state.get("sensor", {})
        rag_query = (
            f"phase={state.get('phase')} "
            f"battery={state.get('battery_pct', 100):.0f} "
            f"stability={sensor.get('ofStability', 0.8):.2f} "
            f"discovered={len(state.get('discovered_ids', []))} "
            f"pollinated={len(state.get('pollinated_ids', []))}"
        )
        rag_context = _mission_store.retrieve_context(rag_query, k=3)

    system_prompt = _build_system_prompt(rag_context)
    user_message  = _build_user_message(state)

    # Build callback list
    callbacks = [_terminal_callback] if CALLBACK_AVAILABLE and _terminal_callback else []

    # Create ChatAnthropic model with tools bound
    lc_model = ChatAnthropic(
        model=MODEL,
        api_key=ANTHROPIC_API_KEY,  # type: ignore[arg-type]
        max_tokens=1024,
    ).bind_tools(_lc_tools)

    messages: list = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_message),
    ]

    action             = "continue"
    reasoning          = ""
    priority_override: list[str] = []
    altitude_override: float | None = None
    confidence_threshold = 0.75
    scan_spacing: float | None = None

    try:
        for _round in range(3):
            response: AIMessage = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda msgs=messages: lc_model.invoke(
                    msgs, config={"callbacks": callbacks}
                ),
            )

            # Extract reasoning text
            if isinstance(response.content, str) and response.content.strip():
                reasoning = response.content

            # No tool calls → final answer
            tool_calls = getattr(response, "tool_calls", []) or []
            if not tool_calls:
                break

            # Dispatch each tool call and collect results
            messages.append(response)
            tool_msgs: list[ToolMessage] = []
            for tc in tool_calls:
                tool_name = tc.get("name", "")
                tool_args = tc.get("args", {})
                tool_id   = tc.get("id", "")

                # Resolve result from our Python implementations
                try:
                    if tool_name == "compute_tsp_route":
                        raw = _tool_compute_tsp_route(**tool_args)
                    elif tool_name == "estimate_battery_range":
                        raw = _tool_estimate_battery_range(**tool_args)
                    elif tool_name == "recommend_confidence_threshold":
                        raw = _tool_recommend_confidence_threshold(**tool_args)
                    elif tool_name == "plan_scan_pattern":
                        raw = _tool_plan_scan_pattern(**tool_args)
                    else:
                        raw = json.dumps({"error": f"Unknown tool: {tool_name}"})
                except Exception as exc:
                    raw = json.dumps({"error": str(exc)})

                # Parse result and extract planning data
                try:
                    result_dict = json.loads(raw)
                except Exception:
                    result_dict = {}

                if tool_name == "compute_tsp_route":
                    route = result_dict.get("route", [])
                    if route:
                        priority_override = route
                        action = "replan"
                elif tool_name == "recommend_confidence_threshold":
                    confidence_threshold = float(result_dict.get("threshold", 0.75))
                elif tool_name == "plan_scan_pattern":
                    sp = result_dict.get("spacing")
                    if sp is not None:
                        scan_spacing = float(sp)
                        action = "adjust_scan"

                log.info(f"Tool {tool_name} → {raw[:100]}")
                tool_msgs.append(ToolMessage(content=raw, tool_call_id=tool_id))

            messages.extend(tool_msgs)

    except Exception as exc:
        log.error(f"LangChain decision failed: {exc}", exc_info=True)
        return _mock_decision(state)

    elapsed_ms = (time.perf_counter() - t_start) * 1000
    _decision_times.append(elapsed_ms)

    if not reasoning:
        reasoning = "Mission analysis complete via tool chain."

    r_lower = reasoning.lower()
    if action == "continue":
        if "abort" in r_lower:
            action = "abort_target"
        elif "altitude" in r_lower:
            action = "adjust_altitude"

    return {
        "action":              action,
        "reasoning":           reasoning[:500],
        "priorityOverride":    priority_override,
        "altitudeOverride":    altitude_override,
        "confidenceThreshold": confidence_threshold,
        "scanSpacing":         scan_spacing,
        "decisionMs":          round(elapsed_ms, 1),
        "modelUsed":           f"langchain/{MODEL}",
    }


# ── FastAPI app ───────────────────────────────────────────────────────────────

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

    decision = await _llm_decide(request)

    _decisions_total += 1
    if decision.get("priorityOverride"):
        _overrides_issued += 1

    _recent_decisions.append({
        "ts":       time.time(),
        "decision": decision,
        "phase":    request.get("phase", "unknown"),
        "battery":  request.get("battery_pct", 0),
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

    async def _gen() -> AsyncIterator[str]:
        if not ANTHROPIC_API_KEY or not ANTHROPIC_AVAILABLE:
            mock = (
                f"[MOCK] Drone in {phase} phase at {altitude}m. "
                f"Battery {battery}%. Pollinated {pollinated}/{total} flowers."
            )
            yield f'data: {json.dumps({"text": mock, "done": False})}\n\n'
            yield f'data: {json.dumps({"text": "", "done": True})}\n\n'
            return

        phase_meanings: dict[str, str] = {
            "scanning":        "performing lawnmower scan to detect flowers",
            "planning":        "computing optimal TSP route for discovered flowers",
            "approach":        "flying toward target cluster at patrol altitude",
            "descent":         "descending from 8m to 1.5m hover altitude",
            "hover_align":     "precision EKF-locked hover alignment above target",
            "pollinating":     "pollination mechanism active — pollen brush contacting flower",
            "ascent":          "climbing back to 8m patrol altitude post-pollination",
            "resume":          "resuming transit to next flower in TSP route",
            "mission_complete":"all targets visited — returning to home base",
            "arming":          "pre-flight system checks and motor arm sequence",
            "takeoff":         "climbing from ground to 8m patrol altitude",
            "landing":         "final descent — mission ending",
        }
        bat_f   = float(battery)
        stab_f  = float(of_stability)
        bat_str = (
            "battery healthy" if bat_f > 70
            else "moderate battery — monitoring range" if bat_f > 40
            else "battery LOW — efficiency critical"
        )
        stab_str = (
            "optical flow stable — high confidence" if stab_f > 0.7
            else "moderate optical flow — some noise" if stab_f > 0.4
            else "optical flow degraded — reduced CV confidence"
        )
        on_track = int(pollinated) > 0 or int(discovered) > int(total) // 2
        track_str = "mission progressing well" if on_track else "early mission — establishing coverage"

        user_msg = (
            f"Drone: phase={phase} ({phase_meanings.get(phase, phase)}), "
            f"alt={altitude}m, {bat_str} ({battery}%), {stab_str} (stability={of_stability}), "
            f"discovered={discovered}/{total}, pollinated={pollinated}/{total}, "
            f"target={target or 'none'}, {track_str}. "
            "Narrate this moment in 1-2 sentences — technical but clear."
        )

        try:
            client = _anthropic_mod.Anthropic(api_key=ANTHROPIC_API_KEY)
            with client.messages.stream(
                model=MODEL,
                max_tokens=150,
                system=(
                    "You are a concise mission AI analyst for an autonomous pollinator "
                    "drone. Given the current state, narrate what is happening in 1-2 "
                    "sentences. Be technical but accessible."
                ),
                messages=[{"role": "user", "content": user_msg}],
            ) as stream:
                for chunk in stream.text_stream:
                    yield f'data: {json.dumps({"text": chunk, "done": False})}\n\n'
        except Exception as exc:
            log.error(f"Commentary stream failed: {exc}")
            yield f'data: {json.dumps({"text": f"[error: {exc}]", "done": False})}\n\n'

        yield f'data: {json.dumps({"text": "", "done": True})}\n\n'

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.websocket("/terminal")
async def terminal_ws(ws: WebSocket) -> None:
    """
    Drain DroneTerminalCallbackHandler every 100 ms and push batches to the
    frontend terminal panel.  Any LLM thought or tool call appears here in
    real time as a coloured entry.
    """
    await ws.accept()
    _terminal_clients.add(ws)
    log.info(f"Terminal WS connected: {ws.client}")
    try:
        while True:
            if CALLBACK_AVAILABLE and _terminal_callback is not None:
                events = _terminal_callback.drain()
                if events:
                    await ws.send_json({"events": events})
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        log.info(f"Terminal WS disconnected: {ws.client}")
    except Exception as exc:
        log.warning(f"Terminal WS error: {exc}")
    finally:
        _terminal_clients.discard(ws)


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


@app.post("/mission/save")
async def save_mission(body: dict) -> dict:
    """
    Embed a completed mission into the Chroma RAG store.
    Payload: {events: EventLogEntry[], telemetry: {pollinatedIds, discoveredIds, battery_pct, time}}
    """
    if not RAG_AVAILABLE or _mission_store is None:
        return {"ok": False, "reason": "RAG store unavailable"}
    events   = body.get("events", [])
    telemetry = body.get("telemetry", {})
    success  = _mission_store.save_mission(events, telemetry)
    return {"ok": success, "total_missions": _mission_store.count()}


@app.get("/health")
async def health() -> dict:
    return {
        "status":             "ok",
        "model":              MODEL,
        "api_key_set":        bool(ANTHROPIC_API_KEY),
        "langchain":          LANGCHAIN_AVAILABLE,
        "anthropic_sdk":      ANTHROPIC_AVAILABLE,
        "callbacks":          CALLBACK_AVAILABLE,
        "rag":                RAG_AVAILABLE,
        "rag_missions":       _mission_store.count() if RAG_AVAILABLE and _mission_store else 0,
        "bandit":             BANDIT_AVAILABLE,
        "decisions_total":    _decisions_total,
    }


@app.get("/metrics")
async def metrics() -> dict:
    avg_ms = sum(_decision_times) / len(_decision_times) if _decision_times else 0
    return {
        "decisions_total":  _decisions_total,
        "overrides_issued": _overrides_issued,
        "avg_decision_ms":  round(avg_ms, 1),
        "bandit_stats":     bandit.get_stats() if BANDIT_AVAILABLE and bandit else {},
        "rag_missions":     _mission_store.count() if RAG_AVAILABLE and _mission_store else 0,
        "terminal_clients": len(_terminal_clients),
    }


@app.get("/decisions/recent")
async def recent_decisions() -> dict:
    return {"decisions": list(_recent_decisions)}


@app.post("/feedback")
async def feedback(body: dict) -> dict:
    if BANDIT_AVAILABLE and bandit is not None:
        bandit.update_reward(
            phase=body.get("phase", "scanning"),
            of_stability=float(body.get("of_stability", 0.8)),
            battery_pct=float(body.get("battery_pct", 100)),
            success=bool(body.get("success", True)),
        )
    return {"ok": True}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8766"))
    log.info(f"Starting agent server on http://0.0.0.0:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
