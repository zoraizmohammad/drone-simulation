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
  state: 'unscanned' | 'scanned' | 'candidate' | 'locked' | 'pollinated';
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

export interface EventLogEntry {
  timestamp: number; // seconds
  message: string;
  level: 'info' | 'warn' | 'success' | 'event';
}

export interface ReplayFrame {
  time: number; // seconds from mission start
  drone: DroneState;
  sensor: SensorState;
  mission: MissionState;
  camera: CameraAnalysisState;
  flowers: FlowerCluster[]; // state of each flower at this frame
  events: EventLogEntry[];  // events that fired at this exact frame
}
