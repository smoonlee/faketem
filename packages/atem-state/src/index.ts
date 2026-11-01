import {
  atemIdToSourceRef,
  frameDurationMs,
  getAtemDeviceProfile,
  INPUT_IDS,
  MACRO_COUNT,
  MEDIA_PLAYER_IDS,
  inputSource,
  mediaPlayerSource,
  sourceKey,
  sourcesMatch,
  type AtemInputConfig,
  type AtemSandboxConfig,
  type InputId,
  type MediaPlayerId,
  type MediaPoolStill,
  type SourceRef,
  type TransitionType,
  type VideoMode,
} from '@atem-sandbox/shared'

export type ActionOrigin = 'ui' | 'api' | 'atem-protocol' | 'system'

export type AtemActionType =
  | 'set-preview'
  | 'set-program'
  | 'set-recording-status'
  | 'set-recording-iso'
  | 'switch-recording-disk'
  | 'set-streaming-status'
  | 'set-streaming-service'
  | 'set-streaming-audio-bitrates'
  | 'set-video-mode-code'
  | 'set-media-pool-settings'
  | 'save-startup-state'
  | 'clear-startup-state'
  | 'set-time-mode'
  | 'set-time'
  | 'set-display-clock-state'
  | 'set-display-clock-properties'
  | 'set-multiviewer-properties'
  | 'set-multiviewer-window-source'
  | 'set-classic-audio-master'
  | 'set-fairlight-master'
  | 'set-fairlight-source'
  | 'set-camera-control'
  | 'set-fade-to-black-rate'
  | 'fade-to-black'
  | 'macro-run'
  | 'macro-stop'
  | 'macro-continue'
  | 'macro-insert-user-wait'
  | 'macro-start-record'
  | 'macro-stop-record'
  | 'macro-delete'
  | 'macro-update-properties'
  | 'macro-add-pause'
  | 'set-macro-loop'
  | 'set-super-source-properties'
  | 'set-super-source-border'
  | 'set-super-source-box'
  | 'cut'
  | 'auto-start'
  | 'auto-progress'
  | 'auto-complete'
  | 'set-transition-type'
  | 'set-transition-rate'
  | 'select-media-player-still'
  | 'set-aux-source'
  | 'upsert-media-pool-still'
  | 'delete-media-pool-still'
  | 'update-media-player'
  | 'update-device-settings'
  | 'update-input'
  | 'set-upstream-key'
  | 'set-upstream-key-luma'
  | 'set-upstream-key-type'
  | 'set-upstream-key-fill-source'
  | 'set-upstream-key-cut-source'
  | 'set-downstream-key'
  | 'set-downstream-key-tie'
  | 'set-downstream-key-rate'
  | 'auto-downstream-key'
  | 'load-config'

export interface AtemActionMeta {
  type: AtemActionType
  origin: ActionOrigin
  macroOperation?: MacroOperation
  macroIndex?: number
  isTimerUpdate?: boolean
}

export interface AtemInput extends AtemInputConfig {
  id: InputId
}

export interface MediaPlayerState {
  name: string
  type: 'still'
  slot: number
}

export interface DownstreamKeyState {
  onAir: boolean
  tie: boolean
  rate: number
  isAuto: boolean
  inTransition: boolean
  isTowardsOnAir: boolean
  remainingFrames: number
}

export interface UpstreamKeyPropertyState {
  mixEffectKeyType: 0 | 1 | 2 | 3
  flyEnabled: boolean
  fillSource: number
  cutSource: number
}

export interface UpstreamKeyLumaState {
  preMultiplied: boolean
  clip: number
  gain: number
  invert: boolean
}

export interface TransitionState {
  type: TransitionType
  rateFrames: number
  inTransition: boolean
  /** A fraction from 0 (Program) to 1 (Preview). */
  position: number
  /** Captured endpoints make the visual mix stable for its complete duration. */
  fromProgram: SourceRef | null
  toProgram: SourceRef | null
}

export interface FadeToBlackState {
  rate: number
  isFullyBlack: boolean
  inTransition: boolean
  remainingFrames: number
}

export interface MacroPlayerState {
  isRunning: boolean
  isWaiting: boolean
  loop: boolean
  macroIndex: number
}

export type MacroOperation =
  | { type: 'set-program'; source: SourceRef }
  | { type: 'set-preview'; source: SourceRef }
  | { type: 'cut' }
  | { type: 'wait' }
  | { type: 'pause'; frames: number }
  | { type: 'auto' }
  | { type: 'set-transition-type'; transitionType: TransitionType }
  | { type: 'set-transition-rate'; rateFrames: number }
  | { type: 'set-aux-source'; bus: 1 | 2 | 3 | 4; source: SourceRef }
  | { type: 'select-media-player-still'; player: MediaPlayerId; slot: number }
  | { type: 'set-upstream-key'; index: 1 | 2 | 3 | 4; enabled: boolean }
  | { type: 'set-upstream-key-type'; index: 1 | 2 | 3 | 4; mixEffectKeyType: 0 | 1 | 2 | 3 }
  | {
      type: 'set-upstream-key-luma'
      index: 1 | 2 | 3 | 4
      properties: { [Key in keyof UpstreamKeyLumaState]?: UpstreamKeyLumaState[Key] | undefined }
    }
  | { type: 'set-upstream-key-fill-source'; index: 1 | 2 | 3 | 4; fillSource: number }
  | { type: 'set-upstream-key-cut-source'; index: 1 | 2 | 3 | 4; cutSource: number }
  | { type: 'set-downstream-key'; index: 1 | 2; enabled: boolean }
  | { type: 'set-downstream-key-tie'; index: 1 | 2; enabled: boolean }
  | { type: 'set-downstream-key-rate'; index: 1 | 2; rate: number }

export interface RecordedMacro {
  name: string
  description: string
  operations: MacroOperation[]
  hasUnsupportedOps: boolean
}

export interface MacroState {
  macroPlayer: MacroPlayerState
  macroRecorder: { isRecording: boolean; macroIndex: number }
  macros: Record<number, RecordedMacro>
  lastError: string | null
}

export interface SuperSourceBoxState {
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
}

export interface SuperSourcePropertiesState {
  artFillSource: number
  artCutSource: number
  artOption: number
  artPreMultiplied: boolean
  artClip: number
  artGain: number
  artInvertKey: boolean
}

export interface SuperSourceBorderState {
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
}

export interface SuperSourceState {
  index: number
  boxes: [
    SuperSourceBoxState | undefined,
    SuperSourceBoxState | undefined,
    SuperSourceBoxState | undefined,
    SuperSourceBoxState | undefined,
  ]
  properties?: SuperSourcePropertiesState
  border?: SuperSourceBorderState
}

export interface TimecodeState {
  hours: number
  minutes: number
  seconds: number
  frames: number
  isDropFrame: boolean
}

export interface RecordingStatusState {
  state: number
  error: number
  recordingTimeAvailable: number
}

export interface RecordingPropertiesState {
  filename: string
  workingSet1DiskId: number
  workingSet2DiskId: number
  recordInAllCameras: boolean
}

export interface RecordingState {
  status: RecordingStatusState
  properties: RecordingPropertiesState
  recordAllInputs: boolean
  duration?: TimecodeState
  disks: Record<
    number,
    { diskId: number; volumeName: string; recordingTimeAvailable: number; status: number }
  >
}

export interface StreamingStatusState {
  state: number
  error: number
}

export interface StreamingState {
  status: StreamingStatusState
  stats?: { cacheUsed: number; encodingBitrate: number }
  service: { serviceName: string; url: string; key: string; bitrates: [number, number] }
  duration?: TimecodeState
  audioBitrates?: { lowBitrate: number; highBitrate: number }
}

export interface SandboxSettingsState {
  videoModeCode: number
  startupStateSaved: boolean
  timeMode: number
  mediaPool: {
    maxFrames: [number, number, number, number]
    unassignedFrames: number
  }
}

export interface DisplayClockPropertiesState {
  enabled: boolean
  size: number
  opacity: number
  positionX: number
  positionY: number
  autoHide: boolean
  startFrom: {
    hours: number
    minutes: number
    seconds: number
    frames: number
  }
  startFromFrames: number
  clockMode: number
  clockState: number
}

export interface DisplayClockState {
  properties: DisplayClockPropertiesState
  currentTime: {
    hours: number
    minutes: number
    seconds: number
    frames: number
  }
}

export interface MultiviewerWindowState {
  source: number
  supportsVuMeter: boolean
  supportsSafeArea: boolean
  audioMeter: boolean
}

export interface MultiviewerState {
  count: number
  windowCount: number
  properties: {
    layout: number
    programPreviewSwapped: boolean
  }
  windows: Record<number, MultiviewerWindowState>
}

export interface ClassicAudioMasterState {
  gain: number
  balance: number
  followFadeToBlack: boolean
}

export interface FairlightMasterState {
  bandCount: number
  equalizerEnabled: boolean
  equalizerGain: number
  makeUpGain: number
  faderGain: number
  followFadeToBlack: boolean
}

export interface FairlightInputState {
  id: number
  sourceId: string
  mixOption: 1 | 2 | 4
  faderGain: number
}

export interface CameraControlState {
  source: number
  category: number
  parameter: number
  type: number
  periodicFlushEnabled: boolean
  numberData: number[]
  bigintData: bigint[]
  boolData: boolean[]
  stringData: string
}

export const ATEM_RECORDING_STATUS_IDLE = 0
export const ATEM_RECORDING_STATUS_RECORDING = 1 << 0
export const ATEM_RECORDING_STATUS_STOPPING = 1 << 7
export const ATEM_RECORDING_ERROR_NO_MEDIA = 0
export const ATEM_RECORDING_ERROR_NONE = 1 << 1
export const ATEM_RECORDING_ERROR_MEDIA_FULL = 1 << 2

export const ATEM_RECORDING_DISK_STATUS_IDLE = 1 << 0
export const ATEM_RECORDING_DISK_STATUS_UNFORMATTED = 1 << 1
export const ATEM_RECORDING_DISK_STATUS_ACTIVE = 1 << 2
export const ATEM_RECORDING_DISK_STATUS_RECORDING = 1 << 3
export const ATEM_RECORDING_DISK_STATUS_REMOVED = 1 << 5

