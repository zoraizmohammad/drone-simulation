"""
FastAPI WebSocket inference server for Mode 2 live inference.

Endpoint:  ws://localhost:8765/inference
Protocol:  JSON in / JSON out (see WsMessage in wsClient.ts)

On first run, attempts to load drone-cv-system/models/flower_detector.onnx.
Falls back to physics-based mock detector transparently.
"""

from __future__ import annotations
import os
import sys
import asyncio
import logging
import json
from typing import Any

# ── Dependency check ────────────────────────────────────────────────────────
try:
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
except ImportError:
    print(
        'Missing dependencies. Run:\n'
        '  pip install -r drone-cv-system/server/requirements_server.txt',
        file=sys.stderr,
    )
    sys.exit(1)

# Add project root to path so we can import detection_bridge / scene_renderer
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from scene_renderer import render_frame, frame_to_base64, PIL_AVAILABLE  # type: ignore
from detection_bridge import DetectionBridge  # type: ignore

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s — %(message)s',
)
log = logging.getLogger('inference_server')

# ── Model path ──────────────────────────────────────────────────────────────
MODELS_DIR  = os.path.join(HERE, '..', 'models')
MODEL_PATH  = os.path.join(MODELS_DIR, 'flower_detector.onnx')

# Try to auto-generate the model if missing
if not os.path.exists(MODEL_PATH):
    log.info('flower_detector.onnx not found — attempting auto-generation…')
    try:
        import generate_model  # type: ignore
        generate_model.main()
    except Exception as e:
        log.warning(f'Auto-generation failed ({e}). Server will use mock detector.')

bridge = DetectionBridge(MODEL_PATH if os.path.exists(MODEL_PATH) else None)
log.info(f'Detection bridge ready — mode: {bridge.mode}')

# ── FastAPI app ─────────────────────────────────────────────────────────────
app = FastAPI(title='Pollinator Drone Inference Server')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)


def _compute_tsp_suggestion(
    detections: list[dict[str, Any]],
    flowers: list[dict[str, Any]],
    drone_x: float,
    drone_y: float,
) -> list[str]:
    """
    Nearest-neighbour TSP heuristic over detected flowers.

    The client sends the full flowers list with garden-space (x, y) coordinates.
    We join detections → flower positions to compute a suggested visit order.
    This is the 'planning agent' layer: it supplements the JS navigator's own
    route planner with a server-side view that covers all currently-visible flowers.
    """
    flower_map: dict[str, dict[str, Any]] = {f['id']: f for f in flowers}
    candidates = [
        {'id': d['id'],
         'gx': flower_map[d['id']]['x'],
         'gy': flower_map[d['id']]['y'],
         'confidence': d['confidence']}
        for d in detections
        if d['id'] in flower_map
    ]
    if not candidates:
        return []

    unvisited = list(candidates)
    route: list[str] = []
    cx, cy = drone_x, drone_y

    while unvisited:
        best = min(unvisited, key=lambda c: (c['gx'] - cx) ** 2 + (c['gy'] - cy) ** 2)
        route.append(best['id'])
        cx, cy = best['gx'], best['gy']
        unvisited.remove(best)

    return route


def _phase_suggestion(detections: list[dict[str, Any]], current_phase: str) -> str:
    """Simple phase transition logic mirroring the TypeScript state machine."""
    if not detections:
        return current_phase

    best_conf = detections[0]['confidence']

    if current_phase == 'scanning':
        if best_conf >= 0.40:
            return 'approach'
    elif current_phase == 'approach':
        if best_conf >= 0.75:
            return 'descent'
    elif current_phase == 'hover_align':
        if best_conf >= 0.85:
            return 'pollinating'

    return current_phase


@app.websocket('/inference')
async def inference_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    client = ws.client
    log.info(f'Client connected: {client}')

    try:
        while True:
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=5.0)
            except asyncio.TimeoutError:
                # Send keepalive
                await ws.send_json({'type': 'keepalive'})
                continue

            try:
                data: dict[str, Any] = json.loads(raw)
            except json.JSONDecodeError:
                log.warning('Malformed JSON from client — skipping')
                continue

            drone   = data.get('drone',   {})
            flowers = data.get('flowers', [])
            phase   = data.get('phase',   'scanning')

            if not drone or not isinstance(flowers, list):
                continue

            # Render synthetic camera frame
            loop = asyncio.get_event_loop()
            frame_arr = await loop.run_in_executor(
                None, render_frame, drone, flowers
            )

            # Run detection (ONNX or mock)
            dets, mode_used, elapsed_ms = await loop.run_in_executor(
                None, bridge.detect, frame_arr, drone, flowers
            )

            # Encode frame as base64 JPEG (optional — only when PIL available)
            frame_b64: str | None = None
            if PIL_AVAILABLE and len(flowers) > 0:
                frame_b64 = await loop.run_in_executor(
                    None, frame_to_base64, frame_arr
                )

            phase_sug  = _phase_suggestion(dets, phase)
            target_id  = dets[0]['id'] if dets else None
            tsp_suggest = _compute_tsp_suggestion(
                dets, flowers,
                drone.get('x', 0.0), drone.get('y', 0.0),
            )

            response = {
                'detections':      dets,
                'phaseSuggestion': phase_sug,
                'targetId':        target_id,
                'inferenceMs':     round(elapsed_ms, 1),
                'inferenceMode':   mode_used,
                'framePng':        frame_b64,
                'tspSuggestion':   tsp_suggest,
            }

            await ws.send_json(response)

    except WebSocketDisconnect:
        log.info(f'Client disconnected: {client}')
    except Exception as e:
        log.error(f'Unexpected error: {e}', exc_info=True)
        try:
            await ws.close(code=1011)
        except Exception:
            pass


@app.get('/health')
async def health() -> dict[str, Any]:
    return {
        'status': 'ok',
        'inference_mode': bridge.mode,
        'pil_available': PIL_AVAILABLE,
        'model_path': MODEL_PATH if os.path.exists(MODEL_PATH) else None,
    }


if __name__ == '__main__':
    log.info('Starting inference server on ws://localhost:8765')
    uvicorn.run(
        app,
        host='0.0.0.0',
        port=8765,
        log_level='warning',  # suppress uvicorn access logs; our logger handles it
        ws_ping_interval=20,
        ws_ping_timeout=30,
    )
