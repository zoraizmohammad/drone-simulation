import type { DroneState, InferenceResult, LiveFlower, LivePhase, TerminalLogFn } from '../models/types'

export type WsStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface WsMessage {
  drone: { x: number; y: number; z: number; yaw: number }
  flowers: Array<{ id: string; x: number; y: number; radius: number; color: string }>
  phase: LivePhase
}

type StatusCallback = (s: WsStatus) => void
type MessageCallback = (r: InferenceResult) => void

const WS_URL = import.meta.env.VITE_INFERENCE_WS_URL ?? 'ws://localhost:8765/inference'
const MAX_BACKOFF_MS = 5000
const INFERENCE_INTERVAL_MS = 100

export class WsClient {
  private ws: WebSocket | null = null
  private status: WsStatus = 'disconnected'
  private onStatus: StatusCallback
  private onMessage: MessageCallback
  private onLog: TerminalLogFn | null
  private backoff = 500
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private inferenceTimer: ReturnType<typeof setInterval> | null = null
  private pendingMessage: WsMessage | null = null
  private closed = false

  constructor(onStatus: StatusCallback, onMessage: MessageCallback, onLog?: TerminalLogFn) {
    this.onStatus = onStatus
    this.onMessage = onMessage
    this.onLog = onLog ?? null
  }

  private log(type: Parameters<TerminalLogFn>[0], text: string) {
    this.onLog?.(type, text)
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
      this.log('sys', `WS connected → ${WS_URL}`)
      this.startInferenceLoop()
    }

    this.ws.onmessage = (ev) => {
      try {
        const result: InferenceResult = JSON.parse(ev.data)
        // Log receive summary
        const dets = result.detections
        const modeTag = result.inferenceMode === 'coral'
          ? 'CORAL-TPU'
          : result.inferenceMode === 'onnx'
          ? 'ONNX'
          : 'MOCK'
        if (dets.length > 0) {
          const detSummary = dets.map(d => `${d.id}@${(d.confidence * 100).toFixed(0)}%`).join(' ')
          this.log('ws-in', `RX ← ${modeTag} ${result.inferenceMs.toFixed(0)}ms | ${dets.length} det(s): ${detSummary}`)
          for (const d of dets) {
            this.log('detect', `  DETECT ${d.cls.padEnd(16)} ${d.id}  conf=${(d.confidence * 100).toFixed(1)}%  bbox=[${d.bbox.map(v => v.toFixed(0)).join(',')}]`)
          }
        } else {
          this.log('ws-in', `RX ← ${modeTag} ${result.inferenceMs.toFixed(0)}ms | 0 detections`)
        }
        this.onMessage(result)
      } catch { /* malformed */ }
    }

    this.ws.onerror = () => {
      this.setStatus('error')
      this.log('error', 'WS error — connection failed')
    }

    this.ws.onclose = () => {
      this.stopInferenceLoop()
      this.log('sys', 'WS connection closed')
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
    this.log('sys', 'WS disconnected by client')
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
    this.log('sys', `Reconnecting in ${(this.backoff / 1000).toFixed(1)}s…`)
    this.reconnectTimer = setTimeout(() => {
      this.backoff = Math.min(this.backoff * 1.5, MAX_BACKOFF_MS)
      this.connect()
    }, this.backoff)
  }

  private startInferenceLoop() {
    this.inferenceTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && this.pendingMessage) {
        try {
          const msg = this.pendingMessage
          this.ws.send(JSON.stringify(msg))
          const { drone, flowers, phase } = msg
          this.log('ws-out',
            `TX → phase=${phase}  pos=(${drone.x.toFixed(1)},${drone.y.toFixed(1)},${drone.z.toFixed(1)})  flowers=${flowers.length}`)
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