export const ATEM_STREAMING_STATUS_IDLE = 1 << 0
export const ATEM_STREAMING_STATUS_CONNECTING = 1 << 1
export const ATEM_STREAMING_STATUS_STREAMING = 1 << 2
export const ATEM_STREAMING_STATUS_STOPPING = 1 << 5
export const ATEM_STREAMING_ERROR_NONE = 0
export const ATEM_STREAMING_ERROR_INVALID_STATE = 1 << 4

const VIDEO_MODE_CODES: Record<VideoMode, number> = {
  '720p50': 4,
  '1080p25': 10,
  '1080p50': 12,
}

export interface AtemState {
  revision: number
  program: SourceRef
  preview: SourceRef
  transition: TransitionState
  fadeToBlack: FadeToBlackState
  macro: MacroState
  superSources: SuperSourceState[]
  recording: RecordingState
  streaming: StreamingState
  settings: SandboxSettingsState
  displayClock: DisplayClockState
  multiviewer: MultiviewerState
  classicAudio: { master: ClassicAudioMasterState }
  fairlightAudio: { master: FairlightMasterState; inputs: Record<number, FairlightInputState> }
  cameraControl: CameraControlState
  inputs: AtemInput[]
  mediaPlayers: Record<MediaPlayerId, MediaPlayerState>
  auxiliaries: Record<number, SourceRef>
  mediaPool: {
    stills: MediaPoolStill[]
  }
  upstreamKeys: Record<number, boolean>
  upstreamKeyProperties: Record<number, UpstreamKeyPropertyState>
  upstreamKeyLuma: Record<number, UpstreamKeyLumaState>
  downstreamKeys: Record<number, DownstreamKeyState>
}

export interface StateChange {
  action: AtemActionMeta
  state: AtemState
}

export interface TransitionScheduler {
  now(): number
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

const defaultScheduler: TransitionScheduler = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class AtemStateError extends Error {
  public constructor(
    public readonly code:
      | 'invalid-source'
      | 'invalid-macro'
      | 'invalid-media-slot'
      | 'transition-in-progress'
      | 'invalid-transition-rate',
    message: string,
  ) {
    super(message)
    this.name = 'AtemStateError'
  }
}

export interface AutoOptions {
  /** Test-only override. Normal callers should use configured rateFrames and video mode. */
  durationMs?: number
}

export interface SourceSurface {
  source: SourceRef
  title: string
  subtitle: string
  kind: 'input' | 'generated-still' | 'image-still' | 'missing-still' | 'super-source'
  background: string
  foreground: string
  text: string
  mediaFile: string | null
}

function cloneState(state: AtemState): AtemState {
  return structuredClone(state)
}

function zeroTimecode(): TimecodeState {
  return {
    hours: 0,
    minutes: 0,
    seconds: 0,
    frames: 0,
    isDropFrame: false,
  }
}

function incrementTimecode(timecode: TimecodeState): TimecodeState {
  let hours = timecode.hours
  let minutes = timecode.minutes
  let seconds = timecode.seconds + 1

  if (seconds >= 60) {
    seconds = 0
    minutes += 1
  }
  if (minutes >= 60) {
    minutes = 0
    hours += 1
  }

  return {
    hours,
    minutes,
    seconds,
    frames: 0,
    isDropFrame: false,
  }
}

function isIsoCapableModel(modelId: AtemSandboxConfig['device']['modelId']): boolean {
  return modelId.includes('iso')
}

function createDefaultSuperSource(
  profileId: AtemSandboxConfig['device']['modelId'],
): SuperSourceState[] {
  const count = getAtemDeviceProfile(profileId).effects.superSource
  if (count === 0) {
    return []
  }

  return [
    {
      index: 0,
      boxes: [
        {
          enabled: false,
          source: 1,
          x: 0,
          y: 0,
          size: 700,
          cropped: false,
          cropTop: 0,
          cropBottom: 0,
          cropLeft: 0,
          cropRight: 0,
        },
        {
          enabled: false,
          source: 2,
          x: 0,
          y: 0,
          size: 700,
          cropped: false,
          cropTop: 0,
          cropBottom: 0,
          cropLeft: 0,
          cropRight: 0,
        },
        {
          enabled: false,
          source: 3,
          x: 0,
          y: 0,
          size: 700,
          cropped: false,
          cropTop: 0,
          cropBottom: 0,
          cropLeft: 0,
          cropRight: 0,
        },
        {
          enabled: false,
          source: 4,
          x: 0,
          y: 0,
          size: 700,
          cropped: false,
          cropTop: 0,
          cropBottom: 0,
          cropLeft: 0,
          cropRight: 0,
        },
      ],
      properties: {
        artFillSource: 0,
        artCutSource: 0,
        artOption: 0,
        artPreMultiplied: false,
        artClip: 0,
        artGain: 0,
        artInvertKey: false,
      },
      border: {
        borderEnabled: false,
        borderBevel: 0,
        borderOuterWidth: 0,
        borderInnerWidth: 0,
        borderOuterSoftness: 0,
        borderInnerSoftness: 0,
        borderBevelSoftness: 0,
        borderBevelPosition: 0,
        borderHue: 0,
        borderSaturation: 0,
        borderLuma: 0,
        borderLightSourceDirection: 0,
        borderLightSourceAltitude: 0,
      },
    },
  ]
}

function createDefaultMultiviewer(): MultiviewerState {
  const windows: Record<number, MultiviewerWindowState> = {}
  for (let index = 0; index < 10; index += 1) {
    windows[index] = {
      source: index + 1,
      supportsVuMeter: true,
      supportsSafeArea: true,
      audioMeter: false,
    }
  }
  return {
    count: 1,
    windowCount: 10,
    properties: {
      layout: 0,
      programPreviewSwapped: false,
    },
    windows,
  }
}

function asInputId(inputId: number): InputId {
  if (!INPUT_IDS.includes(inputId as InputId)) {
    throw new AtemStateError('invalid-source', `Input ${inputId} is not available in this sandbox.`)
  }
  return inputId as InputId
}

function sourceFromConfigId(sourceId: number, inputs: readonly AtemInputConfig[]): SourceRef {
  const source = atemIdToSourceRef(sourceId)
  if (source === undefined) {
    throw new AtemStateError(
      'invalid-source',
      `ATEM source ID ${sourceId} is not available in this sandbox.`,
    )
  }
  if (source.kind === 'input' && !inputs.some((input) => input.id === source.inputId)) {
    throw new AtemStateError(
      'invalid-source',
      `Input ${source.inputId} is not available in this sandbox.`,
    )
  }
  return source
}

export function createInitialAtemState(config: AtemSandboxConfig): AtemState {
  return {
    revision: 0,
    program: sourceFromConfigId(config.initialState.program, config.inputs),
    preview: sourceFromConfigId(config.initialState.preview, config.inputs),
    transition: {
      type: config.transition.type,
      rateFrames: config.transition.rateFrames,
      inTransition: false,
      position: 0,
      fromProgram: null,
      toProgram: null,
    },
    fadeToBlack: {
      rate: config.transition.fadeToBlackRate,
      isFullyBlack: false,
      inTransition: false,
      remainingFrames: 0,
    },
    macro: {
      macroPlayer: {
        isRunning: false,
        isWaiting: false,
        loop: false,
        macroIndex: 0,
      },
      macroRecorder: { isRecording: false, macroIndex: 0 },
      macros: structuredClone(config.macros ?? {}),
      lastError: null,
    },
    superSources: createDefaultSuperSource(config.device.modelId),
    recording: {
      status: {
        state: ATEM_RECORDING_STATUS_IDLE,
        error: ATEM_RECORDING_ERROR_NONE,
        recordingTimeAvailable: 60 * 60,
      },
      properties: {
        filename: '',
        workingSet1DiskId: 1,
        workingSet2DiskId: 0,
        recordInAllCameras: false,
      },
      recordAllInputs: false,
      duration: zeroTimecode(),
      disks: {
        1: {
          diskId: 1,
          volumeName: 'Disk 1',
          recordingTimeAvailable: 60 * 60,
          status: ATEM_RECORDING_DISK_STATUS_IDLE | ATEM_RECORDING_DISK_STATUS_ACTIVE,
        },
        2: {
          diskId: 2,
          volumeName: 'Disk 2',
          recordingTimeAvailable: 45 * 60,
          status: ATEM_RECORDING_DISK_STATUS_IDLE,
        },
      },
    },
    streaming: {
      status: {
        state: ATEM_STREAMING_STATUS_IDLE,
        error: ATEM_STREAMING_ERROR_NONE,
      },
      service: {
        serviceName: 'ATEM Sandbox RTMP',
        url: 'rtmp://sandbox.local/live',
        key: 'sandbox',
        bitrates: [4_000_000, 6_000_000],
      },
      duration: zeroTimecode(),
      stats: {
        cacheUsed: 0,
        encodingBitrate: 6_000_000,
      },
      audioBitrates: {
        lowBitrate: 128_000,
        highBitrate: 192_000,
      },
    },
    settings: {
      videoModeCode: VIDEO_MODE_CODES[config.device.videoMode] ?? 12,
      startupStateSaved: false,
      timeMode: 0,
      mediaPool: {
        maxFrames: structuredClone(config.mediaPool.settings.maxFrames),
        unassignedFrames: config.mediaPool.settings.unassignedFrames,
      },
    },
    displayClock: {
      properties: {
        enabled: false,
        size: 0,
        opacity: 255,
        positionX: 0,
        positionY: 0,
        autoHide: false,
        startFrom: {
          hours: 0,
          minutes: 0,
          seconds: 0,
          frames: 0,
        },
        startFromFrames: 0,
        clockMode: 0,
        clockState: 0,
      },
      currentTime: {
        hours: 0,
        minutes: 0,
        seconds: 0,
        frames: 0,
      },
    },
    multiviewer: createDefaultMultiviewer(),
    classicAudio: {
      master: {
        gain: 0,
        balance: 0,
        followFadeToBlack: false,
      },
    },
    fairlightAudio: {
      inputs: Object.fromEntries(
        (config.device.modelId === 'atem-mini-extreme-iso-g2' ? [1001, 1002] : [1301, 1302]).map(
          (id) => [id, { id, sourceId: '-65280', mixOption: 1 as const, faderGain: 0 }],
        ),
      ),
      master: {
        bandCount: 0,
        equalizerEnabled: false,
        equalizerGain: 0,
        makeUpGain: 0,
        faderGain: 0,
        followFadeToBlack: false,
      },
    },
    cameraControl: {
      source: 1,
      category: 0,
      parameter: 0,
      type: 1,
      periodicFlushEnabled: false,
      numberData: [],
      bigintData: [],
      boolData: [],
      stringData: '',
    },
    inputs: config.inputs.map((input) => ({ ...input, id: asInputId(input.id) })),
    mediaPlayers: {
      1: { ...config.mediaPlayers[1] },
      2: { ...config.mediaPlayers[2] },
    },
    auxiliaries: {
      1: sourceFromConfigId(config.auxiliaries[1], config.inputs),
      2: sourceFromConfigId(config.auxiliaries[2], config.inputs),
      3: sourceFromConfigId(config.auxiliaries[3], config.inputs),
      4: sourceFromConfigId(config.auxiliaries[4], config.inputs),
    },
    mediaPool: {
      stills: structuredClone(config.mediaPool.stills),
    },
    upstreamKeys: { ...config.keyers.upstream },
    upstreamKeyProperties: {
      1: { ...config.keyers.upstreamSettings[1] },
      2: { ...config.keyers.upstreamSettings[2] },
      3: { ...config.keyers.upstreamSettings[3] },
      4: { ...config.keyers.upstreamSettings[4] },
    },
    upstreamKeyLuma: Object.fromEntries(
      [1, 2, 3, 4].map((index) => [
        index,
        {
          preMultiplied: false,
          clip: 0,
          gain: 0,
          invert: false,
          ...config.keyers.upstreamLuma?.[index as 1 | 2 | 3 | 4],
        },
      ]),
    ),
    downstreamKeys: {
      1: {
        ...config.keyers.downstream[1],
        isAuto: false,
        inTransition: false,
        isTowardsOnAir: false,
        remainingFrames: 0,
      },
      2: {
        ...config.keyers.downstream[2],
        isAuto: false,
        inTransition: false,
        isTowardsOnAir: false,
        remainingFrames: 0,
      },
    },
  }
}

function requireIdleTransition(state: AtemState): void {
  if (state.transition.inTransition) {
    throw new AtemStateError(
      'transition-in-progress',
      'Cannot change Program, Preview, CUT, or AUTO while AUTO is in progress.',
    )
  }
}

/**
 * Pure state plus a narrow semantic control surface. Network adapters should only
 * use this class; neither HTTP nor UDP is allowed to own a separate ATEM state.
 */
export class AtemStateStore {
  private state: AtemState
  private readonly listeners = new Set<(change: StateChange) => void>()
  private activeTimer: unknown | undefined
  private fadeToBlackTimer: unknown | undefined
  private fadeToBlackTargetBlack: boolean | undefined
  private recordingTimer: unknown | undefined
  private streamingDurationTimer: unknown | undefined
  private streamingStatsTimer: unknown | undefined
  private streamingConnectTimer: unknown | undefined
  private streamingStopTimer: unknown | undefined
  private streamingStatsTickCount = 0
  private macroTimer: unknown | undefined
  private macroPosition = 0
  private macroGeneration = 0

