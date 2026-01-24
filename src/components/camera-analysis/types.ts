export interface FlowerRenderState {
  id: string
  cx: number
  cy: number
  scale: number
  color: string
  accentColor: string
  rngSeed: number
  state: 'unscanned' | 'scanned' | 'candidate' | 'locked' | 'pollinated'
  confidence: number
  isTarget: boolean
}

export interface FrustumState {
  // normalized 0-1 position of scan center
  centerX: number
  centerY: number
  // 0-1 tightness: 0=broad search, 1=tight lock
  tightness: number
}

export interface AnalysisFrame {
  phase: string
  targetId: string | null
  confidence: number
  flowersInView: number
  targetLocked: boolean
  pollinationActive: boolean
  pollinatedIds: string[]
  altitude: number
  time: number
  confidenceHistory: number[]
  flowers: FlowerRenderState[]
  frustum: FrustumState
}
