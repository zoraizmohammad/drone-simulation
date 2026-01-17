import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import type { ReplayFrame, EventLogEntry } from '../models/types'
import { getMissionFrames } from '../data/missionGenerator'

export type ReplaySpeed = 1 | 2 | 4

export interface ReplayState {
  currentFrame: ReplayFrame | null
  isPlaying: boolean
  speed: ReplaySpeed
  currentTime: number
  totalTime: number
  positionHistory: Array<{ x: number; y: number }>
  altitudeHistory: Array<{ time: number; z: number }>
  accumulatedEvents: EventLogEntry[]
  play: () => void
  pause: () => void
  reset: () => void
  setSpeed: (s: ReplaySpeed) => void
  seekTo: (time: number) => void
}

const POSITION_HISTORY_LENGTH = 90 // frames
const ALTITUDE_HISTORY_LENGTH = 150 // frames

export function useReplayEngine(): ReplayState {
  const frames = useRef<ReplayFrame[]>([])
  const [frameIndex, setFrameIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeedState] = useState<ReplaySpeed>(1)
  const speedRef = useRef<ReplaySpeed>(1)
  const isPlayingRef = useRef(false)
  const frameIndexRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number | null>(null)
  const accumulatedTimeRef = useRef(0)

  // Position and altitude history
  const posHistoryRef = useRef<Array<{ x: number; y: number }>>([])
  const altHistoryRef = useRef<Array<{ time: number; z: number }>>([])
  const accEventsRef = useRef<EventLogEntry[]>([])
  const [positionHistory, setPositionHistory] = useState<Array<{ x: number; y: number }>>([])
  const [altitudeHistory, setAltitudeHistory] = useState<Array<{ time: number; z: number }>>([])
  const [accumulatedEvents, setAccumulatedEvents] = useState<EventLogEntry[]>([])
  const [currentFrameData, setCurrentFrameData] = useState<ReplayFrame | null>(null)

  // Load frames once
  useEffect(() => {
    frames.current = getMissionFrames()
    if (frames.current.length > 0) {
      setCurrentFrameData(frames.current[0])
    }
  }, [])

  const FPS = 30

  const tick = useCallback((timestamp: number) => {
    if (!isPlayingRef.current) return

    if (lastTimeRef.current === null) {
      lastTimeRef.current = timestamp
    }

    const delta = timestamp - lastTimeRef.current
    lastTimeRef.current = timestamp

    // Accumulate time (speed multiplier)
    accumulatedTimeRef.current += (delta / 1000) * speedRef.current

    // How many frames to advance
    const frameDelta = Math.floor(accumulatedTimeRef.current * FPS)
    if (frameDelta > 0) {
      accumulatedTimeRef.current -= frameDelta / FPS

      const totalFrames = frames.current.length
      let newIdx = frameIndexRef.current + frameDelta

      if (newIdx >= totalFrames) {
        newIdx = totalFrames - 1
        isPlayingRef.current = false
        setIsPlaying(false)
      }

      frameIndexRef.current = newIdx
      const frame = frames.current[newIdx]

      if (frame) {
        // Update position history
        posHistoryRef.current.push({ x: frame.drone.x, y: frame.drone.y })
        if (posHistoryRef.current.length > POSITION_HISTORY_LENGTH) {
          posHistoryRef.current = posHistoryRef.current.slice(-POSITION_HISTORY_LENGTH)
        }

        // Update altitude history (every 5 frames for performance)
        if (newIdx % 5 === 0) {
          altHistoryRef.current.push({ time: frame.time, z: frame.drone.z })
          if (altHistoryRef.current.length > ALTITUDE_HISTORY_LENGTH) {
            altHistoryRef.current = altHistoryRef.current.slice(-ALTITUDE_HISTORY_LENGTH)
          }
        }

        // Accumulate events
        if (frame.events.length > 0) {
          accEventsRef.current = [...accEventsRef.current, ...frame.events]
          if (accEventsRef.current.length > 100) {
            accEventsRef.current = accEventsRef.current.slice(-100)
          }
          setAccumulatedEvents([...accEventsRef.current])
        }

        setFrameIndex(newIdx)
        setCurrentFrameData(frame)
        setPositionHistory([...posHistoryRef.current])
        setAltitudeHistory([...altHistoryRef.current])
      }
    }

    if (isPlayingRef.current) {
      rafRef.current = requestAnimationFrame(tick)
    }
  }, [])

  const play = useCallback(() => {
    if (frames.current.length === 0) return
    isPlayingRef.current = true
    lastTimeRef.current = null
    accumulatedTimeRef.current = 0
    setIsPlaying(true)
    rafRef.current = requestAnimationFrame(tick)
  }, [tick])

  const pause = useCallback(() => {
    isPlayingRef.current = false
    lastTimeRef.current = null
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setIsPlaying(false)
  }, [])

  const reset = useCallback(() => {
    pause()
    frameIndexRef.current = 0
    posHistoryRef.current = []
    altHistoryRef.current = []
    accEventsRef.current = []
    accumulatedTimeRef.current = 0
    setFrameIndex(0)
    setPositionHistory([])
    setAltitudeHistory([])
    setAccumulatedEvents([])
    if (frames.current.length > 0) {
      setCurrentFrameData(frames.current[0])
    }
  }, [pause])

  const setSpeed = useCallback((s: ReplaySpeed) => {
    speedRef.current = s
    setSpeedState(s)
  }, [])

  const seekTo = useCallback((time: number) => {
    const totalTime = frames.current.length > 0 ? frames.current[frames.current.length - 1].time : 90
    const ratio = Math.max(0, Math.min(1, time / totalTime))
    const newIdx = Math.floor(ratio * (frames.current.length - 1))
    frameIndexRef.current = newIdx
    accumulatedTimeRef.current = 0

    // Rebuild history up to this point
    const histStart = Math.max(0, newIdx - POSITION_HISTORY_LENGTH)
    posHistoryRef.current = frames.current.slice(histStart, newIdx + 1).map(f => ({ x: f.drone.x, y: f.drone.y }))
    const altHistStart = Math.max(0, newIdx - ALTITUDE_HISTORY_LENGTH * 5)
    altHistoryRef.current = frames.current
      .slice(altHistStart, newIdx + 1)
      .filter((_, i) => i % 5 === 0)
      .map(f => ({ time: f.time, z: f.drone.z }))

    // Rebuild accumulated events up to this frame
    accEventsRef.current = frames.current
      .slice(0, newIdx + 1)
      .flatMap(f => f.events)
      .slice(-100)
    setAccumulatedEvents([...accEventsRef.current])

    setFrameIndex(newIdx)
    if (frames.current[newIdx]) {
      setCurrentFrameData(frames.current[newIdx])
    }
    setPositionHistory([...posHistoryRef.current])
    setAltitudeHistory([...altHistoryRef.current])
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])

  const currentFrame = currentFrameData
  const totalTime = frames.current.length > 0 ? frames.current[frames.current.length - 1].time : 90
  const currentTime = currentFrame?.time ?? 0

  return {
    currentFrame,
    isPlaying,
    speed,
    currentTime,
    totalTime,
    positionHistory,
    altitudeHistory,
    accumulatedEvents,
    play,
    pause,
    reset,
    setSpeed,
    seekTo,
  }
}
