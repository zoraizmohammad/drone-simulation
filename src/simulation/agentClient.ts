/**
 * Agent client — connects to the agent server on port 8766.
 * Provides two channels:
 *   1. /decide  (HTTP POST, 200ms debounce) — planning decisions
 *   2. /stream  (SSE GET) — streaming commentary
 */
import type { AgentDecision, AgentCommentaryEntry, LiveFrame } from '../models/types'

export type AgentStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export class AgentClient {
  private baseUrl: string
  private status: AgentStatus = 'disconnected'
  private decideTimer: ReturnType<typeof setTimeout> | null = null
  private streamController: AbortController | null = null
  private onDecision: (d: AgentDecision) => void
  private onCommentary: (e: AgentCommentaryEntry) => void
  private onStatus: (s: AgentStatus) => void
  private commentaryIdRef = 0
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null

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
  }

  connect() {
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
    if (this.decideTimer) clearTimeout(this.decideTimer)
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval)
    this.setStatus('disconnected')
  }

  private setStatus(s: AgentStatus) {
    if (this.status !== s) {
      this.status = s
      this.onStatus(s)
    }
  }

  getStatus() { return this.status }
}