  public constructor(
    private config: AtemSandboxConfig,
    private readonly scheduler: TransitionScheduler = defaultScheduler,
  ) {
    this.config = structuredClone(config)
    this.state = createInitialAtemState(this.config)
    const isoCapable = isIsoCapableModel(this.config.device.modelId)
    this.state.recording.recordAllInputs = isoCapable
    this.state.recording.properties.recordInAllCameras = isoCapable
  }

  public getState(): AtemState {
    return cloneState(this.state)
  }

  public subscribe(listener: (change: StateChange) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public setPreview(source: SourceRef, origin: ActionOrigin = 'system'): AtemState {
    requireIdleTransition(this.state)
    this.requireKnownSource(source)
    return this.commit({ type: 'set-preview', origin }, (next) => {
      next.preview = structuredClone(source)
    })
  }

  public setProgram(source: SourceRef, origin: ActionOrigin = 'system'): AtemState {
    requireIdleTransition(this.state)
    this.requireKnownSource(source)
    return this.commit({ type: 'set-program', origin }, (next) => {
      next.program = structuredClone(source)
    })
  }

  public cut(origin: ActionOrigin = 'system'): AtemState {
    requireIdleTransition(this.state)
    return this.commit({ type: 'cut', origin }, (next) => {
      const formerProgram = next.program
      next.program = next.preview
      next.preview = formerProgram
    })
  }

  public setFadeToBlackRate(rate: number, origin: ActionOrigin = 'system'): AtemState {
    if (!Number.isInteger(rate) || rate < 1 || rate > 250) {
      throw new AtemStateError(
        'invalid-transition-rate',
        'Fade to black rate must be an integer between 1 and 250 frames.',
      )
    }
    return this.commit({ type: 'set-fade-to-black-rate', origin }, (next) => {
      next.fadeToBlack.rate = rate
    })
  }

  public fadeToBlack(origin: ActionOrigin = 'system'): AtemState {
    const targetBlack =
      this.fadeToBlackTargetBlack === undefined
        ? !this.state.fadeToBlack.isFullyBlack
        : !this.fadeToBlackTargetBlack
    this.stopFadeToBlackTimer()
    const state = this.commit({ type: 'fade-to-black', origin }, (next) => {
      next.fadeToBlack = {
        ...next.fadeToBlack,
        inTransition: true,
        remainingFrames: next.fadeToBlack.rate,
      }
    })
    this.fadeToBlackTargetBlack = targetBlack
    this.startFadeToBlackTimer(origin)
    return state
  }

  public macroRun(index: number, origin: ActionOrigin = 'system'): AtemState {
    const macro = this.state.macro.macros[index]
    if (macro === undefined || macro.hasUnsupportedOps) {
      throw new AtemStateError(
        'invalid-macro',
        macro === undefined ? 'Macro does not exist.' : 'Macro contains unsupported operations.',
      )
    }
    if (this.state.macro.macroRecorder.isRecording) {
      throw new AtemStateError('invalid-macro', 'Stop recording before running a macro.')
    }
    this.cancelMacroTimer()
    this.macroGeneration += 1
    this.macroPosition = 0
    const state = this.commit({ type: 'macro-run', origin }, (next) => {
      next.macro.lastError = null
      next.macro.macroPlayer = {
        ...next.macro.macroPlayer,
        isRunning: true,
        isWaiting: false,
        macroIndex: index,
      }
    })
    this.scheduleMacroStep(origin)
    return state
  }

  public macroStop(origin: ActionOrigin = 'system'): AtemState {
    this.cancelMacroTimer()
    this.macroGeneration += 1
    return this.commit({ type: 'macro-stop', origin }, (next) => {
      next.macro.macroPlayer = {
        ...next.macro.macroPlayer,
        isRunning: false,
        isWaiting: false,
      }
    })
  }

  public macroContinue(origin: ActionOrigin = 'system'): AtemState {
    if (!this.state.macro.macroPlayer.isRunning || !this.state.macro.macroPlayer.isWaiting) {
      throw new AtemStateError('invalid-macro', 'No macro is waiting.')
    }
    const state = this.commit({ type: 'macro-continue', origin }, (next) => {
      next.macro.macroPlayer = {
        ...next.macro.macroPlayer,
        isRunning: true,
        isWaiting: false,
      }
    })
    if (this.state.macro.macros[this.state.macro.macroPlayer.macroIndex] !== undefined) {
      this.scheduleMacroStep(origin)
    }
    return state
  }

  public macroInsertUserWait(origin: ActionOrigin = 'system'): AtemState {
    if (this.state.macro.macroRecorder.isRecording) {
      return this.commit({ type: 'macro-insert-user-wait', origin }, (next) => {
        this.recordMacroOperation(next, { type: 'wait' })
      })
    }
    if (!this.state.macro.macroPlayer.isRunning) {
      throw new AtemStateError('invalid-macro', 'No macro is recording or running.')
    }
    this.cancelMacroTimer()
    return this.commit({ type: 'macro-insert-user-wait', origin }, (next) => {
      next.macro.macroPlayer = {
        ...next.macro.macroPlayer,
        isRunning: true,
        isWaiting: true,
      }
    })
  }

  public macroStartRecord(
    index: number,
    name: string,
    description: string,
    origin: ActionOrigin = 'system',
  ): AtemState {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= MACRO_COUNT ||
      new TextEncoder().encode(name).length > 255 ||
      new TextEncoder().encode(description).length > 1024
    ) {
      throw new AtemStateError('invalid-macro', 'Invalid macro index, name, or description.')
    }
    if (this.state.macro.macroRecorder.isRecording || this.state.macro.macroPlayer.isRunning) {
      throw new AtemStateError('invalid-macro', 'Stop the current macro before recording.')
    }
    return this.commit({ type: 'macro-start-record', origin }, (next) => {
      next.macro.lastError = null
      next.macro.macros[index] = { name, description, operations: [], hasUnsupportedOps: false }
      next.macro.macroRecorder = { isRecording: true, macroIndex: index }
    })
  }

  public macroStopRecord(origin: ActionOrigin = 'system'): AtemState {
    if (!this.state.macro.macroRecorder.isRecording) {
      throw new AtemStateError('invalid-macro', 'No macro is recording.')
    }
    return this.commit({ type: 'macro-stop-record', origin }, (next) => {
      next.macro.macroRecorder.isRecording = false
    })
  }

  public macroDelete(index: number, origin: ActionOrigin = 'system'): AtemState {
    if (
      this.state.macro.macros[index] === undefined ||
      this.state.macro.macroRecorder.isRecording ||
      this.state.macro.macroPlayer.isRunning
    ) {
      throw new AtemStateError(
        'invalid-macro',
        'Macro cannot be deleted while recording or playing, or does not exist.',
      )
    }
    return this.commit({ type: 'macro-delete', origin, macroIndex: index }, (next) => {
      delete next.macro.macros[index]
    })
  }

