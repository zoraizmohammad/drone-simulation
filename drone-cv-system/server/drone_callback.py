"""
LangChain callback handler that routes every LLM thought, tool invocation,
and result into the drone terminal panel in real time.

Usage
-----
  from drone_callback import DroneTerminalCallbackHandler

  callback = DroneTerminalCallbackHandler()
  model.invoke(messages, config={"callbacks": [callback]})

  # In the /terminal WebSocket endpoint, drain events each tick:
  for evt in callback.drain():
      await ws.send_json(evt)

Event format
------------
  {"type": str, "text": str}

  type is one of the frontend TerminalEntryType values:
    "agent"   — LLM reasoning / decision text       (cyan-green)
    "tsp"     — route / planning tool calls          (amber)
    "detect"  — detection / CV tool results          (green)
    "ws-in"   — raw tool output / response           (cyan)
    "error"   — any LLM or callback error            (red)
"""

from __future__ import annotations

import threading
from collections import deque
from typing import Any, Union
from uuid import UUID

try:
    from langchain_core.callbacks import BaseCallbackHandler
    from langchain_core.outputs import LLMResult
    LANGCHAIN_AVAILABLE = True
except ImportError:
    LANGCHAIN_AVAILABLE = False
    # Provide a no-op fallback so the rest of the codebase can import safely
    class BaseCallbackHandler:  # type: ignore[no-redef]
        pass
    class LLMResult:  # type: ignore[no-redef]
        pass


class DroneTerminalCallbackHandler(BaseCallbackHandler):
    """
    Thread-safe event accumulator.  The FastAPI /terminal WebSocket endpoint
    periodically calls drain() and pushes the batch to connected clients.
    """

    # Map tool names to terminal entry types for colour coding
    _TOOL_TYPE: dict[str, str] = {
        "compute_tsp_route":              "tsp",
        "estimate_battery_range":         "tsp",
        "recommend_confidence_threshold": "detect",
        "plan_scan_pattern":              "detect",
    }

    def __init__(self) -> None:
        super().__init__()
        self._queue: deque[dict[str, str]] = deque(maxlen=300)
        self._lock = threading.Lock()

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _push(self, entry_type: str, text: str) -> None:
        with self._lock:
            self._queue.append({"type": entry_type, "text": text})

    def drain(self) -> list[dict[str, str]]:
        """Return and clear all pending events."""
        with self._lock:
            items = list(self._queue)
            self._queue.clear()
            return items

    def pending_count(self) -> int:
        with self._lock:
            return len(self._queue)

    # ── LangChain ChatModel hooks ─────────────────────────────────────────────

    def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: list[list[Any]],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        model_name = serialized.get("kwargs", {}).get("model", "llm")
        # Grab the last human message content as context preview
        preview = ""
        if messages and messages[0]:
            last = messages[0][-1]
            content = getattr(last, "content", "")
            if isinstance(content, str):
                preview = content[:70].replace("\n", " ")
        self._push("agent", f"THINK  [{model_name}]  {preview}…")

    def on_llm_start(
        self,
        serialized: dict[str, Any],
        prompts: list[str],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        """Fired for non-chat LLMs — kept for compatibility."""
        preview = prompts[0][:70].replace("\n", " ") if prompts else ""
        self._push("agent", f"THINK  {preview}…")

    def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        """Fired when the LLM returns its response."""
        try:
            gen = response.generations
            if gen and gen[0]:
                text = getattr(gen[0][0], "text", "") or ""
                if text.strip():
                    self._push("agent", f"RESULT  {text[:150].replace(chr(10), ' ')}")
        except Exception:
            pass

    def on_llm_error(
        self,
        error: Union[Exception, KeyboardInterrupt],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        self._push("error", f"LLM-ERROR  {str(error)[:120]}")

    # ── Tool hooks ────────────────────────────────────────────────────────────

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        name = serialized.get("name", "tool")
        entry_type = self._TOOL_TYPE.get(name, "tsp")
        short_input = str(input_str)[:80].replace("\n", " ")
        self._push(entry_type, f"TOOL:{name}  {short_input}")

    def on_tool_end(
        self,
        output: str,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        short = str(output)[:100].replace("\n", " ")
        self._push("ws-in", f"TOOL-RESULT  {short}")

    def on_tool_error(
        self,
        error: Union[Exception, KeyboardInterrupt],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        self._push("error", f"TOOL-ERROR  {str(error)[:100]}")

    # ── Agent hooks (AgentExecutor) ───────────────────────────────────────────

    def on_agent_action(self, action: Any, *, run_id: UUID, **kwargs: Any) -> None:
        tool = getattr(action, "tool", "?")
        tinput = str(getattr(action, "tool_input", ""))[:60]
        entry_type = self._TOOL_TYPE.get(tool, "tsp")
        self._push(entry_type, f"AGENT-ACT  tool={tool}  input={tinput}")

    def on_agent_finish(self, finish: Any, *, run_id: UUID, **kwargs: Any) -> None:
        output = str(getattr(finish, "return_values", {}).get("output", ""))[:120]
        self._push("agent", f"AGENT-FIN  {output}")
