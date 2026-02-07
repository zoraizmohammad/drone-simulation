import rawCSV from '../../raw_opticalflow_data.csv?raw'

export type OpticalFlowSample = {
  distance_in: number
  sensor_distance: number
  strength: number
  precision: number
  status: number
  flow_vel_x: number
  flow_vel_y: number
  flow_quality: number
  flow_state: number
}

function parseCSV(raw: string): OpticalFlowSample[] {
  const lines = raw.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim())

  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => parseFloat(v.trim()))
    const row: Record<string, number> = {}
    headers.forEach((h, i) => { row[h] = values[i] })
    return {
      distance_in:    row['distance_in'],
      sensor_distance: row['sensor_distance'],
      strength:       row['strength'],
      precision:      row['precision'],
      status:         row['status'],
      flow_vel_x:     row['flow_vel_x'],
      flow_vel_y:     row['flow_vel_y'],
      flow_quality:   row['flow_quality'],
      flow_state:     row['flow_state'],
    }
  })
}

export const RAW_OPTICAL_FLOW_DATA: OpticalFlowSample[] = parseCSV(rawCSV)