  public macroUpdateProperties(
    index: number,
    properties: { name?: string; description?: string },
    origin: ActionOrigin = 'system',
  ): AtemState {
    const macro = this.state.macro.macros[index]
    const name = properties.name ?? macro?.name
    const description = properties.description ?? macro?.description
    if (
      macro === undefined ||
      name === undefined ||
      description === undefined ||
      new TextEncoder().encode(name).length > 255 ||
      new TextEncoder().encode(description).length > 1024
    ) {
      throw new AtemStateError('invalid-macro', 'Invalid macro properties.')
    }
    return this.commit({ type: 'macro-update-properties', origin, macroIndex: index }, (next) => {
      next.macro.macros[index] = { ...next.macro.macros[index]!, name, description }
    })
  }

  public macroAddPause(frames: number, origin: ActionOrigin = 'system'): AtemState {
    if (
      !this.state.macro.macroRecorder.isRecording ||
      !Number.isInteger(frames) ||
      frames < 0 ||
      frames > 65535
    ) {
      throw new AtemStateError(
        'invalid-macro',
        'A timed pause requires an active recording and a valid frame count.',
      )
    }
    return this.commit({ type: 'macro-add-pause', origin }, (next) => {
      this.recordMacroOperation(next, { type: 'pause', frames })
    })
  }

  public setMacroLoop(loop: boolean, origin: ActionOrigin = 'system'): AtemState {
    return this.commit({ type: 'set-macro-loop', origin }, (next) => {
      next.macro.macroPlayer = {
        ...next.macro.macroPlayer,
        loop,
      }
    })
  }

  public setSuperSourceProperties(
    ssrcId: number,
    props: Partial<SuperSourcePropertiesState>,
    origin: ActionOrigin = 'system',
  ): AtemState {
    return this.commit({ type: 'set-super-source-properties', origin }, (next) => {
      const ssrc = this.requireSuperSource(next, ssrcId)
      ssrc.properties = { ...ssrc.properties!, ...props }
    })
  }

  public setSuperSourceBorder(
    ssrcId: number,
    props: Partial<SuperSourceBorderState>,
    origin: ActionOrigin = 'system',
  ): AtemState {
    return this.commit({ type: 'set-super-source-border', origin }, (next) => {
      const ssrc = this.requireSuperSource(next, ssrcId)
      ssrc.border = { ...ssrc.border!, ...props }
    })
  }

  public setSuperSourceBox(
    ssrcId: number,
    boxId: number,
    props: Partial<SuperSourceBoxState>,
    origin: ActionOrigin = 'system',
  ): AtemState {
    return this.commit({ type: 'set-super-source-box', origin }, (next) => {
      const ssrc = this.requireSuperSource(next, ssrcId)
      const box = ssrc.boxes[boxId]
      if (box === undefined) {
        throw new AtemStateError(
          'invalid-source',
          `SuperSource box ${boxId + 1} is not available in this sandbox.`,
        )
      }
      ssrc.boxes[boxId] = { ...box, ...props }
    })
  }

  public setRecordingStatus(recording: boolean, origin: ActionOrigin = 'system'): AtemState {
    if (!recording) {
      const state = this.commit({ type: 'set-recording-status', origin }, (next) => {
        next.recording.status = {
          ...next.recording.status,
          state: ATEM_RECORDING_STATUS_IDLE,
          error: ATEM_RECORDING_ERROR_NONE,
        }
        next.recording.duration = zeroTimecode()
        this.updateRecordingDiskStatuses(next, false)
      })
      this.stopRecordingTimer()
      return state
    }

    const activeDisk = this.selectRecordingDisk(this.state.recording)
    if (activeDisk === undefined) {
      this.stopRecordingTimer()
      return this.commit({ type: 'set-recording-status', origin }, (next) => {
        const hasAnyMountedDisk = Object.values(next.recording.disks).some(
          (disk) => (disk.status & ATEM_RECORDING_DISK_STATUS_REMOVED) === 0,
        )
        next.recording.status = {
          ...next.recording.status,
          state: ATEM_RECORDING_STATUS_IDLE,
          error: hasAnyMountedDisk
            ? ATEM_RECORDING_ERROR_MEDIA_FULL
            : ATEM_RECORDING_ERROR_NO_MEDIA,
          recordingTimeAvailable: 0,
        }
        this.updateRecordingDiskStatuses(next, false)
      })
    }

    const state = this.commit({ type: 'set-recording-status', origin }, (next) => {
      next.recording.properties.workingSet1DiskId = activeDisk.diskId
      next.recording.status = {
        ...next.recording.status,
        state: ATEM_RECORDING_STATUS_RECORDING,
        error: ATEM_RECORDING_ERROR_NONE,
        recordingTimeAvailable: activeDisk.recordingTimeAvailable,
      }
      next.recording.duration = zeroTimecode()
      this.updateRecordingDiskStatuses(next, true)
    })
    this.startRecordingTimer(origin)
    return state
  }

  public setRecordingIso(recordAllInputs: boolean, origin: ActionOrigin = 'system'): AtemState {
    return this.commit({ type: 'set-recording-iso', origin }, (next) => {
      next.recording.recordAllInputs = recordAllInputs
      next.recording.properties.recordInAllCameras = recordAllInputs
    })
  }

  public switchRecordingDisk(origin: ActionOrigin = 'system'): AtemState {
    const diskIds = Object.values(this.state.recording.disks)
      .map((disk) => disk.diskId)
      .sort((left, right) => left - right)
    const current = this.state.recording.properties.workingSet1DiskId
    const startIndex = Math.max(0, diskIds.indexOf(current))

    let selected: number | undefined
    for (let offset = 1; offset <= diskIds.length; offset += 1) {
      const candidateId = diskIds[(startIndex + offset) % diskIds.length]!
      const candidate = this.state.recording.disks[candidateId]
      if (
        candidate !== undefined &&
        (candidate.status & ATEM_RECORDING_DISK_STATUS_REMOVED) === 0 &&
        candidate.recordingTimeAvailable > 0
      ) {
        selected = candidateId
        break
      }
    }

    if (selected === undefined) {
      return this.commit({ type: 'switch-recording-disk', origin }, (next) => {
        next.recording.status = {
          ...next.recording.status,
          error: ATEM_RECORDING_ERROR_NO_MEDIA,
        }
      })
    }

    return this.commit({ type: 'switch-recording-disk', origin }, (next) => {
      next.recording.properties.workingSet1DiskId = selected
      next.recording.status = {
        ...next.recording.status,
        error: ATEM_RECORDING_ERROR_NONE,
        recordingTimeAvailable: next.recording.disks[selected]?.recordingTimeAvailable ?? 0,
      }
      this.updateRecordingDiskStatuses(
        next,
        (next.recording.status.state & ATEM_RECORDING_STATUS_RECORDING) !== 0,
      )
    })
  }

  public setStreamingStatus(streaming: boolean, origin: ActionOrigin = 'system'): AtemState {
    if (!streaming) {
      this.stopStreamingConnectTimer()
      this.stopStreamingTimer()
      this.stopStreamingStatsTimer()
      const state = this.commit({ type: 'set-streaming-status', origin }, (next) => {
        const current = next.streaming.status.state
        const wasActive =
          (current & ATEM_STREAMING_STATUS_STREAMING) !== 0 ||
          (current & ATEM_STREAMING_STATUS_CONNECTING) !== 0
        next.streaming.status = {
          ...next.streaming.status,
          state: wasActive ? ATEM_STREAMING_STATUS_STOPPING : ATEM_STREAMING_STATUS_IDLE,
          error: ATEM_STREAMING_ERROR_NONE,
        }
        next.streaming.duration = zeroTimecode()
      })
      this.startStreamingStopTimer(origin)
      return state
    }

    if (!this.hasValidStreamingService(this.state.streaming.service)) {
      this.stopStreamingConnectTimer()
      this.stopStreamingTimer()
      this.stopStreamingStatsTimer()
      return this.commit({ type: 'set-streaming-status', origin }, (next) => {
        next.streaming.status = {
          ...next.streaming.status,
          state: ATEM_STREAMING_STATUS_IDLE,
          error: ATEM_STREAMING_ERROR_INVALID_STATE,
        }
      })
    }

    this.stopStreamingStopTimer()
    const state = this.commit({ type: 'set-streaming-status', origin }, (next) => {
      next.streaming.status = {
        ...next.streaming.status,
        state: ATEM_STREAMING_STATUS_CONNECTING,
        error: ATEM_STREAMING_ERROR_NONE,
      }
      next.streaming.duration = zeroTimecode()
      next.streaming.stats = {
        cacheUsed: 0,
        encodingBitrate: next.streaming.service.bitrates[1] ?? 0,
      }
    })
    this.startStreamingConnectTimer(origin)
    return state
  }

  public setStreamingService(
    service: Partial<StreamingState['service']>,
    origin: ActionOrigin = 'system',
  ): AtemState {
    return this.commit({ type: 'set-streaming-service', origin }, (next) => {
      next.streaming.service = {
        ...next.streaming.service,
        ...service,
      }
    })
  }

  public setStreamingAudioBitrates(
    lowBitrate: number,
    highBitrate: number,
    origin: ActionOrigin = 'system',
  ): AtemState {
    return this.commit({ type: 'set-streaming-audio-bitrates', origin }, (next) => {
      next.streaming.audioBitrates = {
        lowBitrate,
        highBitrate,
      }
    })
  }

  public setVideoModeCode(mode: number, origin: ActionOrigin = 'system'): AtemState {
    return this.commit({ type: 'set-video-mode-code', origin }, (next) => {
      next.settings.videoModeCode = mode
    })
  }

  public setMediaPoolSettings(
    maxFrames: [number, number, number, number],
    unassignedFrames: number,
    origin: ActionOrigin = 'system',
  ): AtemState {
    return this.commit({ type: 'set-media-pool-settings', origin }, (next) => {
      next.settings.mediaPool = { maxFrames, unassignedFrames }
    })
  }

