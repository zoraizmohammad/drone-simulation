import type { DroneState, InferenceResult, LiveFlower, LivePhase } from '../models/types'

export type WsStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface WsMessage {
  drone: { x: number; y: number; z: number; yaw: number }
  flowers: Array<{ id: string; x: number; y: number; radius: number; color: string }>
  phase: LivePhase
}

type StatusCallback = (s: WsStatus) => void
type MessageCallback = (r: InferenceResult) => void

const WS_URL = 'ws://localhost:8765/inference'
const MAX_BACKOFF_MS = 5000
const INFERENCE_INTERVAL_MS = 100

export class WsClient {
  private ws: WebSocket | null = null
  private status: WsStatus = 'disconnected'
  private onStatus: StatusCallback
  private onMessage: MessageCallback
  private backoff = 500
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private inferenceTimer: ReturnType<typeof setInterval> | null = null
  private pendingMessage: WsMessage | null = null
  private closed = false

  constructor(onStatus: StatusCallback, onMessage: MessageCallback) {
    this.onStatus = onStatus
    this.onMessage = onMessage
  }

  connect() {
    this.closed = false
    this.setStatus('connecting')
    try {
      this.ws = new WebSocket(WS_URL)
    } catch {
      this.scheduleReconnect(); return
    }

    this.ws.onopen = () => {
      this.backoff = 500
      this.setStatus('connected')
      this.startInferenceLoop()
    }

    this.ws.onmessage = (ev) => {
      try {
        const result: InferenceResult = JSON.parse(ev.data)
        this.onMessage(result)
      } catch { /* malformed */ }
    }

    this.ws.onerror = () => {
      this.setStatus('error')
    }

    this.ws.onclose = () => {
      this.stopInferenceLoop()
      if (!this.closed) this.scheduleReconnect()
    }
  }

  send(drone: DroneState, flowers: LiveFlower[], phase: LivePhase) {
    this.pendingMessage = {
      drone: { x: drone.x, y: drone.y, z: drone.z, yaw: drone.yaw },
      flowers: flowers.map(f => ({ id: f.id, x: f.x, y: f.y, radius: f.radius, color: f.color })),
      phase,
    }
  }

  disconnect() {
    this.closed = true
    this.stopInferenceLoop()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
    this.setStatus('disconnected')
  }

  getStatus(): WsStatus { return this.status }

  private setStatus(s: WsStatus) {
    this.status = s
    this.onStatus(s)
  }

  private scheduleReconnect() {
    this.setStatus('connecting')
    this.reconnectTimer = setTimeout(() => {
      this.backoff = Math.min(this.backoff * 1.5, MAX_BACKOFF_MS)
      this.connect()
    }, this.backoff)
  }

  private startInferenceLoop() {
    this.inferenceTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && this.pendingMessage) {
        try {
          this.ws.send(JSON.stringify(this.pendingMessage))
        } catch { /* ws closed */ }
      }
    }, INFERENCE_INTERVAL_MS)
  }

  private stopInferenceLoop() {
    if (this.inferenceTimer) {
      clearInterval(this.inferenceTimer)
      this.inferenceTimer = null
    }
  }
}
