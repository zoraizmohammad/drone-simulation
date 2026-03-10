export type MissionPhase =
  | 'idle' | 'arming' | 'takeoff' | 'transit'
  | 'scanning' | 'candidate_detected' | 'target_lock'
  | 'descent' | 'hover_align' | 'pollinating'
  | 'ascent' | 'resume_transit' | 'mission_complete';

export interface Waypoint {
  id: string;
  x: number; // meters in garden space
  y: number;
  label?: string;
}

export interface FlowerCluster {
  id: string;
  x: number;
  y: number;
  radius: number;
  flowerCount: number;
  color: string;       // primary petal color
  accentColor: string; // secondary/center color
  state: 'unscanned' | 'discovered' | 'scanned' | 'candidate' | 'locked' | 'pollinated';
  confidence: number;  // 0-1 detection confidence
}

export interface DroneState {
  x: number;   // meters
  y: number;
  z: number;   // altitude meters
  vx: number;  // velocity m/s
  vy: number;
  vz: number;
  yaw: number; // degrees, 0=north, clockwise
  yawRate: number;
}

export interface SensorState {
  opticalFlowQuality: number;    // 0-255
  flowVelocityX: number;
  flowVelocityY: number;
  rangefinderDistance: number;   // meters
  sonarEstimate: number;
  ekfConfidence: number;         // 0-1
  flowerDetectionConfidence: number; // 0-1
  flowersInView: number;
  targetLocked: boolean;
  pollinationTriggered: boolean;
  batteryPercent: number;
  signalStrength: number;        // 0-100
  // Extended optical flow fields (populated from distance-driven physics model)
  ofStrength: number;        // 0-255 raw signal strength from ToF sensor
  ofPrecision: number;       // 1-12 measurement precision (lower = better)
  ofStability: number;       // 0-1 derived stability index
  ofNoise: number;           // 0-1 noise level
  ofEffectiveQuality: number; // 0-255 quality weighted by strength and precision
  sensorDistanceMm: number;  // raw ToF sensor distance in mm
  distanceInches: number;    // altitude expressed in inches
}

export interface MissionState {
  phase: MissionPhase;
  currentWaypointIndex: number;
  currentTargetFlowerId: string | null;
  pollinatedFlowerIds: string[];
  totalFlowers: number;
  elapsedSeconds: number;
}

export interface CameraAnalysisState {
  visibleFlowerIds: string[];
  candidateFlowerId: string | null;
  lockedFlowerId: string | null;
  confidenceHistory: number[];   // last N confidence samples
  boundingBoxes: Array<{
    flowerId: string;
    x: number; y: number; w: number; h: number; // normalized 0-1
    confidence: number;
  }>;
}

export type SimMode = 'replay' | 'live'

export type LivePhase =
  | 'idle' | 'arming' | 'takeoff'
  | 'scanning' | 'planning'
  | 'approach' | 'descent' | 'hover_align'
  | 'pollinating' | 'ascent' | 'resume'
  | 'mission_complete' | 'landing'

export interface LiveFlower {
  id: string
  x: number
  y: number
  radius: number
  flowerCount: number
  color: string
  accentColor: string
  state: 'undiscovered' | 'discovered' | 'scanned' | 'candidate' | 'locked' | 'pollinated'
  confidence: number
}

export interface InferenceDetection {
  id: string
  confidence: number
  cls: 'flower_open' | 'flower_closed' | 'flower_cluster'
  bbox: [number, number, number, number]
}

export interface InferenceResult {
  detections: InferenceDetection[]
  phaseSuggestion: LivePhase
  targetId: string | null
  inferenceMs: number
  inferenceMode: 'onnx' | 'mock'
  framePng: string | null
  tspSuggestion: string[]  // server-computed TSP visit order for detected flowers
}

export interface LiveFrame {
  drone: DroneState
  sensor: SensorState
  flowers: LiveFlower[]
  phase: LivePhase
  inference: InferenceResult | null
  discoveredIds: string[]
  pollinatedIds: string[]
  tspRoute: string[]
  currentTargetId: string | null
  scanPassIndex: number
  scanComplete: boolean
  planningComplete: boolean
  positionHistory: Array<{ x: number; y: number }>
  altitudeHistory: Array<{ time: number; z: number }>
  events: EventLogEntry[]
  time: number
}

export interface EventLogEntry {
  timestamp: number; // seconds
  message: string;
  level: 'info' | 'warn' | 'success' | 'event';
}

export type TerminalEntryType =
  | 'sys'     // slate   — connection / session events
  | 'phase'   // purple  — drone state machine transitions
  | 'ws-out'  // blue    — WebSocket frames sent to server
  | 'ws-in'   // cyan    — WebSocket frames received from server
  | 'detect'  // green   — individual flower detections
  | 'tsp'     // amber   — TSP route planning updates
  | 'nav'     // gray    — proximity detection / navigation
  | 'error'   // red     — connection errors

export interface TerminalEntry {
  id: number
  ts: number              // performance.now() in ms at emit time
  type: TerminalEntryType
  text: string
}

/** Callback signature shared by WsClient and AutonomousNavigator */
export type TerminalLogFn = (type: TerminalEntryType, text: string, ts?: number) => void

export interface ReplayFrame {
  time: number; // seconds from mission start
  drone: DroneState;
  sensor: SensorState;
  mission: MissionState;
  camera: CameraAnalysisState;
  flowers: FlowerCluster[]; // state of each flower at this frame
  events: EventLogEntry[];  // events that fired at this exact frame
}
