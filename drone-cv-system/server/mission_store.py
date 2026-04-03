"""
RAG store for drone mission history.

Embeds completed mission summaries (event log + telemetry) into a local
Chroma vector database using sentence-transformers/all-MiniLM-L6-v2
(~90 MB, runs entirely on CPU, no API key required).

At decision time, _decide() retrieves the 3 most similar past missions
and injects them as additional context into the Claude system prompt:

  "In past missions with similar battery/sensor conditions, the drone …"

This closes a real gap: the UCB1 bandit learns per-bucket thresholds but
cannot reason about *narrative* context.  RAG gives the agent memory of
what actually happened and why a strategy worked or failed.

Graceful degradation
--------------------
If sentence-transformers or chromadb are not installed, MissionStore.available
is False and all methods are silent no-ops.  The rest of the server is unaffected.

Persistence
-----------
Mission vectors are written to drone-cv-system/mission_history/  so they
survive server restarts and accumulate across sessions.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

log = logging.getLogger("mission_store")

# Persistence directory relative to this file's parent (drone-cv-system/)
_HERE = os.path.dirname(os.path.abspath(__file__))
PERSIST_DIR = os.path.join(_HERE, "..", "mission_history")

try:
    from langchain_community.vectorstores import Chroma
    from langchain_community.embeddings import HuggingFaceEmbeddings
    from langchain_core.documents import Document
    _LANGCHAIN_OK = True
except ImportError:
    _LANGCHAIN_OK = False
    log.warning("langchain-community not installed — RAG context disabled")


class MissionStore:
    """
    Thin wrapper around Chroma + HuggingFace embeddings.

    Public API
    ----------
    save_mission(events, telemetry) -> bool
        Embed and persist a completed mission.

    retrieve_context(query, k=3) -> str
        Return a formatted string of the k most similar past missions,
        ready to inject into a system prompt.  Empty string if no history.
    """

    available: bool

    def __init__(self) -> None:
        if not _LANGCHAIN_OK:
            self.available = False
            return
        try:
            os.makedirs(PERSIST_DIR, exist_ok=True)
            self._embeddings = HuggingFaceEmbeddings(
                model_name="sentence-transformers/all-MiniLM-L6-v2",
                model_kwargs={"device": "cpu"},
                encode_kwargs={"normalize_embeddings": True},
            )
            self._store = Chroma(
                collection_name="drone_missions",
                embedding_function=self._embeddings,
                persist_directory=PERSIST_DIR,
            )
            self.available = True
            count = self._store._collection.count()
            log.info(f"MissionStore ready — {count} missions in history (persist={PERSIST_DIR})")
        except Exception as exc:
            self.available = False
            log.warning(f"MissionStore init failed — RAG disabled: {exc}")

    # ── Save ──────────────────────────────────────────────────────────────────

    def save_mission(self, events: list[dict[str, Any]], telemetry: dict[str, Any]) -> bool:
        """
        Build a natural-language document from the mission event log and
        final telemetry snapshot, then add it to the Chroma collection.
        """
        if not self.available:
            return False
        try:
            doc_text = self._build_document(events, telemetry)
            meta = {
                "pollinated":   int(len(telemetry.get("pollinatedIds", []))),
                "discovered":   int(len(telemetry.get("discoveredIds", []))),
                "battery_final": float(telemetry.get("battery_pct", 100)),
                "duration_s":   float(telemetry.get("time", 0)),
            }
            doc = Document(page_content=doc_text, metadata=meta)
            self._store.add_documents([doc])
            log.info(f"Mission saved to RAG store — {meta['pollinated']} pollinated, "
                     f"battery={meta['battery_final']:.0f}%")
            return True
        except Exception as exc:
            log.warning(f"save_mission failed: {exc}")
            return False

    # ── Retrieve ──────────────────────────────────────────────────────────────

    def retrieve_context(self, query: str, k: int = 3) -> str:
        """
        Embed `query` and return the k most similar past mission summaries
        formatted as a context block for injection into the system prompt.
        Returns empty string when no history exists or RAG is unavailable.
        """
        if not self.available:
            return ""
        try:
            count = self._store._collection.count()
            if count == 0:
                return ""
            docs = self._store.similarity_search(query, k=min(k, count))
            if not docs:
                return ""
            lines = ["Relevant past mission experiences:"]
            for i, doc in enumerate(docs, 1):
                meta = doc.metadata
                lines.append(
                    f"  [{i}] {doc.page_content}  "
                    f"(pollinated={meta.get('pollinated', '?')}, "
                    f"battery_end={meta.get('battery_final', '?'):.0f}%, "
                    f"duration={meta.get('duration_s', '?'):.0f}s)"
                )
            return "\n".join(lines)
        except Exception as exc:
            log.warning(f"retrieve_context failed: {exc}")
            return ""

    def count(self) -> int:
        if not self.available:
            return 0
        try:
            return self._store._collection.count()
        except Exception:
            return 0

    # ── Document builder ──────────────────────────────────────────────────────

    @staticmethod
    def _build_document(events: list[dict[str, Any]], telemetry: dict[str, Any]) -> str:
        """Convert raw event log + telemetry into a searchable prose summary."""
        n_pollinated = len(telemetry.get("pollinatedIds", []))
        n_discovered = len(telemetry.get("discoveredIds", []))
        battery_final = telemetry.get("battery_pct", 100)
        duration = telemetry.get("time", 0)

        # Extract phase transition events for the narrative sequence
        phase_events = [
            e["message"] for e in events
            if "PHASE" in e.get("message", "").upper()
            or e.get("level") == "event"
        ][:12]

        # Extract detection and pollination milestones
        key_events = [
            e["message"] for e in events
            if any(kw in e.get("message", "").lower()
                   for kw in ("pollinated", "detected", "locked", "fallback", "error", "complete"))
        ][-8:]

        # Battery trajectory
        bat_label = (
            "battery healthy throughout"
            if battery_final > 70
            else "moderate battery use"
            if battery_final > 40
            else "low battery at end — efficiency critical"
        )

        # Outcome
        success_rate = (n_pollinated / n_discovered * 100) if n_discovered else 0
        outcome = (
            f"Successfully pollinated {n_pollinated}/{n_discovered} discovered flowers "
            f"({success_rate:.0f}% success rate). "
        )

        doc = (
            f"{outcome}"
            f"Mission duration {duration:.0f}s. {bat_label} (final {battery_final:.0f}%). "
            f"Phase sequence: {' → '.join(phase_events)}. "
            f"Key events: {'; '.join(key_events)}."
        )
        return doc