  public saveStartupState(origin: ActionOrigin = 'system'): AtemState {
    return this.commit({ type: 'save-startup-state', origin }, (next) => {
      next.settings.startupStateSaved = true
    })
  }

  public clearStartupState(origin: ActionOrigin = 'system'): AtemState {
    return this.commit({ type: 'clear-startup-state', origin }, (next) => {
      next.settings.startupStateSaved = false
    })
  }

  public setTimeMode(mode: number, origin: ActionOrigin = 'system'): AtemState {
    return this.commit({ type: 'set-time-mode', origin }, (next) => {
      next.settings.timeMode = mode
    })
  }

  public setTime(
    time: { hours: number; minutes: number; seconds: number; frames: number; dropFrame: boolean },
    origin: ActionOrigin = 'system',
  ): AtemState {
    return this.commit({ type: 'set-time', origin }, (next) => {
      next.recording.duration = {
        hours: time.hours,
        minutes: time.minutes,
        seconds: time.seconds,
        frames: time.frames,
        isDropFrame: time.dropFrame,
      }
      next.streaming.duration = {
        hours: time.hours,
        minutes: time.minutes,
        seconds: time.seconds,
        frames: time.frames,
        isDropFrame: time.dropFrame,
      }
    })
  }

  public setDisplayClockState(stateValue: number, origin: ActionOrigin = 'system'): AtemState {
    return this.commit({ type: 'set-display-clock-state', origin }, (next) => {
      next.displayClock.properties.clockState = stateValue
    })
  }

  public setDisplayClockProperties(
    properties: Partial<DisplayClockPropertiesState>,
    origin: ActionOrigin = 'system',
  ): AtemState {
    return this.commit({ type: 'set-display-clock-properties', origin }, (next) => {
      next.displayClock.properties = {
        ...next.displayClock.properties,
        ...properties,
      }
    })
  }

  public setMultiviewerProperties(
    layout: number,
    programPreviewSwapped: boolean,
    origin: ActionOrigin = 'system',
  ): AtemState {
    return this.commit({ type: 'set-multiviewer-properties', origin }, (next) => {
      next.multiviewer.properties = { layout, programPreviewSwapped }
    })
  }

  public setMultiviewerWindowSource(
    windowIndex: number,
    source: number,
    supportsVuMeter: boolean,
    supportsSafeArea: boolean,
    origin: ActionOrigin = 'system',
  ): AtemState {
    return this.commit({ type: 'set-multiviewer-window-source', origin }, (next) => {
      const previous = next.multiviewer.windows[windowIndex] ?? {
        source,
        supportsVuMeter,
        supportsSafeArea,
        audioMeter: false,
      }
      next.multiviewer.windows[windowIndex] = {
        ...previous,
        source,
        supportsVuMeter,
        supportsSafeArea,
      }
    })
  }

  public setClassicAudioMaster(
    master: Partial<ClassicAudioMasterState>,
    origin: ActionOrigin = 'system',
  ): AtemState {
    return this.commit({ type: 'set-classic-audio-master', origin }, (next) => {
      next.classicAudio.master = { ...next.classicAudio.master, ...master }
    })
  }

  public setFairlightMaster(
    master: Partial<FairlightMasterState>,
    origin: ActionOrigin = 'system',
  ): AtemState {
    return this.commit({ type: 'set-fairlight-master', origin }, (next) => {
      next.fairlightAudio.master = { ...next.fairlightAudio.master, ...master }
    })
  }

  public setFairlightSource(
    id: number,
    sourceId: string,
    properties: Partial<Pick<FairlightInputState, 'mixOption' | 'faderGain'>>,
    origin: ActionOrigin = 'system',
  ): AtemState {
    return this.commit({ type: 'set-fairlight-source', origin }, (next) => {
      const input = next.fairlightAudio.inputs[id]
      if (input === undefined || input.sourceId !== sourceId) {
        throw new AtemStateError('invalid-source', 'Fairlight input source is not available.')
      }
      if (
        (properties.mixOption !== undefined && ![1, 2, 4].includes(properties.mixOption)) ||
        (properties.faderGain !== undefined &&
          (!Number.isInteger(properties.faderGain) ||
            properties.faderGain < -10000 ||
            properties.faderGain > 1000))
      ) {
        throw new AtemStateError('invalid-source', 'Invalid Fairlight source settings.')
      }
      next.fairlightAudio.inputs[id] = { ...input, ...properties }
    })
  }

  public setCameraControl(
    control: Partial<CameraControlState>,
    origin: ActionOrigin = 'system',
  ): AtemState {
    return this.commit({ type: 'set-camera-control', origin }, (next) => {
      next.cameraControl = { ...next.cameraControl, ...control }
    })
  }

  public auto(origin: ActionOrigin = 'system', options: AutoOptions = {}): Promise<AtemState> {
    requireIdleTransition(this.state)

    const durationMs = options.durationMs ?? this.transitionDurationMs()
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new AtemStateError(
        'invalid-transition-rate',
        'Transition duration must be a non-negative number.',
      )
    }

    const startedAt = this.scheduler.now()
    const fromProgram = structuredClone(this.state.program)
    const toProgram = structuredClone(this.state.preview)

    this.commit({ type: 'auto-start', origin, macroOperation: { type: 'auto' } }, (next) => {
      next.transition.inTransition = true
      next.transition.position = 0
      next.transition.fromProgram = fromProgram
      next.transition.toProgram = toProgram
    })

    return new Promise((resolve) => {
      const tick = (): void => {
        const elapsedMs = this.scheduler.now() - startedAt
        const position = durationMs === 0 ? 1 : Math.min(1, Math.max(0, elapsedMs / durationMs))

        if (position >= 1) {
          this.activeTimer = undefined
          const completed = this.commit({ type: 'auto-complete', origin }, (next) => {
            next.program = toProgram
            next.preview = fromProgram
            next.transition.inTransition = false
            next.transition.position = 0
            next.transition.fromProgram = null
            next.transition.toProgram = null
          })
          resolve(completed)
          return
        }

        this.commit({ type: 'auto-progress', origin }, (next) => {
          next.transition.position = position
        })
        this.activeTimer = this.scheduler.setTimeout(tick, Math.min(16, durationMs - elapsedMs))
      }

      this.activeTimer = this.scheduler.setTimeout(
        tick,
        durationMs === 0 ? 0 : Math.min(16, durationMs),
      )
    })
  }

  public setTransitionType(type: TransitionType, origin: ActionOrigin = 'system'): AtemState {
    return this.commit(
      {
        type: 'set-transition-type',
        origin,
        macroOperation: { type: 'set-transition-type', transitionType: type },
      },
      (next) => {
        next.transition.type = type
      },
    )
  }

  public setTransitionRate(rateFrames: number, origin: ActionOrigin = 'system'): AtemState {
    if (!Number.isInteger(rateFrames) || rateFrames < 1 || rateFrames > 250) {
      throw new AtemStateError(
        'invalid-transition-rate',
        'Transition rate must be an integer between 1 and 250 frames.',
      )
    }
    return this.commit(
      {
        type: 'set-transition-rate',
        origin,
        macroOperation: { type: 'set-transition-rate', rateFrames },
      },
      (next) => {
        next.transition.rateFrames = rateFrames
      },
    )
  }

  public selectMediaPlayerStill(
    player: MediaPlayerId,
    slot: number,
    origin: ActionOrigin = 'system',
  ): AtemState {
    if (!this.supportedMediaPlayerIds().includes(player)) {
      throw new AtemStateError(
        'invalid-source',
        `Media Player ${player} is not available in this sandbox.`,
      )
    }
    if (!this.state.mediaPool.stills.some((still) => still.slot === slot)) {
      throw new AtemStateError('invalid-media-slot', `Media pool slot ${slot} does not exist.`)
    }
    return this.commit(
      {
        type: 'select-media-player-still',
        origin,
        macroOperation: { type: 'select-media-player-still', player, slot },
      },
      (next) => {
        next.mediaPlayers[player] = { ...next.mediaPlayers[player], slot }
      },
    )
  }

  public setAuxSource(
    bus: 1 | 2 | 3 | 4,
    source: SourceRef,
    origin: ActionOrigin = 'system',
  ): AtemState {
    const supportedCount = getAtemDeviceProfile(this.config.device.modelId).topology.auxiliaries
    if (bus > supportedCount) {
      throw new AtemStateError('invalid-source', `Aux ${bus} is not available in this sandbox.`)
    }
    this.requireKnownSource(source)
    return this.commit(
      { type: 'set-aux-source', origin, macroOperation: { type: 'set-aux-source', bus, source } },
      (next) => {
        next.auxiliaries[bus] = structuredClone(source)
      },
    )
  }

  public upsertMediaPoolStill(still: MediaPoolStill, origin: ActionOrigin = 'system'): AtemState {
    if (still.slot < 1 || still.slot > 20) {
      throw new AtemStateError('invalid-media-slot', `Media pool slot ${still.slot} is invalid.`)
    }

    const slotExists = this.state.mediaPool.stills.some(
      (candidate) => candidate.slot === still.slot,
    )
    if (!slotExists && this.state.mediaPool.stills.length >= 20) {
      throw new AtemStateError('invalid-media-slot', 'Media Pool is full (20/20 slots in use).')
    }

    return this.commit({ type: 'upsert-media-pool-still', origin }, (next) => {
      const index = next.mediaPool.stills.findIndex((candidate) => candidate.slot === still.slot)
      if (index >= 0) {
        next.mediaPool.stills[index] = structuredClone(still)
      } else {
        next.mediaPool.stills.push(structuredClone(still))
      }
      next.mediaPool.stills.sort((left, right) => left.slot - right.slot)
    })
  }

