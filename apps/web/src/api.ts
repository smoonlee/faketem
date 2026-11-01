import type { AtemState } from '@atem-sandbox/atem-state'
import type { VideoMode } from '@atem-sandbox/shared'

export interface RuntimeStatus {
  startedAt: string
  host: string
  webPort: number
  atemPort: number
  connectedClients: number
  atemClients: number
  atemProtocol: 'stopped' | 'listening'
  deviceName: string
  deviceProfileId: string
  deviceModel: string
  videoMode: VideoMode
  deviceProfiles: readonly DeviceProfile[]
}

export interface LogEntry {
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
}

export interface LogSnapshot {
  entries: LogEntry[]
  debugEnabled: boolean
}

export interface DeviceProfile {
  id: string
  label: string
}

export interface DeviceProfileUpdate {
  modelId: string
}

export interface DeviceSettingsUpdate {
  name?: string
  videoMode?: VideoMode
}

export interface DeviceProfileUpdateResult {
  state: AtemState
  status: RuntimeStatus
}

export interface SnapshotMessage {
  type: 'snapshot'
  state: AtemState
  status: RuntimeStatus
}

export interface SandboxImportResult {
  state: AtemState
  status: RuntimeStatus
  restartRequired: boolean
}

export type ControlCommand =
  | { type: 'set-preview'; source: AtemState['preview'] }
  | { type: 'set-program'; source: AtemState['program'] }
  | {
      type: 'set-fairlight-source'
      id: number
      sourceId: string
      properties: { mixOption?: 1 | 2 | 4; faderGain?: number }
    }
  | { type: 'set-recording-status'; enabled: boolean }
  | { type: 'set-streaming-status'; enabled: boolean }
  | { type: 'set-fade-to-black-rate'; rate: number }
  | {
      type: 'set-media-pool-settings'
      maxFrames: [number, number, number, number]
      unassignedFrames: number
    }
  | { type: 'fade-to-black' }
  | { type: 'macro-run'; index: number }
  | { type: 'macro-stop' }
  | { type: 'macro-start-record'; index: number; name: string; description: string }
  | { type: 'macro-stop-record' }
  | { type: 'macro-insert-user-wait' }
  | { type: 'macro-delete'; index: number }
  | { type: 'macro-add-pause'; frames: number }
  | { type: 'set-macro-loop'; loop: boolean }
  | { type: 'macro-continue' }
  | {
      type: 'set-super-source-properties'
      ssrcId: number
      props: Partial<{
        artFillSource: number
        artCutSource: number
        artOption: number
        artPreMultiplied: boolean
        artClip: number
        artGain: number
        artInvertKey: boolean
      }>
    }
  | {
      type: 'set-super-source-border'
      ssrcId: number
      props: Partial<{
        borderEnabled: boolean
        borderBevel: number
        borderOuterWidth: number
        borderInnerWidth: number
        borderOuterSoftness: number
        borderInnerSoftness: number
        borderBevelSoftness: number
        borderBevelPosition: number
        borderHue: number
        borderSaturation: number
        borderLuma: number
        borderLightSourceDirection: number
        borderLightSourceAltitude: number
      }>
    }
  | {
      type: 'set-super-source-box'
      ssrcId: number
      boxId: number
      props: Partial<{
        enabled: boolean
        source: number
        x: number
        y: number
        size: number
        cropped: boolean
        cropTop: number
        cropBottom: number
        cropLeft: number
        cropRight: number
      }>
    }
  | { type: 'set-aux-source'; bus: 1 | 2 | 3 | 4; source: AtemState['preview'] }
  | { type: 'cut' }
  | { type: 'auto' }
  | { type: 'set-transition-type'; transitionType: 'mix' | 'dip' | 'wipe' }
  | { type: 'set-transition-rate'; rateFrames: number }
  | { type: 'set-upstream-key'; index: 1 | 2 | 3 | 4; enabled: boolean }
  | { type: 'set-upstream-key-type'; index: 1 | 2 | 3 | 4; mixEffectKeyType: 0 | 1 | 2 | 3 }
  | { type: 'set-upstream-key-fill-source'; index: 1 | 2 | 3 | 4; fillSource: number }
  | { type: 'set-upstream-key-cut-source'; index: 1 | 2 | 3 | 4; cutSource: number }
  | { type: 'set-downstream-key'; index: 1 | 2; enabled: boolean }
  | { type: 'set-downstream-key-tie'; index: 1 | 2; enabled: boolean }
  | { type: 'set-downstream-key-rate'; index: 1 | 2; rate: number }
  | { type: 'auto-downstream-key'; index: 1 | 2; isTowardsOnAir?: boolean }
  | { type: 'select-media-player-still'; player: 1 | 2; slot: number }

