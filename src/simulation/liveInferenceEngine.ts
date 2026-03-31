import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import type { LiveFrame, InferenceResult, TerminalEntry, TerminalEntryType } from '../models/types'
import { AutonomousNavigator } from './autonomousNavigator'
import { WsClient, type WsStatus } from './wsClient'

const MAX_TERMINAL = 500

export interface LiveInferenceState {
  currentFrame: LiveFrame | null
  wsStatus: WsStatus
  inferenceMode: 'onnx' | 'mock' | null
  inferenceMs: number
  isRunning: boolean
  terminalEntries: TerminalEntry[]
  restart: () => void
  stop: () => void
}

async function spawnInferenceServer() {
  try {
    await fetch('/api/start-inference-server', { method: 'POST' })
  } catch {
    // Vite middleware may not be available in production; silently continue
  }
}

export function useLiveInferenceEngine(): LiveInferenceState {
  const navRef      = useRef<AutonomousNavigator | null>(null)
  const wsRef       = useRef<WsClient | null>(null)
  const rafRef      = useRef<number | null>(null)
  const lastTimeRef = useRef<number | null>(null)
  const latestInf   = useRef<InferenceResult | null>(null)

  const [frame, setFrame]           = useState<LiveFrame | null>(null)
  const [wsStatus, setWsStatus]     = useState<WsStatus>('disconnected')
  const [inferenceMode, setInfMode] = useState<'onnx' | 'mock' | null>(null)
  const [inferenceMs, setInfMs]     = useState(0)
  const [isRunning, setIsRunning]   = useState(false)

  // Terminal log: accumulate in a ref, sync to state every 250 ms
  const termBufRef   = useRef<TerminalEntry[]>([])
  const termIdRef    = useRef(0)
  const termSyncRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const [terminalEntries, setTermEntries] = useState<TerminalEntry[]>([])

  const pushTerminal = useCallback((type: TerminalEntryType, text: string) => {
    const entry: TerminalEntry = { id: ++termIdRef.current, ts: performance.now(), type, text }
    termBufRef.current = [...termBufRef.current, entry].slice(-MAX_TERMINAL)
  }, [])

  const onWsMessage = useCallback((result: InferenceResult) => {
    latestInf.current = result
    setInfMode(result.inferenceMode)
    setInfMs(result.inferenceMs)
  }, [])

  const onWsStatus = useCallback((s: WsStatus) => {
    setWsStatus(s)
  }, [])

  const tick = useCallback((ts: number) => {
    if (lastTimeRef.current === null) lastTimeRef.current = ts
    const dt = Math.min((ts - lastTimeRef.current) / 1000, 0.1) // cap at 100ms
    lastTimeRef.current = ts

    const nav = navRef.current
    const ws  = wsRef.current
    if (!nav) return

    const lf = nav.tick(dt, latestInf.current)

    // Queue the latest state for the WS send
    if (ws) ws.send(lf.drone, lf.flowers, lf.phase)

    setFrame(lf)

    // Stop the RAF loop once the navigator has fully landed
    if (nav.done) {
      rafRef.current = null
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  const start = useCallback(async () => {
    // Reset terminal
    termBufRef.current = []
    termIdRef.current  = 0
    setTermEntries([])
    pushTerminal('sys', 'SESSION START — live inference engine initialising…')

    await spawnInferenceServer()
    // Small delay to give server time to boot
    await new Promise(r => setTimeout(r, 800))

    const nav = new AutonomousNavigator(Date.now())
    nav.setTerminalCallback(pushTerminal)
    navRef.current = nav

    const ws = new WsClient(onWsStatus, onWsMessage, pushTerminal)
    wsRef.current = ws
    ws.connect()

    // Sync terminal buffer to state every 250 ms
    if (termSyncRef.current) clearInterval(termSyncRef.current)
    termSyncRef.current = setInterval(() => {
      setTermEntries(prev =>
        termBufRef.current.length !== prev.length ? [...termBufRef.current] : prev
      )
    }, 250)

    lastTimeRef.current = null
    latestInf.current   = null
    setIsRunning(true)
    rafRef.current = requestAnimationFrame(tick)
  }, [tick, onWsStatus, onWsMessage, pushTerminal])

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (termSyncRef.current) { clearInterval(termSyncRef.current); termSyncRef.current = null }
    wsRef.current?.disconnect()
    wsRef.current  = null
    navRef.current = null
    setIsRunning(false)
    setFrame(null)
    setWsStatus('disconnected')
    setTermEntries([])
    termBufRef.current = []
  }, [])

  const restart = useCallback(() => {
    stop()
    setTimeout(start, 100)
  }, [stop, start])

  // Auto-start when hook mounts
  useEffect(() => {
    start()
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      wsRef.current?.disconnect()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { currentFrame: frame, wsStatus, inferenceMode, inferenceMs, isRunning, terminalEntries, restart, stop }
}
