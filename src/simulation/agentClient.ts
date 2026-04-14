/**
 * Agent client — connects to the agent server on port 8766.
 *
 * Channels
 * --------
 *   1. /decide       (HTTP POST, 200ms debounce) — LangChain planning decisions
 *   2. /stream       (SSE GET)                  — streaming mission commentary
 *   3. /terminal     (WebSocket)                — real-time LangChain callback
 *                                                 events: LLM thoughts, tool
 *                                                 calls, tool results, RAG hits
 *   4. /mission/save (HTTP POST, fire-and-forget) — embed completed mission
 *                                                   into Chroma RAG store
 *   5. /feedback     (HTTP POST)               — UCB1 bandit reward signal
 */
import type { AgentDecision, AgentCommentaryEntry, LiveFrame, TerminalEntryType } from '../models/types'

export type AgentStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export class AgentClient {
  private baseUrl: string
  private wsBase: string
  private status: AgentStatus = 'disconnected'
  private decideTimer: ReturnType<typeof setTimeout> | null = null
  private streamController: AbortController | null = null
  private onDecision: (d: AgentDecision) => void
  private onCommentary: (e: AgentCommentaryEntry) => void
  private onStatus: (s: AgentStatus) => void
  private commentaryIdRef = 0
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null

  // /terminal WebSocket
  private terminalWs: WebSocket | null = null
  private terminalReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private onTerminalEvent: ((type: TerminalEntryType, text: string) => void) | null = null
  // Exponential backoff for terminal WS — stops retrying after persistent failures
  // (e.g. uvicorn missing WebSocket support: "pip install uvicorn[standard]")
  private terminalFailCount = 0
  private static readonly TERMINAL_MAX_FAILS = 5
  private static readonly TERMINAL_BACKOFF_MS = [3000, 6000, 12000, 30000, 60000]

  constructor(
    onDecision: (d: AgentDecision) => void,
    onCommentary: (e: AgentCommentaryEntry) => void,
    onStatus: (s: AgentStatus) => void,
    baseUrl = 'http://localhost:8766',
  ) {
    this.onDecision = onDecision
    this.onCommentary = onCommentary
    this.onStatus = onStatus
    this.baseUrl = baseUrl
    this.wsBase = baseUrl.replace(/^http/, 'ws')
  }

  connect() {
    this.terminalFailCount = 0
    this.setStatus('connecting')
    this.healthCheckInterval = setInterval(() => this.checkHealth(), 3000)
    this.checkHealth()
  }

  private async checkHealth() {
    try {
      const r = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      })
      if (r.ok) this.setStatus('connected')
      else this.setStatus('error')
    } catch {
      this.setStatus('disconnected')
    }
  }

  /** Debounced: call at most once per 200ms */
  requestDecision(frame: LiveFrame) {
    if (this.decideTimer) clearTimeout(this.decideTimer)
    this.decideTimer = setTimeout(() => this.fetchDecision(frame), 200)
  }

  private async fetchDecision(frame: LiveFrame) {
    if (this.status !== 'connected') return
    try {
      const payload = {
        drone: frame.drone,
        flowers: frame.flowers,
        phase: frame.phase,
        sensor: frame.sensor,
        pollinated_ids: frame.pollinatedIds,
        discovered_ids: frame.discoveredIds,
        battery_pct: frame.sensor.batteryPercent,
        time: frame.time,
      }
      const r = await fetch(`${this.baseUrl}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      })
      if (r.ok) {
        const decision: AgentDecision = await r.json()
        this.onDecision(decision)
      }
    } catch {
      // Agent server unavailable — silently skip
    }
  }

  /** Start a new SSE stream for mission commentary */
  startCommentaryStream(frame: LiveFrame) {
    this.stopCommentaryStream()
    if (this.status !== 'connected') return
    this.streamController = new AbortController()
    this.fetchCommentaryStream(frame, this.streamController.signal)
  }

  private async fetchCommentaryStream(frame: LiveFrame, signal: AbortSignal) {
    const entryId = ++this.commentaryIdRef
    let accumulated = ''
    try {
      const params = new URLSearchParams({
        phase: frame.phase,
        battery: String(Math.round(frame.sensor.batteryPercent)),
        discovered: String(frame.discoveredIds.length),
        pollinated: String(frame.pollinatedIds.length),
        total: String(frame.flowers.length),
        altitude: String(frame.drone.z.toFixed(1)),
        of_stability: String(frame.sensor.ofStability?.toFixed(2) ?? '0.8'),
        target: frame.currentTargetId ?? '',
      })
      const r = await fetch(`${this.baseUrl}/stream?${params}`, { signal })
      if (!r.ok || !r.body) return
      const reader = r.body.getReader()
      const dec = new TextDecoder()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        const chunk = dec.decode(value)
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6))
            if (evt.done) {
              this.onCommentary({
                id: entryId,
                ts: Date.now(),
                text: accumulated,
                phase: frame.phase,
                streaming: false,
              })
              return
            }
            accumulated += evt.text
            this.onCommentary({
              id: entryId,
              ts: Date.now(),
              text: accumulated,
              phase: frame.phase,
              streaming: true,
            })
          } catch { /* skip malformed SSE lines */ }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      // Other errors — silently ignore, agent server may be offline
    }
  }

  stopCommentaryStream() {
    this.streamController?.abort()
    this.streamController = null
  }

  // ── /terminal WebSocket — LangChain callback stream ───────────────────────

  /**
   * Open the /terminal WebSocket and route incoming callback events to the
   * drone terminal panel.  Events arrive as {events: [{type, text}]} batches
   * every ~100ms while the agent server is running a decision.
   *
   * onEvent receives (type: TerminalEntryType, text: string) matching the
   * existing pushTerminal() signature in liveInferenceEngine.
   */
  connectTerminalStream(onEvent: (type: TerminalEntryType, text: string) => void) {
    this.onTerminalEvent = onEvent
    this.openTerminalWs()
  }

  private openTerminalWs() {
    if (this.status !== 'connected' || !this.onTerminalEvent) return
    if (this.terminalWs && this.terminalWs.readyState <= WebSocket.OPEN) return

    try {
      const ws = new WebSocket(`${this.wsBase}/terminal`)
      this.terminalWs = ws

      ws.onopen = () => {
        this.terminalFailCount = 0  // reset backoff on successful connect
        this.onTerminalEvent?.('agent', 'TERMINAL-WS  connected — LangChain callback stream active')
      }

      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data) as { events?: Array<{ type: string; text: string }> }
          for (const ev of data.events ?? []) {
            const entryType = ev.type as TerminalEntryType
            this.onTerminalEvent?.(entryType, ev.text)
          }
        } catch { /* skip malformed */ }
      }

      ws.onclose = () => {
        this.terminalWs = null
        if (this.status !== 'connected') return
        // Stop retrying after TERMINAL_MAX_FAILS consecutive failures —
        // prevents log spam when uvicorn WebSocket support is not installed.
        if (this.terminalFailCount >= AgentClient.TERMINAL_MAX_FAILS) return
        const delay = AgentClient.TERMINAL_BACKOFF_MS[
          Math.min(this.terminalFailCount, AgentClient.TERMINAL_BACKOFF_MS.length - 1)
        ]
        this.terminalFailCount++
        this.terminalReconnectTimer = setTimeout(() => this.openTerminalWs(), delay)
      }

      ws.onerror = () => {
        ws.close()
      }
    } catch { /* WebSocket constructor can throw in some envs */ }
  }

  private closeTerminalWs() {
    if (this.terminalReconnectTimer) {
      clearTimeout(this.terminalReconnectTimer)
      this.terminalReconnectTimer = null
    }
    if (this.terminalWs) {
      this.terminalWs.onclose = null  // prevent reconnect loop
      this.terminalWs.close()
      this.terminalWs = null
    }
  }

  // ── /mission/save — embed completed mission into Chroma RAG ───────────────

  /**
   * Fire-and-forget POST to /mission/save after each completed mission.
   * The agent server embeds the event log + telemetry with all-MiniLM-L6-v2
   * and stores it in the persistent Chroma collection so future /decide calls
   * can retrieve similar past missions via similarity search.
   */
  async saveMission(frame: LiveFrame) {
    if (this.status !== 'connected') return
    try {
      await fetch(`${this.baseUrl}/mission/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: frame.events,
          telemetry: {
            pollinatedIds: frame.pollinatedIds,
            discoveredIds: frame.discoveredIds,
            battery_pct:   frame.sensor.batteryPercent,
            time:          frame.time,
          },
        }),
        signal: AbortSignal.timeout(5000),
      })
    } catch { /* silently skip — agent server may be offline */ }
  }

  /** Send pollination feedback to bandit endpoint */
  async sendFeedback(success: boolean, state: { phase: string; of_stability: number; battery_pct: number }) {
    if (this.status !== 'connected') return
    try {
      await fetch(`${this.baseUrl}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...state, success }),
        signal: AbortSignal.timeout(2000),
      })
    } catch { /* silently skip */ }
  }

  disconnect() {
    this.stopCommentaryStream()
    this.closeTerminalWs()
    if (this.decideTimer) clearTimeout(this.decideTimer)
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval)
    this.onTerminalEvent = null
    this.setStatus('disconnected')
  }

  private setStatus(s: AgentStatus) {
    if (this.status !== s) {
      this.status = s
      this.onStatus(s)
      // Auto-open terminal WS once the server becomes reachable
      if (s === 'connected' && this.onTerminalEvent) {
        this.openTerminalWs()
      }
    }
  }

  getStatus() { return this.status }
}