  public deleteMediaPoolStill(slot: number, origin: ActionOrigin = 'system'): AtemState {
    if (!this.state.mediaPool.stills.some((still) => still.slot === slot)) {
      throw new AtemStateError('invalid-media-slot', `Media pool slot ${slot} does not exist.`)
    }

    if (slot === 1 || slot === 2) {
      throw new AtemStateError(
        'invalid-media-slot',
        'Cannot delete default Media Pool items in slots 1 and 2.',
      )
    }

    const assignedPlayers = ([1, 2] as const).filter(
      (player) => this.state.mediaPlayers[player].slot === slot,
    )
    if (assignedPlayers.length > 0) {
      throw new AtemStateError(
        'invalid-media-slot',
        `Cannot delete slot ${slot} while assigned to ${assignedPlayers.map((player) => `Media Player ${player}`).join(' and ')}.`,
      )
    }

    return this.commit({ type: 'delete-media-pool-still', origin }, (next) => {
      next.mediaPool.stills = next.mediaPool.stills.filter((still) => still.slot !== slot)
    })
  }

  public updateMediaPlayerName(
    player: MediaPlayerId,
    name: string,
    origin: ActionOrigin = 'system',
  ): AtemState {
    if (!this.supportedMediaPlayerIds().includes(player)) {
      throw new AtemStateError(
        'invalid-source',
        `Media Player ${player} is not available in this sandbox.`,
      )
    }
    return this.commit({ type: 'update-media-player', origin }, (next) => {
      next.mediaPlayers[player].name = name
    })
  }

  public updateDeviceSettings(
    device: AtemSandboxConfig['device'],
    origin: ActionOrigin = 'system',
  ): AtemState {
    if (device.videoMode !== this.config.device.videoMode && this.state.transition.inTransition) {
      throw new AtemStateError(
        'transition-in-progress',
        'Cannot change video mode while an AUTO transition is in progress.',
      )
    }

    this.config = { ...this.config, device: structuredClone(device) }
    return this.commit({ type: 'update-device-settings', origin }, (next) => {
      next.settings.videoModeCode = VIDEO_MODE_CODES[device.videoMode]
    })
  }

  public updateInput(
    inputId: InputId,
    update: Pick<AtemInput, 'longName' | 'shortName' | 'background' | 'foreground'>,
    origin: ActionOrigin = 'system',
  ): AtemState {
    const input = this.state.inputs.find((candidate) => candidate.id === inputId)
    if (input === undefined) {
      throw new AtemStateError('invalid-source', `Input ${inputId} is not available in v1.`)
    }
    return this.commit({ type: 'update-input', origin }, (next) => {
      const target = next.inputs.find((candidate) => candidate.id === inputId)
      if (target === undefined) {
        throw new AtemStateError('invalid-source', `Input ${inputId} is not available in v1.`)
      }
      Object.assign(target, update)
    })
  }

  public setUpstreamKey(
    index: 1 | 2 | 3 | 4,
    enabled: boolean,
    origin: ActionOrigin = 'system',
  ): AtemState {
    const supportedCount = getAtemDeviceProfile(this.config.device.modelId).topology
      .upstreamKeyersPerMixEffect
    if (index > supportedCount) {
      throw new AtemStateError(
        'invalid-source',
        `Upstream Key ${index} is not available in this sandbox.`,
      )
    }
    return this.commit(
      {
        type: 'set-upstream-key',
        origin,
        macroOperation: { type: 'set-upstream-key', index, enabled },
      },
      (next) => {
        next.upstreamKeys[index] = enabled
      },
    )
  }

  public setUpstreamKeyType(
    index: 1 | 2 | 3 | 4,
    mixEffectKeyType: 0 | 1 | 2 | 3,
    origin: ActionOrigin = 'system',
  ): AtemState {
    const supportedCount = getAtemDeviceProfile(this.config.device.modelId).topology
      .upstreamKeyersPerMixEffect
    if (index > supportedCount) {
      throw new AtemStateError(
        'invalid-source',
        `Upstream Key ${index} is not available in this sandbox.`,
      )
    }
    return this.commit(
      {
        type: 'set-upstream-key-type',
        origin,
        macroOperation: { type: 'set-upstream-key-type', index, mixEffectKeyType },
      },
      (next) => {
        next.upstreamKeyProperties[index] = {
          ...next.upstreamKeyProperties[index]!,
          mixEffectKeyType,
        }
      },
    )
  }

  public setUpstreamKeyLuma(
    index: 1 | 2 | 3 | 4,
    properties: Partial<UpstreamKeyLumaState>,
    origin: ActionOrigin = 'system',
  ): AtemState {
    const supportedCount = getAtemDeviceProfile(this.config.device.modelId).topology
      .upstreamKeyersPerMixEffect
    if (index > supportedCount) {
      throw new AtemStateError(
        'invalid-source',
        `Upstream Key ${index} is not available in this sandbox.`,
      )
    }
    return this.commit(
      {
        type: 'set-upstream-key-luma',
        origin,
        macroOperation: { type: 'set-upstream-key-luma', index, properties },
      },
      (next) => {
        next.upstreamKeyLuma[index] = { ...next.upstreamKeyLuma[index]!, ...properties }
      },
    )
  }

  public setUpstreamKeyFillSource(
    index: 1 | 2 | 3 | 4,
    fillSource: number,
    origin: ActionOrigin = 'system',
  ): AtemState {
    const supportedCount = getAtemDeviceProfile(this.config.device.modelId).topology
      .upstreamKeyersPerMixEffect
    if (index > supportedCount) {
      throw new AtemStateError(
        'invalid-source',
        `Upstream Key ${index} is not available in this sandbox.`,
      )
    }
    return this.commit(
      {
        type: 'set-upstream-key-fill-source',
        origin,
        macroOperation: { type: 'set-upstream-key-fill-source', index, fillSource },
      },
      (next) => {
        next.upstreamKeyProperties[index] = { ...next.upstreamKeyProperties[index]!, fillSource }
      },
    )
  }

  public setUpstreamKeyCutSource(
    index: 1 | 2 | 3 | 4,
    cutSource: number,
    origin: ActionOrigin = 'system',
  ): AtemState {
    const supportedCount = getAtemDeviceProfile(this.config.device.modelId).topology
      .upstreamKeyersPerMixEffect
    if (index > supportedCount) {
      throw new AtemStateError(
        'invalid-source',
        `Upstream Key ${index} is not available in this sandbox.`,
      )
    }
    return this.commit(
      {
        type: 'set-upstream-key-cut-source',
        origin,
        macroOperation: { type: 'set-upstream-key-cut-source', index, cutSource },
      },
      (next) => {
        next.upstreamKeyProperties[index] = { ...next.upstreamKeyProperties[index]!, cutSource }
      },
    )
  }

  public setDownstreamKey(
    index: 1 | 2,
    enabled: boolean,
    origin: ActionOrigin = 'system',
  ): AtemState {
    const supportedCount = getAtemDeviceProfile(this.config.device.modelId).topology
      .downstreamKeyers
    if (index > supportedCount) {
      throw new AtemStateError(
        'invalid-source',
        `Downstream Key ${index} is not available in this sandbox.`,
      )
    }
    return this.commit(
      {
        type: 'set-downstream-key',
        origin,
        macroOperation: { type: 'set-downstream-key', index, enabled },
      },
      (next) => {
        const current = next.downstreamKeys[index] ?? {
          onAir: false,
          tie: false,
          rate: 25,
          isAuto: false,
          inTransition: false,
          isTowardsOnAir: false,
          remainingFrames: 0,
        }
        next.downstreamKeys[index] = {
          ...current,
          onAir: enabled,
          isAuto: false,
          inTransition: false,
          isTowardsOnAir: enabled,
          remainingFrames: 0,
        }
      },
    )
  }

  public setDownstreamKeyTie(
    index: 1 | 2,
    enabled: boolean,
    origin: ActionOrigin = 'system',
  ): AtemState {
    const supportedCount = getAtemDeviceProfile(this.config.device.modelId).topology
      .downstreamKeyers
    if (index > supportedCount) {
      throw new AtemStateError(
        'invalid-source',
        `Downstream Key ${index} is not available in this sandbox.`,
      )
    }
    return this.commit(
      {
        type: 'set-downstream-key-tie',
        origin,
        macroOperation: { type: 'set-downstream-key-tie', index, enabled },
      },
      (next) => {
        const current = next.downstreamKeys[index]!
        next.downstreamKeys[index] = { ...current, tie: enabled }
      },
    )
  }

  public setDownstreamKeyRate(
    index: 1 | 2,
    rate: number,
    origin: ActionOrigin = 'system',
  ): AtemState {
    const supportedCount = getAtemDeviceProfile(this.config.device.modelId).topology
      .downstreamKeyers
    if (index > supportedCount) {
      throw new AtemStateError(
        'invalid-source',
        `Downstream Key ${index} is not available in this sandbox.`,
      )
    }
    if (!Number.isInteger(rate) || rate < 1 || rate > 250) {
      throw new AtemStateError(
        'invalid-transition-rate',
        'Downstream key rate must be an integer between 1 and 250 frames.',
      )
    }
    return this.commit(
      {
        type: 'set-downstream-key-rate',
        origin,
        macroOperation: { type: 'set-downstream-key-rate', index, rate },
      },
      (next) => {
        const current = next.downstreamKeys[index]!
        next.downstreamKeys[index] = { ...current, rate }
      },
    )
  }

  public autoDownstreamKey(
    index: 1 | 2,
    origin: ActionOrigin = 'system',
    isTowardsOnAir?: boolean,
  ): AtemState {
    const supportedCount = getAtemDeviceProfile(this.config.device.modelId).topology
      .downstreamKeyers
    if (index > supportedCount) {
      throw new AtemStateError(
        'invalid-source',
        `Downstream Key ${index} is not available in this sandbox.`,
      )
    }
    return this.commit({ type: 'auto-downstream-key', origin }, (next) => {
      const current = next.downstreamKeys[index]!
      const targetOnAir = isTowardsOnAir ?? !current.onAir
      next.downstreamKeys[index] = {
        ...current,
        onAir: targetOnAir,
        isAuto: true,
        inTransition: false,
        isTowardsOnAir: targetOnAir,
        remainingFrames: 0,
      }
    })
  }

