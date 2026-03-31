import type { ReplayFrame } from '../../models/types'
import { CameraAnalysisPanel } from '../camera-analysis/CameraAnalysisPanel'

interface Props { frame: ReplayFrame; livePng?: string | null }

export function ZoomPanel({ frame, livePng }: Props) {
  return <CameraAnalysisPanel frame={frame} livePng={livePng} />
}
