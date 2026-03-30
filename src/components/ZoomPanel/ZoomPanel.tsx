import type { ReplayFrame } from '../../models/types'
import { CameraAnalysisPanel } from '../camera-analysis/CameraAnalysisPanel'

interface Props { frame: ReplayFrame }

export function ZoomPanel({ frame }: Props) {
  return <CameraAnalysisPanel frame={frame} />
}