  /**
   * Replaces the sandbox's persisted profile and resets the live surface to
   * that profile's initial state. Imports are deliberately rejected during an
   * AUTO transition so an in-flight transition cannot resolve into a stale
   * configuration after the replacement.
   */
  public replaceConfiguration(
    config: AtemSandboxConfig,
    origin: ActionOrigin = 'system',
  ): AtemState {
    requireIdleTransition(this.state)
    this.cancelMacroTimer()
    this.macroGeneration += 1
    this.config = structuredClone(config)
    this.stopFadeToBlackTimer()
    const next = createInitialAtemState(this.config)
    next.revision = this.state.revision + 1
    this.state = next
    const change: StateChange = {
      action: { type: 'load-config', origin },
      state: cloneState(next),
    }
    this.listeners.forEach((listener) => listener(change))
    return cloneState(next)
  }

  public dispose(): void {
    this.cancelMacroTimer()
    this.macroGeneration += 1
    if (this.activeTimer !== undefined) {
      this.scheduler.clearTimeout(this.activeTimer)
      this.activeTimer = undefined
    }
    this.stopFadeToBlackTimer()
    this.stopRecordingTimer()
    this.stopStreamingTimer()
    this.stopStreamingConnectTimer()
    this.stopStreamingStopTimer()
    this.stopStreamingStatsTimer()
    this.listeners.clear()
  }

  private transitionDurationMs(): number {
    return this.state.transition.rateFrames * frameDurationMs(this.config.device.videoMode)
  }

  private cancelMacroTimer(): void {
    if (this.macroTimer !== undefined) {
      this.scheduler.clearTimeout(this.macroTimer)
      this.macroTimer = undefined
    }
  }

  private scheduleMacroStep(origin: ActionOrigin, delayFrames = 1): void {
    this.cancelMacroTimer()
    this.macroTimer = this.scheduler.setTimeout(
      () => {
        this.macroTimer = undefined
        const player = this.state.macro.macroPlayer
        const macro = this.state.macro.macros[player.macroIndex]
        if (!player.isRunning || player.isWaiting || macro === undefined) return
        const operation = macro.operations[this.macroPosition++]
        if (operation === undefined) {
          if (player.loop && macro.operations.length > 0) {
            this.macroPosition = 0
            this.scheduleMacroStep(origin)
          } else {
            this.macroStop(origin)
          }
          return
        }
        if (operation.type === 'wait') {
          this.macroInsertUserWait(origin)
          return
        }
        if (operation.type === 'pause') {
          this.scheduleMacroStep(origin, Math.max(1, operation.frames))
          return
        }
        try {
          if (operation.type === 'auto') {
            const generation = this.macroGeneration
            void this.auto('system').then(() => {
              if (
                this.macroGeneration === generation &&
                this.state.macro.macroPlayer.isRunning &&
                !this.state.macro.macroPlayer.isWaiting
              )
                this.scheduleMacroStep(origin)
            })
            return
          }
          if (operation.type === 'set-program') this.setProgram(operation.source, 'system')
          if (operation.type === 'set-preview') this.setPreview(operation.source, 'system')
          if (operation.type === 'cut') this.cut('system')
          if (operation.type === 'set-transition-type')
            this.setTransitionType(operation.transitionType, 'system')
          if (operation.type === 'set-transition-rate')
            this.setTransitionRate(operation.rateFrames, 'system')
          if (operation.type === 'set-aux-source')
            this.setAuxSource(operation.bus, operation.source, 'system')
          if (operation.type === 'select-media-player-still')
            this.selectMediaPlayerStill(operation.player, operation.slot, 'system')
          if (operation.type === 'set-upstream-key')
            this.setUpstreamKey(operation.index, operation.enabled, 'system')
          if (operation.type === 'set-upstream-key-type')
            this.setUpstreamKeyType(operation.index, operation.mixEffectKeyType, 'system')
          if (operation.type === 'set-upstream-key-luma') {
            const { preMultiplied, clip, gain, invert } = operation.properties
            this.setUpstreamKeyLuma(
              operation.index,
              {
                ...(preMultiplied !== undefined ? { preMultiplied } : {}),
                ...(clip !== undefined ? { clip } : {}),
                ...(gain !== undefined ? { gain } : {}),
                ...(invert !== undefined ? { invert } : {}),
              },
              'system',
            )
          }
          if (operation.type === 'set-upstream-key-fill-source')
            this.setUpstreamKeyFillSource(operation.index, operation.fillSource, 'system')
          if (operation.type === 'set-upstream-key-cut-source')
            this.setUpstreamKeyCutSource(operation.index, operation.cutSource, 'system')
          if (operation.type === 'set-downstream-key')
            this.setDownstreamKey(operation.index, operation.enabled, 'system')
          if (operation.type === 'set-downstream-key-tie')
            this.setDownstreamKeyTie(operation.index, operation.enabled, 'system')
          if (operation.type === 'set-downstream-key-rate')
            this.setDownstreamKeyRate(operation.index, operation.rate, 'system')
        } catch (error) {
          this.commit({ type: 'macro-stop', origin }, (next) => {
            next.macro.macroPlayer.isRunning = false
            next.macro.macroPlayer.isWaiting = false
            next.macro.lastError = error instanceof Error ? error.message : 'Macro playback failed.'
          })
          return
        }
        this.scheduleMacroStep(origin)
      },
      delayFrames * frameDurationMs(this.config.device.videoMode),
    )
  }

  private startRecordingTimer(origin: ActionOrigin): void {
    this.stopRecordingTimer()
    const tick = (): void => {
      if ((this.state.recording.status.state & ATEM_RECORDING_STATUS_RECORDING) === 0) {
        this.recordingTimer = undefined
        return
      }
      this.commit({ type: 'set-recording-status', origin, isTimerUpdate: true }, (next) => {
        next.recording.duration = incrementTimecode(next.recording.duration ?? zeroTimecode())
        const activeDiskId = next.recording.properties.workingSet1DiskId
        const activeDisk = next.recording.disks[activeDiskId]
        if (activeDisk !== undefined) {
          activeDisk.recordingTimeAvailable = Math.max(0, activeDisk.recordingTimeAvailable - 1)
          next.recording.status.recordingTimeAvailable = activeDisk.recordingTimeAvailable
          if (activeDisk.recordingTimeAvailable === 0) {
            next.recording.status.state = ATEM_RECORDING_STATUS_IDLE
            next.recording.status.error = ATEM_RECORDING_ERROR_MEDIA_FULL
            next.recording.duration = zeroTimecode()
            this.updateRecordingDiskStatuses(next, false)
          }
        }
      })
      if ((this.state.recording.status.state & ATEM_RECORDING_STATUS_RECORDING) === 0) {
        this.recordingTimer = undefined
        return
      }
      this.recordingTimer = this.scheduler.setTimeout(tick, 1000)
    }
    this.recordingTimer = this.scheduler.setTimeout(tick, 1000)
  }

  private startFadeToBlackTimer(origin: ActionOrigin): void {
    this.stopFadeToBlackTimer()
    const frameMs = frameDurationMs(this.config.device.videoMode)
    const tick = (): void => {
      if (!this.state.fadeToBlack.inTransition) {
        this.fadeToBlackTimer = undefined
        return
      }

      const targetBlack = this.fadeToBlackTargetBlack ?? !this.state.fadeToBlack.isFullyBlack
      this.commit({ type: 'fade-to-black', origin, isTimerUpdate: true }, (next) => {
        const remaining = Math.max(0, next.fadeToBlack.remainingFrames - 1)
        const finished = remaining === 0
        next.fadeToBlack = {
          ...next.fadeToBlack,
          isFullyBlack: finished ? targetBlack : next.fadeToBlack.isFullyBlack,
          inTransition: !finished,
          remainingFrames: remaining,
        }
      })

      if (!this.state.fadeToBlack.inTransition) {
        this.fadeToBlackTargetBlack = undefined
        this.fadeToBlackTimer = undefined
        return
      }

      this.fadeToBlackTimer = this.scheduler.setTimeout(tick, frameMs)
    }

    this.fadeToBlackTimer = this.scheduler.setTimeout(tick, frameMs)
  }

  private stopFadeToBlackTimer(): void {
    if (this.fadeToBlackTimer !== undefined) {
      this.scheduler.clearTimeout(this.fadeToBlackTimer)
      this.fadeToBlackTimer = undefined
    }
    this.fadeToBlackTargetBlack = undefined
  }

  private stopRecordingTimer(): void {
    if (this.recordingTimer !== undefined) {
      this.scheduler.clearTimeout(this.recordingTimer)
      this.recordingTimer = undefined
    }
  }

  private startStreamingTimer(origin: ActionOrigin): void {
    this.stopStreamingTimer()
    const tick = (): void => {
      if ((this.state.streaming.status.state & ATEM_STREAMING_STATUS_STREAMING) === 0) {
        this.streamingDurationTimer = undefined
        return
      }
      this.commit({ type: 'set-streaming-status', origin, isTimerUpdate: true }, (next) => {
        next.streaming.duration = incrementTimecode(next.streaming.duration ?? zeroTimecode())
      })
      this.streamingDurationTimer = this.scheduler.setTimeout(tick, 1000)
    }
    this.streamingDurationTimer = this.scheduler.setTimeout(tick, 1000)
  }

  private startStreamingStatsTimer(origin: ActionOrigin): void {
    this.stopStreamingStatsTimer()
    this.streamingStatsTickCount = 0
    const tick = (): void => {
      if ((this.state.streaming.status.state & ATEM_STREAMING_STATUS_STREAMING) === 0) {
        this.streamingStatsTimer = undefined
        return
      }
      this.commit({ type: 'set-streaming-status', origin, isTimerUpdate: true }, (next) => {
        this.streamingStatsTickCount += 1
        const targetBitrate =
          next.streaming.service.bitrates[1] > 0
            ? next.streaming.service.bitrates[1]
            : next.streaming.service.bitrates[0]
        const swing = (this.streamingStatsTickCount % 4) * 125_000
        next.streaming.stats = {
          cacheUsed: (this.streamingStatsTickCount * 3) % 100,
          encodingBitrate: Math.max(0, targetBitrate - swing),
        }
      })
      this.streamingStatsTimer = this.scheduler.setTimeout(tick, 1000)
    }
    this.streamingStatsTimer = this.scheduler.setTimeout(tick, 1000)
  }

