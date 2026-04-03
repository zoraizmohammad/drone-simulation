import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import type { LiveFrame, InferenceResult, TerminalEntry, TerminalEntryType, AgentDecision, AgentCommentaryEntry, AgentState } from '../models/types'
import { AutonomousNavigator } from './autonomousNavigator'
import { WsClient, type WsStatus } from './wsClient'
import { AgentClient, type AgentStatus } from './agentClient'

const MAX_TERMINAL = 500

export interface LiveInferenceState {
  currentFrame: LiveFrame | null
  wsStatus: WsStatus
  inferenceMode: 'coral' | 'onnx' | 'mock' | null
  inferenceMs: number
  isRunning: boolean
  terminalEntries: TerminalEntry[]
  agentStatus: AgentStatus
  agentState: AgentState
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

const AGENT_DECISION_EVERY_N_FRAMES = 30  // ~1 second at 30fps

export function useLiveInferenceEngine(): LiveInferenceState {
  const navRef       = useRef<AutonomousNavigator | null>(null)
  const wsRef        = useRef<WsClient | null>(null)
  const agentRef     = useRef<AgentClient | null>(null)
  const rafRef       = useRef<number | null>(null)
  const lastTimeRef  = useRef<number | null>(null)
  const latestInf    = useRef<InferenceResult | null>(null)
  const frameIdxRef  = useRef(0)
  const lastPhaseRef = useRef<string>('')

  const [frame, setFrame]           = useState<LiveFrame | null>(null)
  const [wsStatus, setWsStatus]     = useState<WsStatus>('disconnected')
  const [inferenceMode, setInfMode] = useState<'coral' | 'onnx' | 'mock' | null>(null)
  const [inferenceMs, setInfMs]     = useState(0)
  const [isRunning, setIsRunning]   = useState(false)

  // Agent state
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('disconnected')
  const lastDecisionRef   = useRef<AgentDecision | null>(null)
  const commentaryRef     = useRef<AgentCommentaryEntry[]>([])
  const agentMsRef        = useRef(0)
  const decisionsTotalRef = useRef(0)
  const overridesRef      = useRef(0)
  const [agentState, setAgentState] = useState<AgentState>({
    isConnected: false, lastDecision: null, commentary: [],
    agentMs: 0, decisionsTotal: 0, overridesApplied: 0,
  })

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

  const onAgentDecision = useCallback((d: AgentDecision) => {
    lastDecisionRef.current = d
    agentMsRef.current = d.decisionMs
    decisionsTotalRef.current++

    // Apply override to navigator if route is suggested
    const nav = navRef.current
    if (nav && d.priorityOverride.length > 0) {
      nav.applyAgentDecision(d)
      overridesRef.current++
    }

    // Apply confidence threshold if provided
    if (nav && d.confidenceThreshold) {
      nav.currentConfidenceThreshold = d.confidenceThreshold
    }

    setAgentState({
      isConnected: true,
      lastDecision: d,
      commentary: [...commentaryRef.current],
      agentMs: d.decisionMs,
      decisionsTotal: decisionsTotalRef.current,
      overridesApplied: overridesRef.current,
    })
  }, [])

  const onAgentCommentary = useCallback((entry: AgentCommentaryEntry) => {
    const existing = commentaryRef.current
    // Update existing streaming entry or append new
    const idx = existing.findIndex(e => e.id === entry.id)
    if (idx >= 0) {
      commentaryRef.current = [...existing.slice(0, idx), entry, ...existing.slice(idx + 1)].slice(-10)
    } else {
      commentaryRef.current = [...existing, entry].slice(-10)
    }
    setAgentState(prev => ({ ...prev, commentary: [...commentaryRef.current] }))
  }, [])

  const onAgentStatus = useCallback((s: AgentStatus) => {
    setAgentStatus(s)
    setAgentState(prev => ({ ...prev, isConnected: s === 'connected' }))
  }, [])

  const tick = useCallback((ts: number) => {
    if (lastTimeRef.current === null) lastTimeRef.current = ts
    const dt = Math.min((ts - lastTimeRef.current) / 1000, 0.1) // cap at 100ms
    lastTimeRef.current = ts

    const nav   = navRef.current
    const ws    = wsRef.current
    const agent = agentRef.current
    if (!nav) return

    frameIdxRef.current++
    const lf = nav.tick(dt, latestInf.current)

    // Queue the latest state for the WS send
    if (ws) ws.send(lf.drone, lf.flowers, lf.phase)

    // Request agent decision every N frames
    if (agent && frameIdxRef.current % AGENT_DECISION_EVERY_N_FRAMES === 0) {
      agent.requestDecision(lf)
    }

    // Start commentary stream on phase transitions
    if (agent && lf.phase !== lastPhaseRef.current) {
      lastPhaseRef.current = lf.phase
      agent.startCommentaryStream(lf)
    }

    // Attach agent state to live frame
    const lfWithAgent: LiveFrame = {
      ...lf,
      agent: {
        isConnected: agentStatus === 'connected',
        lastDecision: lastDecisionRef.current,
        commentary: commentaryRef.current,
        agentMs: agentMsRef.current,
        decisionsTotal: decisionsTotalRef.current,
        overridesApplied: overridesRef.current,
      },
    }

    setFrame(lfWithAgent)

    // Stop the RAF loop once the navigator has fully landed
    if (nav.done) {
      rafRef.current = null
      // Embed completed mission into Chroma RAG store so future /decide calls
      // can retrieve it as context via similarity search.
      if (agent) {
        pushTerminal('agent', `MISSION-SAVE  embedding ${lf.pollinatedIds.length}/${lf.flowers.length} pollinated, ${lf.time.toFixed(0)}s into RAG store`)
        agent.saveMission(lf)
      }
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [agentStatus])

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

    // Agent client — silently degrades if server unavailable
    const agent = new AgentClient(onAgentDecision, onAgentCommentary, onAgentStatus)
    agentRef.current = agent
    agent.connect()
    // Wire LangChain callback stream → drone terminal panel.
    // Once /health returns 200, openTerminalWs() is called automatically
    // inside setStatus('connected') in AgentClient.
    agent.connectTerminalStream(pushTerminal)
    pushTerminal('sys', 'AGENT-CLIENT  connecting to :8766 — LangChain callback stream requested')
    lastPhaseRef.current = ''
    frameIdxRef.current  = 0

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
  }, [tick, onWsStatus, onWsMessage, pushTerminal, onAgentDecision, onAgentCommentary, onAgentStatus])

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (termSyncRef.current) { clearInterval(termSyncRef.current); termSyncRef.current = null }
    wsRef.current?.disconnect()
    agentRef.current?.disconnect()
    wsRef.current    = null
    agentRef.current = null
    navRef.current   = null
    setIsRunning(false)
    setFrame(null)
    setWsStatus('disconnected')
    setAgentStatus('disconnected')
    setAgentState({ isConnected: false, lastDecision: null, commentary: [], agentMs: 0, decisionsTotal: 0, overridesApplied: 0 })
    setTermEntries([])
    termBufRef.current      = []
    lastDecisionRef.current = null
    commentaryRef.current   = []
    decisionsTotalRef.current = 0
    overridesRef.current      = 0
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

  return { currentFrame: frame, wsStatus, inferenceMode, inferenceMs, isRunning, terminalEntries, agentStatus, agentState, restart, stop }
}