interface ErrorResponse {
  error?: string
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const body = (await response.json()) as T & ErrorResponse
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with HTTP ${response.status}.`)
  }
  return body
}

export async function loadInitialSnapshot(): Promise<SnapshotMessage> {
  const [stateResponse, statusResponse] = await Promise.all([
    requestJson<{ state: AtemState }>('/api/v1/state'),
    requestJson<{ status: RuntimeStatus }>('/api/v1/status'),
  ])
  return { type: 'snapshot', state: stateResponse.state, status: statusResponse.status }
}

export async function loadRecentLogs(): Promise<LogSnapshot> {
  return requestJson<LogSnapshot>('/api/v1/logs')
}

export async function sendControl(command: ControlCommand): Promise<AtemState> {
  const response = await requestJson<{ state: AtemState }>('/api/v1/control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  })
  return response.state
}

export async function updateInput(
  inputId: number,
  update: {
    longName?: string
    shortName?: string
    background?: string
    foreground?: string
  },
): Promise<AtemState> {
  const response = await requestJson<{ state: AtemState }>(`/api/v1/inputs/${inputId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(update),
  })
  return response.state
}

export async function updateMediaPlayer(
  player: 1 | 2,
  update: { name: string },
): Promise<AtemState> {
  const response = await requestJson<{ state: AtemState }>(`/api/v1/media-players/${player}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(update),
  })
  return response.state
}

export async function createMediaPoolStill(update: {
  name: string
  text: string
  background?: string
  foreground?: string
}): Promise<AtemState> {
  const response = await requestJson<{ state: AtemState }>('/api/v1/media-pool/stills', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(update),
  })
  return response.state
}

export async function deleteMediaPoolStill(slot: number): Promise<AtemState> {
  const response = await requestJson<{ state: AtemState }>(`/api/v1/media-pool/stills/${slot}`, {
    method: 'DELETE',
  })
  return response.state
}

export async function updateDeviceProfile(
  update: DeviceProfileUpdate,
): Promise<DeviceProfileUpdateResult> {
  return requestJson<DeviceProfileUpdateResult>('/api/v1/device-profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(update),
  })
}

export async function updateDeviceSettings(
  update: DeviceSettingsUpdate,
): Promise<DeviceProfileUpdateResult> {
  return requestJson<DeviceProfileUpdateResult>('/api/v1/device-settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(update),
  })
}

export async function exportSandboxConfiguration(): Promise<void> {
  const response = await fetch('/api/v1/sandbox/export')
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorResponse
    throw new Error(body.error ?? `Export failed with HTTP ${response.status}.`)
  }

  const objectUrl = URL.createObjectURL(await response.blob())
  const filename = response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/i)?.[1]
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename ?? 'atem-sandbox.json'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

export async function importSandboxConfiguration(config: unknown): Promise<SandboxImportResult> {
  return requestJson<SandboxImportResult>('/api/v1/sandbox/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  })
}

export async function resetSandboxToDefaultConfiguration(): Promise<DeviceProfileUpdateResult> {
  return requestJson<DeviceProfileUpdateResult>('/api/v1/sandbox/reset-default', {
    method: 'POST',
  })
}

export function sandboxWebSocketUrl(): string {
  const url = new URL('/ws', window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}