  private stopStreamingStatsTimer(): void {
    if (this.streamingStatsTimer !== undefined) {
      this.scheduler.clearTimeout(this.streamingStatsTimer)
      this.streamingStatsTimer = undefined
    }
  }

  private startStreamingConnectTimer(origin: ActionOrigin): void {
    this.stopStreamingConnectTimer()
    this.streamingConnectTimer = this.scheduler.setTimeout(() => {
      const status = this.state.streaming.status.state
      if ((status & ATEM_STREAMING_STATUS_CONNECTING) === 0) {
        this.streamingConnectTimer = undefined
        return
      }
      this.commit({ type: 'set-streaming-status', origin, isTimerUpdate: true }, (next) => {
        next.streaming.status = {
          ...next.streaming.status,
          state: ATEM_STREAMING_STATUS_STREAMING,
          error: ATEM_STREAMING_ERROR_NONE,
        }
      })
      this.startStreamingTimer(origin)
      this.startStreamingStatsTimer(origin)
      this.streamingConnectTimer = undefined
    }, 500)
  }

  private stopStreamingConnectTimer(): void {
    if (this.streamingConnectTimer !== undefined) {
      this.scheduler.clearTimeout(this.streamingConnectTimer)
      this.streamingConnectTimer = undefined
    }
  }

  private startStreamingStopTimer(origin: ActionOrigin): void {
    this.stopStreamingStopTimer()
    this.streamingStopTimer = this.scheduler.setTimeout(() => {
      this.commit({ type: 'set-streaming-status', origin, isTimerUpdate: true }, (next) => {
        next.streaming.status = {
          ...next.streaming.status,
          state: ATEM_STREAMING_STATUS_IDLE,
          error: ATEM_STREAMING_ERROR_NONE,
        }
      })
      this.streamingStopTimer = undefined
    }, 300)
  }

  private stopStreamingStopTimer(): void {
    if (this.streamingStopTimer !== undefined) {
      this.scheduler.clearTimeout(this.streamingStopTimer)
      this.streamingStopTimer = undefined
    }
  }

  private stopStreamingTimer(): void {
    if (this.streamingDurationTimer !== undefined) {
      this.scheduler.clearTimeout(this.streamingDurationTimer)
      this.streamingDurationTimer = undefined
    }
  }

  private hasValidStreamingService(service: StreamingState['service']): boolean {
    return service.url.trim().length > 0 && service.key.trim().length > 0
  }

  private selectRecordingDisk(
    recording: RecordingState,
  ): RecordingState['disks'][number] | undefined {
    const preferred = recording.disks[recording.properties.workingSet1DiskId]
    if (
      preferred !== undefined &&
      (preferred.status & ATEM_RECORDING_DISK_STATUS_REMOVED) === 0 &&
      preferred.recordingTimeAvailable > 0
    ) {
      return preferred
    }

    return Object.values(recording.disks)
      .filter(
        (disk) =>
          (disk.status & ATEM_RECORDING_DISK_STATUS_REMOVED) === 0 &&
          disk.recordingTimeAvailable > 0,
      )
      .sort((left, right) => left.diskId - right.diskId)[0]
  }

  private updateRecordingDiskStatuses(state: AtemState, recording: boolean): void {
    const activeDiskId = state.recording.properties.workingSet1DiskId
    for (const disk of Object.values(state.recording.disks)) {
      const base =
        (disk.status & ATEM_RECORDING_DISK_STATUS_UNFORMATTED) !== 0
          ? ATEM_RECORDING_DISK_STATUS_UNFORMATTED
          : ATEM_RECORDING_DISK_STATUS_IDLE
      const isRemoved = (disk.status & ATEM_RECORDING_DISK_STATUS_REMOVED) !== 0
      if (isRemoved) {
        disk.status = ATEM_RECORDING_DISK_STATUS_REMOVED
        continue
      }
      const isActive = disk.diskId === activeDiskId
      const activeFlag = isActive ? ATEM_RECORDING_DISK_STATUS_ACTIVE : 0
      const recordingFlag = recording && isActive ? ATEM_RECORDING_DISK_STATUS_RECORDING : 0
      disk.status = base | activeFlag | recordingFlag
    }
  }

  private requireKnownSource(source: SourceRef): void {
    if (source.kind === 'input') {
      if (!this.state.inputs.some((input) => input.id === source.inputId)) {
        throw new AtemStateError(
          'invalid-source',
          `Input ${source.inputId} is not available in this sandbox.`,
        )
      }
      return
    }

    if (source.kind === 'super-source') {
      this.requireSuperSource(this.state, 0)
      return
    }

    if (!this.supportedMediaPlayerIds().includes(source.player)) {
      throw new AtemStateError(
        'invalid-source',
        `Media Player ${source.player} is not available in this sandbox.`,
      )
    }
  }

  private supportedMediaPlayerIds(): MediaPlayerId[] {
    const count = getAtemDeviceProfile(this.config.device.modelId).topology.mediaPlayers
    return MEDIA_PLAYER_IDS.slice(0, count)
  }

  private requireSuperSource(state: AtemState, ssrcId: number): SuperSourceState {
    const supportedCount = getAtemDeviceProfile(this.config.device.modelId).effects.superSource
    if (supportedCount === 0 || ssrcId < 0 || ssrcId >= supportedCount) {
      throw new AtemStateError(
        'invalid-source',
        `SuperSource ${ssrcId + 1} is not available in this sandbox.`,
      )
    }
    const ssrc = state.superSources[ssrcId]
    if (ssrc === undefined) {
      throw new AtemStateError(
        'invalid-source',
        `SuperSource ${ssrcId + 1} is not available in this sandbox.`,
      )
    }
    return ssrc
  }

  private commit(action: AtemActionMeta, mutate: (next: AtemState) => void): AtemState {
    const next = cloneState(this.state)
    mutate(next)
    if (
      next.macro.macroRecorder.isRecording &&
      action.origin !== 'system' &&
      !action.isTimerUpdate &&
      !action.type.startsWith('macro-') &&
      action.type !== 'set-macro-loop' &&
      action.type !== 'auto-progress' &&
      action.type !== 'auto-complete'
    ) {
      if (action.macroOperation !== undefined)
        this.recordMacroOperation(next, action.macroOperation)
      else if (action.type === 'set-program')
        this.recordMacroOperation(next, { type: 'set-program', source: next.program })
      else if (action.type === 'set-preview')
        this.recordMacroOperation(next, { type: 'set-preview', source: next.preview })
      else if (action.type === 'cut') this.recordMacroOperation(next, { type: 'cut' })
      else next.macro.macros[next.macro.macroRecorder.macroIndex]!.hasUnsupportedOps = true
    }
    next.revision += 1
    this.state = next
    const change: StateChange = { action, state: cloneState(next) }
    this.listeners.forEach((listener) => listener(change))
    return cloneState(next)
  }

  private recordMacroOperation(state: AtemState, operation: MacroOperation): void {
    const macro = state.macro.macros[state.macro.macroRecorder.macroIndex]!
    if (macro.operations.length >= 10000) macro.hasUnsupportedOps = true
    else macro.operations.push(structuredClone(operation))
  }
}

export function resolveSourceSurface(state: AtemState, source: SourceRef): SourceSurface {
  if (source.kind === 'super-source') {
    return {
      source,
      title: 'SuperSource',
      subtitle: 'SSRC',
      kind: 'super-source',
      background: '#000000',
      foreground: '#FFFFFF',
      text: 'SuperSource',
      mediaFile: null,
    }
  }
  if (source.kind === 'input') {
    const input = state.inputs.find((candidate) => candidate.id === source.inputId)
    if (input === undefined) {
      return {
        source,
        title: `INPUT ${source.inputId}`,
        subtitle: 'Unavailable',
        kind: 'input',
        background: '#111827',
        foreground: '#FFFFFF',
        text: `INPUT ${source.inputId}`,
        mediaFile: null,
      }
    }
    return {
      source,
      title: input.longName,
      subtitle: input.shortName,
      kind: 'input',
      background: input.background,
      foreground: input.foreground,
      text: input.longName,
      mediaFile: null,
    }
  }

  const player = state.mediaPlayers[source.player]
  const still = state.mediaPool.stills.find((candidate) => candidate.slot === player.slot)
  const playerTitle = player.name
  if (still === undefined) {
    return {
      source,
      title: playerTitle,
      subtitle: `Missing Slot ${player.slot}`,
      kind: 'missing-still',
      background: '#7F1D1D',
      foreground: '#FFFFFF',
      text: `MISSING SLOT ${player.slot}`,
      mediaFile: null,
    }
  }

  if (still.type === 'image') {
    return {
      source,
      title: playerTitle,
      subtitle: `Slot ${still.slot}: ${still.name}`,
      kind: 'image-still',
      background: '#111827',
      foreground: '#FFFFFF',
      text: still.name,
      mediaFile: still.file,
    }
  }

  return {
    source,
    title: playerTitle,
    subtitle: `Slot ${still.slot}: ${still.name}`,
    kind: 'generated-still',
    background: still.background,
    foreground: still.foreground,
    text: still.text,
    mediaFile: null,
  }
}

export function isSelectedSource(source: SourceRef, selected: SourceRef): boolean {
  return sourcesMatch(source, selected)
}

export function availableSources(
  state: Pick<AtemState, 'inputs'> & Partial<Pick<AtemState, 'superSources'>>,
  mediaPlayerCount: 1 | 2 = 2,
): readonly SourceRef[] {
  return [
    ...state.inputs.map((input) => inputSource(input.id)),
    ...(mediaPlayerCount >= 1 ? [mediaPlayerSource(1)] : []),
    ...(mediaPlayerCount >= 2 ? [mediaPlayerSource(2)] : []),
    ...(state.superSources?.length ? [{ kind: 'super-source' as const }] : []),
  ]
}

export function sourceLabel(source: SourceRef): string {
  return source.kind === 'input'
    ? `Input ${source.inputId}`
    : source.kind === 'media-player'
      ? `Media Player ${source.player}`
      : 'SuperSource'
}

export function sourceStableKey(source: SourceRef): string {
  return sourceKey(source)
}
