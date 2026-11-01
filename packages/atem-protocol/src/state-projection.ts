import type { AtemState, StateChange } from '@atem-sandbox/atem-state'
import {
  getAtemDeviceProfile,
  MACRO_COUNT,
  sourceRefToAtemId,
  type AtemDeviceProfileId,
  type AtemInputConfig,
  type MediaPlayerId,
  type TransitionType,
  type VideoMode,
} from '@atem-sandbox/shared'
import type { AtemCommandRecord } from './packet-codec.js'

/** ATEM protocol V9.4, supported by the pinned v3.9.0 client. */
export const ATEM_SANDBOX_PROTOCOL_VERSION = 0x0002001f

const VIDEO_MODE_CODES: Record<VideoMode, number> = {
  '720p50': 4,
  '1080p25': 10,
  '1080p50': 12,
}

const TRANSITION_STYLE_CODES: Record<TransitionType, number> = {
  mix: 0,
  dip: 1,
  wipe: 2,
}

/**
 * A profile-shaped snapshot required by common ATEM clients before they will
 * accept control feedback. It deliberately advertises only implemented v1
 * facilities: one M/E, the selected profile's camera inputs, its advertised
 * media-player count, and model-accurate upstream/downstream key counts.
 */
export function createInitialStateRecords(
  state: AtemState,
  device: AtemDeviceProfile,
): AtemCommandRecord[] {
  const profile = getAtemDeviceProfile(device.profileId)
  const mediaPlayerIds = profile.topology.mediaPlayers === 1 ? ([1] as const) : ([1, 2] as const)
  const records: AtemCommandRecord[] = [
    record('_ver', writeUInt32(ATEM_SANDBOX_PROTOCOL_VERSION)),
    record('_pin', productIdentifierPayload(device.name, profile.protocolModel)),
    record('_top', topologyPayload(profile)),
    record('_MeC', Uint8Array.of(0, profile.topology.upstreamKeyersPerMixEffect, 0, 0)),
    record('_MvC', Uint8Array.of(0, state.multiviewer.windowCount)),
    record('_AMC', Uint8Array.of(2, 1, 1, 0)),
    record('_FAC', Uint8Array.of(2, 1, 0, 0)),
    record('_MAC', Uint8Array.of(MACRO_COUNT, 0, 0, 0)),
    record('_mpl', Uint8Array.of(profile.topology.mediaPoolStills, 0, 0, 0)),
    record('VidM', Uint8Array.of(VIDEO_MODE_CODES[device.videoMode], 0, 0, 0)),
  ]

  for (const input of state.inputs) {
    records.push(record('InPr', inputPropertiesPayload(input, profile.inputPortType)))
  }

  for (const player of mediaPlayerIds) {
    records.push(record('InPr', mediaPlayerInputPropertiesPayload(player, state)))
  }
  if (profile.effects.superSource > 0) {
    const bytes = new Uint8Array(36)
    writeUInt16Into(bytes, 0, 6000)
    writeAscii(bytes, 2, 'SuperSource', 20)
    writeAscii(bytes, 22, 'SSRC', 4)
    writeUInt16Into(bytes, 28, 0x0100)
    writeUInt16Into(bytes, 30, 0x0100)
    bytes[32] = 6
    bytes[34] = 0x1f
    bytes[35] = 1
    records.push(record('InPr', bytes))
  }

  for (const input of Object.values(state.fairlightAudio.inputs)) {
    records.push(fairlightInputRecord(input), fairlightSourceRecord(input))
  }

  records.push(
    programRecord(state),
    previewRecord(state),
    transitionSettingsRecord(state),
    mixTransitionRecord(state),
    transitionPositionRecord(state),
    fadeToBlackRateRecord(state),
    fadeToBlackStateRecord(state),
    recordingSettingsRecord(state),
    recordingStatusRecord(state),
    recordingDurationRecord(state),
    recordingIsoRecord(state),
    streamingServiceRecord(state),
    streamingStatusRecord(state),
    streamingDurationRecord(state),
    streamingStatsRecord(state),
    streamingAudioBitratesRecord(state),
    mediaPoolSettingsRecord(state),
    timeConfigRecord(state),
    displayClockPropertiesRecord(state),
    displayClockCurrentTimeRecord(state),
    classicAudioMasterRecord(state),
    fairlightMasterRecord(state),
    cameraControlRecord(state),
    tallyBySourceRecord(state),
    macroRunStatusRecord(state),
    macroRecordingStatusRecord(state),
  )

  for (let index = 0; index < MACRO_COUNT; index += 1) {
    records.push(macroPropertiesRecord(index, state.macro.macros[index]))
  }

  records.push(multiviewerPropertiesRecord(state))
  for (let windowIndex = 0; windowIndex < state.multiviewer.windowCount; windowIndex += 1) {
    const window = state.multiviewer.windows[windowIndex]
    if (window !== undefined) {
      records.push(multiviewerSourceRecord(windowIndex, window))
    }
  }

  for (const disk of Object.values(state.recording.disks).sort(
    (left, right) => left.diskId - right.diskId,
  )) {
    records.push(recordingDiskRecord(disk))
  }

  for (const superSource of state.superSources) {
    if (superSource.properties !== undefined) {
      records.push(superSourcePropertiesRecord(superSource))
    }
    if (superSource.border !== undefined) {
      records.push(superSourceBorderRecord(superSource))
    }
    superSource.boxes.forEach((box, boxIndex) => {
      if (box !== undefined) {
        records.push(superSourceBoxRecord(superSource.index, boxIndex, box))
      }
    })
  }

  for (let slot = 1; slot <= 20; slot += 1) {
    const still = state.mediaPool.stills.find((candidate) => candidate.slot === slot)
    records.push(
      record('MPfe', mediaPoolFramePayload(slot - 1, still?.name ?? '', still !== undefined)),
    )
  }

  for (const player of mediaPlayerIds) {
    records.push(mediaPlayerRecord(player, state))
  }

  for (const keyerId of downstreamKeyerIds(profile)) {
    records.push(downstreamKeyPropertiesRecord(keyerId, state))
  }

  for (const keyerId of upstreamKeyerIds(profile)) {
    records.push(upstreamKeyPropertiesRecord(keyerId, state))
    records.push(upstreamKeyLumaRecord(keyerId, state))
  }

  for (const keyerId of upstreamKeyerIds(profile)) {
    records.push(upstreamKeyOnAirRecord(keyerId, state))
  }

  for (const keyerId of downstreamKeyerIds(profile)) {
    records.push(downstreamKeyStateRecord(keyerId, state))
  }

  for (const auxBus of auxiliaryBusIds(profile)) {
    records.push(auxSourceRecord(auxBus, state))
  }

  records.push(record('InCm', Uint8Array.of(1, 0, 0, 0)))

  return records
}

export interface AtemDeviceProfile {
  name: string
  profileId: AtemDeviceProfileId
  videoMode: VideoMode
}

/** Projects a store action into the smallest useful ATEM feedback delta. */
export function createStateChangeRecords(
  change: StateChange,
  device: AtemDeviceProfile,
): AtemCommandRecord[] {
  const { action, state } = change
  const profile = getAtemDeviceProfile(device.profileId)
  const mediaPlayerIds = profile.topology.mediaPlayers === 1 ? ([1] as const) : ([1, 2] as const)
  switch (action.type) {
    case 'load-config':
      // An imported profile can change every announced surface at once. Send a
      // complete v1 snapshot to bring already-connected ATEM clients into
      // sync, rather than trying to infer a partial delta from its contents.
      return createInitialStateRecords(state, device)
    case 'set-program':
      return [programRecord(state), tallyBySourceRecord(state)]
    case 'set-preview':
      return [previewRecord(state), tallyBySourceRecord(state)]
    case 'set-recording-status':
      return [
        recordingStatusRecord(state),
        recordingDurationRecord(state),
        ...Object.values(state.recording.disks)
          .sort((left, right) => left.diskId - right.diskId)
          .map((disk) => recordingDiskRecord(disk)),
      ]
    case 'set-recording-iso':
      return [recordingIsoRecord(state)]
    case 'switch-recording-disk':
      return [
        recordingSettingsRecord(state),
        recordingStatusRecord(state),
        ...Object.values(state.recording.disks)
          .sort((left, right) => left.diskId - right.diskId)
          .map((disk) => recordingDiskRecord(disk)),
      ]
    case 'set-streaming-status':
      return [
        streamingStatusRecord(state),
        streamingDurationRecord(state),
        streamingStatsRecord(state),
      ]
    case 'set-streaming-service':
      return [streamingServiceRecord(state)]
    case 'set-streaming-audio-bitrates':
      return [streamingAudioBitratesRecord(state)]
    case 'set-video-mode-code':
      return [videoModeRecord(state)]
    case 'set-media-pool-settings':
      return [mediaPoolSettingsRecord(state)]
    case 'save-startup-state':
    case 'clear-startup-state':
      return []
    case 'set-time-mode':
      return [timeConfigRecord(state)]
    case 'set-time':
      return [timeRecord(state), recordingDurationRecord(state), streamingDurationRecord(state)]
    case 'set-display-clock-state':
      return [displayClockPropertiesRecord(state)]
    case 'set-display-clock-properties':
      return [displayClockPropertiesRecord(state)]
    case 'set-multiviewer-properties':
      return [multiviewerPropertiesRecord(state)]
    case 'set-multiviewer-window-source': {
      const records: AtemCommandRecord[] = []
      for (let windowIndex = 0; windowIndex < state.multiviewer.windowCount; windowIndex += 1) {
        const window = state.multiviewer.windows[windowIndex]
        if (window !== undefined) {
          records.push(multiviewerSourceRecord(windowIndex, window))
        }
      }
      return records
    }
    case 'set-classic-audio-master':
      return [classicAudioMasterRecord(state)]
    case 'set-fairlight-master':
      return [fairlightMasterRecord(state)]
    case 'set-fairlight-source':
      return Object.values(state.fairlightAudio.inputs).map(fairlightSourceRecord)
    case 'set-camera-control':
      return [cameraControlRecord(state)]
    case 'set-fade-to-black-rate':
      return [fadeToBlackRateRecord(state)]
    case 'fade-to-black':
      return [fadeToBlackStateRecord(state)]
    case 'macro-run':
    case 'macro-stop':
    case 'macro-continue':
    case 'macro-insert-user-wait':
    case 'set-macro-loop':
      return [macroRunStatusRecord(state)]
    case 'macro-start-record':
    case 'macro-stop-record': {
      const index = state.macro.macroRecorder.macroIndex
      const macro = state.macro.macros[index]
      return [
        macroRecordingStatusRecord(state),
        ...(macro ? [macroPropertiesRecord(index, macro)] : []),
      ]
    }
    case 'macro-delete':
    case 'macro-update-properties': {
      const index = change.action.macroIndex!
      return [macroPropertiesRecord(index, state.macro.macros[index])]
    }
    case 'set-super-source-properties':
      return state.superSources.flatMap((superSource) =>
        superSource.properties !== undefined ? [superSourcePropertiesRecord(superSource)] : [],
      )
    case 'set-super-source-border':
      return state.superSources.flatMap((superSource) =>
        superSource.border !== undefined ? [superSourceBorderRecord(superSource)] : [],
      )
    case 'set-super-source-box':
      return state.superSources.flatMap((superSource) =>
        superSource.boxes.flatMap((box, boxIndex) =>
          box === undefined ? [] : [superSourceBoxRecord(superSource.index, boxIndex, box)],
        ),
      )
    case 'cut':
      return [programRecord(state), previewRecord(state), tallyBySourceRecord(state)]
    case 'auto-start':
    case 'auto-complete':
      return [
        ...(action.type === 'auto-complete'
          ? [programRecord(state), previewRecord(state), tallyBySourceRecord(state)]
          : []),
        transitionPositionRecord(state),
      ]
    case 'auto-progress':
      // Store progress is emitted at frame cadence. Clients only need the
      // start and end state, and emitting every tick would congest UDP.
      return []
    case 'set-transition-type':
      return [transitionSettingsRecord(state)]
    case 'set-transition-rate':
      return [mixTransitionRecord(state)]
    case 'select-media-player-still':
      return mediaPlayerIds.map((player) => mediaPlayerRecord(player, state))
    case 'set-aux-source':
      return auxiliaryBusIds(profile).map((auxBus) => auxSourceRecord(auxBus, state))
    case 'upsert-media-pool-still':
      return Array.from({ length: 20 }, (_, index) => {
        const slot = index + 1
        const still = state.mediaPool.stills.find((candidate) => candidate.slot === slot)
        return record('MPfe', mediaPoolFramePayload(index, still?.name ?? '', still !== undefined))
      })
    case 'delete-media-pool-still':
      return createInitialStateRecords(state, device)
    case 'update-media-player':
      return mediaPlayerIds.map((player) =>
        record('InPr', mediaPlayerInputPropertiesPayload(player, state)),
      )
    case 'set-upstream-key':
      return upstreamKeyerIds(profile).map((keyerId) => upstreamKeyOnAirRecord(keyerId, state))
    case 'set-upstream-key-luma':
      return upstreamKeyerIds(profile).map((keyerId) => upstreamKeyLumaRecord(keyerId, state))
    case 'set-upstream-key-type':
    case 'set-upstream-key-fill-source':
    case 'set-upstream-key-cut-source':
      return upstreamKeyerIds(profile).map((keyerId) => upstreamKeyPropertiesRecord(keyerId, state))
    case 'set-downstream-key':
      return downstreamKeyerIds(profile).map((keyerId) => downstreamKeyStateRecord(keyerId, state))
    case 'set-downstream-key-tie':
    case 'set-downstream-key-rate':
      return downstreamKeyerIds(profile).map((keyerId) =>
        downstreamKeyPropertiesRecord(keyerId, state),
      )
    case 'auto-downstream-key':
      return downstreamKeyerIds(profile).map((keyerId) => downstreamKeyStateRecord(keyerId, state))
    case 'update-input': {
      const inputPortType = getAtemDeviceProfile(device.profileId).inputPortType
      const inputId = action.type === 'update-input' ? findChangedInputId(change) : undefined
      if (inputId === undefined) {
        return state.inputs.map((input) =>
          record('InPr', inputPropertiesPayload(input, inputPortType)),
        )
      }
      const input = state.inputs.find((candidate) => candidate.id === inputId)
      return input === undefined
        ? []
        : [record('InPr', inputPropertiesPayload(input, inputPortType))]
    }
    default:
      return []
  }
}

function findChangedInputId(change: StateChange): number | undefined {
  // StateChange intentionally contains the post-change snapshot only. The
  // action does not carry the input ID, so callers use a complete input update
  // when this compatibility path is needed.
  void change
  return undefined
}

function programRecord(state: AtemState): AtemCommandRecord {
  return record('PrgI', mixEffectSourcePayload(sourceRefToAtemId(state.program)))
}

function previewRecord(state: AtemState): AtemCommandRecord {
  const bytes = new Uint8Array(8)
  bytes.set(mixEffectSourcePayload(sourceRefToAtemId(state.preview)))
  return record('PrvI', bytes)
}

function transitionSettingsRecord(state: AtemState): AtemCommandRecord {
  const style = TRANSITION_STYLE_CODES[state.transition.type]
  return record('TrSS', Uint8Array.of(0, style, 1, style, 1, 0, 0, 0))
}

function mixTransitionRecord(state: AtemState): AtemCommandRecord {
  return record('TMxP', Uint8Array.of(0, state.transition.rateFrames, 0, 0))
}

function transitionPositionRecord(state: AtemState): AtemCommandRecord {
  const bytes = new Uint8Array(8)
  bytes[0] = 0
  bytes[1] = state.transition.inTransition ? 1 : 0
  bytes[2] = state.transition.inTransition
    ? Math.min(
        255,
        Math.max(0, Math.round(state.transition.rateFrames * (1 - state.transition.position))),
      )
    : 0
  writeUInt16Into(
    bytes,
    4,
    Math.round(Math.min(1, Math.max(0, state.transition.position)) * 10_000),
  )
  return record('TrPs', bytes)
}

function videoModeRecord(state: AtemState): AtemCommandRecord {
  return record('VidM', Uint8Array.of(state.settings.videoModeCode, 0, 0, 0))
}

function fadeToBlackRateRecord(state: AtemState): AtemCommandRecord {
  return record('FtbP', Uint8Array.of(0, state.fadeToBlack.rate))
}

function fadeToBlackStateRecord(state: AtemState): AtemCommandRecord {
  return record(
    'FtbS',
    Uint8Array.of(
      0,
      state.fadeToBlack.isFullyBlack ? 1 : 0,
      state.fadeToBlack.inTransition ? 1 : 0,
      state.fadeToBlack.remainingFrames,
    ),
  )
}

function recordingSettingsRecord(state: AtemState): AtemCommandRecord {
  const bytes = new Uint8Array(140)
  writeAscii(bytes, 0, state.recording.properties.filename, 128)
  writeUInt32Into(bytes, 128, state.recording.properties.workingSet1DiskId)
  writeUInt32Into(bytes, 132, state.recording.properties.workingSet2DiskId)
  bytes[136] = state.recording.properties.recordInAllCameras ? 1 : 0
  return record('RMSu', bytes)
}

function recordingStatusRecord(state: AtemState): AtemCommandRecord {
  const bytes = new Uint8Array(8)
  writeUInt16Into(bytes, 0, state.recording.status.state | state.recording.status.error)
  writeUInt32Into(bytes, 4, Math.max(0, state.recording.status.recordingTimeAvailable))
  return record('RTMS', bytes)
}

function recordingDurationRecord(state: AtemState): AtemCommandRecord {
  return record('RTMR', timecodePayload(state.recording.duration))
}

function recordingIsoRecord(state: AtemState): AtemCommandRecord {
  return record('ISOi', Uint8Array.of(state.recording.recordAllInputs ? 1 : 0, 0, 0, 0))
}

function recordingDiskRecord(disk: {
  diskId: number
  volumeName: string
  recordingTimeAvailable: number
  status: number
}): AtemCommandRecord {
  const bytes = new Uint8Array(74)
  writeUInt32Into(bytes, 0, disk.diskId)
  writeUInt32Into(bytes, 4, Math.max(0, disk.recordingTimeAvailable))
  writeUInt16Into(bytes, 8, disk.status)
  writeAscii(bytes, 10, disk.volumeName, 64)
  return record('RTMD', bytes)
}

function streamingServiceRecord(state: AtemState): AtemCommandRecord {
  const bytes = new Uint8Array(1096)
  writeAscii(bytes, 0, state.streaming.service.serviceName, 64)
  writeAscii(bytes, 64, state.streaming.service.url, 512)
  writeAscii(bytes, 576, state.streaming.service.key, 512)
  writeUInt32Into(bytes, 1088, state.streaming.service.bitrates[0] ?? 0)
  writeUInt32Into(bytes, 1092, state.streaming.service.bitrates[1] ?? 0)
  return record('SRSU', bytes)
}

function streamingStatusRecord(state: AtemState): AtemCommandRecord {
  const bytes = new Uint8Array(2)
  writeUInt16Into(bytes, 0, state.streaming.status.state | state.streaming.status.error)
  return record('StRS', bytes)
}

function streamingDurationRecord(state: AtemState): AtemCommandRecord {
  return record('SRST', timecodePayload(state.streaming.duration))
}

function streamingStatsRecord(state: AtemState): AtemCommandRecord {
  const bytes = new Uint8Array(6)
  writeUInt32Into(bytes, 0, state.streaming.stats?.encodingBitrate ?? 0)
  writeUInt16Into(bytes, 4, state.streaming.stats?.cacheUsed ?? 0)
  return record('SRSS', bytes)
}

function streamingAudioBitratesRecord(state: AtemState): AtemCommandRecord {
  const bytes = new Uint8Array(8)
  writeUInt32Into(bytes, 0, state.streaming.audioBitrates?.lowBitrate ?? 128_000)
  writeUInt32Into(bytes, 4, state.streaming.audioBitrates?.highBitrate ?? 192_000)
  return record('STAB', bytes)
}

function mediaPoolSettingsRecord(state: AtemState): AtemCommandRecord {
  const bytes = new Uint8Array(10)
  writeUInt16Into(bytes, 0, state.settings.mediaPool.maxFrames[0])
  writeUInt16Into(bytes, 2, state.settings.mediaPool.maxFrames[1])
  writeUInt16Into(bytes, 4, state.settings.mediaPool.maxFrames[2])
  writeUInt16Into(bytes, 6, state.settings.mediaPool.maxFrames[3])
  writeUInt16Into(bytes, 8, state.settings.mediaPool.unassignedFrames)
  return record('MPSp', bytes)
}

function timeConfigRecord(state: AtemState): AtemCommandRecord {
  return record('TCCc', Uint8Array.of(state.settings.timeMode))
}

function timeRecord(state: AtemState): AtemCommandRecord {
  const duration = state.recording.duration ?? {
    hours: 0,
    minutes: 0,
    seconds: 0,
    frames: 0,
    isDropFrame: false,
  }
  const bytes = new Uint8Array(8)
  bytes[0] = duration.hours
  bytes[1] = duration.minutes
  bytes[2] = duration.seconds
  bytes[3] = duration.frames
  bytes[5] = duration.isDropFrame ? 1 : 0
  return record('Time', bytes)
}

function displayClockPropertiesRecord(state: AtemState): AtemCommandRecord {
  const props = state.displayClock.properties
  const bytes = new Uint8Array(17)
  bytes[1] = props.enabled ? 1 : 0
  bytes[3] = props.size
  bytes[5] = props.opacity
  writeInt16Into(bytes, 6, props.positionX)
  writeInt16Into(bytes, 8, props.positionY)
  bytes[10] = props.autoHide ? 1 : 0
  bytes[11] = props.startFrom.hours
  bytes[12] = props.startFrom.minutes
  bytes[13] = props.startFrom.seconds
  bytes[14] = props.startFrom.frames
  bytes[15] = props.clockMode
  bytes[16] = props.clockState
  return record('DCPV', bytes)
}

function displayClockCurrentTimeRecord(state: AtemState): AtemCommandRecord {
  const time = state.displayClock.currentTime
  return record('DSTV', Uint8Array.of(0, time.hours, time.minutes, time.seconds, time.frames))
}

function multiviewerPropertiesRecord(state: AtemState): AtemCommandRecord {
  return record(
    'MvPr',
    Uint8Array.of(
      0,
      state.multiviewer.properties.layout,
      state.multiviewer.properties.programPreviewSwapped ? 1 : 0,
    ),
  )
}

function multiviewerSourceRecord(
  windowIndex: number,
  window: { source: number; supportsVuMeter: boolean; supportsSafeArea: boolean },
): AtemCommandRecord {
  const bytes = new Uint8Array(6)
  bytes[0] = 0
  bytes[1] = windowIndex
  writeUInt16Into(bytes, 2, window.source)
  bytes[4] = window.supportsVuMeter ? 1 : 0
  bytes[5] = window.supportsSafeArea ? 1 : 0
  return record('MvIn', bytes)
}

function classicAudioMasterRecord(state: AtemState): AtemCommandRecord {
  const bytes = new Uint8Array(5)
  writeUInt16Into(bytes, 0, Math.max(0, Math.min(0xffff, state.classicAudio.master.gain)))
  writeInt16Into(bytes, 2, state.classicAudio.master.balance)
  bytes[4] = state.classicAudio.master.followFadeToBlack ? 1 : 0
  return record('AMMO', bytes)
}

function fairlightMasterRecord(state: AtemState): AtemCommandRecord {
  const master = state.fairlightAudio.master
  const bytes = new Uint8Array(20)
  bytes[0] = master.bandCount
  bytes[1] = master.equalizerEnabled ? 1 : 0
  writeInt32Into(bytes, 4, master.equalizerGain)
  writeInt32Into(bytes, 8, master.makeUpGain)
  writeInt32Into(bytes, 12, master.faderGain)
  bytes[16] = master.followFadeToBlack ? 1 : 0
  return record('FAMP', bytes)
}

function fairlightInputRecord(
  input: AtemState['fairlightAudio']['inputs'][number],
): AtemCommandRecord {
  const bytes = new Uint8Array(13)
  writeUInt16Into(bytes, 0, input.id)
  bytes[2] = 2
  writeUInt16Into(bytes, 6, input.id < 1300 ? 32 : 512)
  bytes[9] = 2
  bytes[10] = 2
  bytes[11] = 1
  bytes[12] = 1
  return record('FAIP', bytes)
}

function fairlightSourceRecord(
  input: AtemState['fairlightAudio']['inputs'][number],
): AtemCommandRecord {
  const bytes = new Uint8Array(50)
  writeUInt16Into(bytes, 0, input.id)
  new DataView(bytes.buffer).setBigInt64(8, BigInt(input.sourceId))
  bytes[16] = 1
  writeInt32Into(bytes, 44, input.faderGain)
  bytes[48] = 7
  bytes[49] = input.mixOption
  return record('FASP', bytes)
}

function cameraControlRecord(state: AtemState): AtemCommandRecord {
  const control = state.cameraControl
  const bytes = new Uint8Array(24)
  bytes[0] = control.source
  bytes[1] = control.category
  bytes[2] = control.parameter
  bytes[3] = control.type
  writeUInt16Into(bytes, 4, control.numberData.length)
  bytes[12] = control.periodicFlushEnabled ? 1 : 0
  let offset = 16
  for (const value of control.numberData.slice(0, 8)) {
    bytes[offset] = value & 0xff
    offset += 1
  }
  return record('CCdP', bytes)
}

function tallyBySourceRecord(state: AtemState): AtemCommandRecord {
  const sources = [
    ...state.inputs.map((input) => input.id),
    ...(state.multiviewer.count > 0 ? [3010, 3020] : []),
    ...(state.superSources.length > 0 ? [6000] : []),
  ]
  const bytes = new Uint8Array(2 + sources.length * 3)
  writeUInt16Into(bytes, 0, sources.length)
  sources.forEach((source, index) => {
    const offset = 2 + index * 3
    writeUInt16Into(bytes, offset, source)
    const program = source === sourceRefToAtemId(state.program)
    const preview = source === sourceRefToAtemId(state.preview)
    bytes[offset + 2] = (program ? 1 : 0) | (preview ? 1 << 1 : 0)
  })
  return record('TlSr', bytes)
}

function macroRunStatusRecord(state: AtemState): AtemCommandRecord {
  const flags =
    (state.macro.macroPlayer.isRunning ? 1 << 0 : 0) |
    (state.macro.macroPlayer.isWaiting ? 1 << 1 : 0)
  const bytes = new Uint8Array(4)
  bytes[0] = flags
  bytes[1] = state.macro.macroPlayer.loop ? 1 : 0
  writeUInt16Into(bytes, 2, state.macro.macroPlayer.macroIndex)
  return record('MRPr', bytes)
}

function macroRecordingStatusRecord(state: AtemState): AtemCommandRecord {
  const bytes = new Uint8Array(4)
  bytes[0] = state.macro.macroRecorder.isRecording ? 1 : 0
  writeUInt16Into(bytes, 2, state.macro.macroRecorder.macroIndex)
  return record('MRcS', bytes)
}

function macroPropertiesRecord(
  index: number,
  macro: AtemState['macro']['macros'][number] | undefined,
): AtemCommandRecord {
  const name = new TextEncoder().encode(macro?.name ?? '')
  const description = new TextEncoder().encode(macro?.description ?? '')
  const bytes = new Uint8Array(8 + name.length + description.length)
  writeUInt16Into(bytes, 0, index)
  bytes[2] = macro === undefined ? 0 : 1
  bytes[3] = macro?.hasUnsupportedOps ? 1 : 0
  writeUInt16Into(bytes, 4, name.length)
  writeUInt16Into(bytes, 6, description.length)
  bytes.set(name, 8)
  bytes.set(description, 8 + name.length)
  return record('MPrp', bytes)
}

function superSourcePropertiesRecord(state: AtemState['superSources'][number]): AtemCommandRecord {
  const properties = state.properties!
  const bytes = new Uint8Array(13)
  bytes[0] = state.index
  writeUInt16Into(bytes, 2, properties.artFillSource)
  writeUInt16Into(bytes, 4, properties.artCutSource)
  bytes[6] = properties.artOption
  bytes[7] = properties.artPreMultiplied ? 1 : 0
  writeUInt16Into(bytes, 8, properties.artClip)
  writeUInt16Into(bytes, 10, properties.artGain)
  bytes[12] = properties.artInvertKey ? 1 : 0
  return record('SSrc', bytes)
}

function superSourceBorderRecord(state: AtemState['superSources'][number]): AtemCommandRecord {
  const border = state.border!
  const bytes = new Uint8Array(21)
  bytes[0] = state.index
  bytes[1] = border.borderEnabled ? 1 : 0
  bytes[2] = border.borderBevel
  writeUInt16Into(bytes, 4, border.borderOuterWidth)
  writeUInt16Into(bytes, 6, border.borderInnerWidth)
  bytes[8] = border.borderOuterSoftness
  bytes[9] = border.borderInnerSoftness
  bytes[10] = border.borderBevelSoftness
  bytes[11] = border.borderBevelPosition
  writeUInt16Into(bytes, 12, border.borderHue)
  writeUInt16Into(bytes, 14, border.borderSaturation)
  writeUInt16Into(bytes, 16, border.borderLuma)
  writeUInt16Into(bytes, 18, border.borderLightSourceDirection)
  bytes[20] = border.borderLightSourceAltitude
  return record('SSBd', bytes)
}

function superSourceBoxRecord(
  ssrcId: number,
  boxId: number,
  box: NonNullable<AtemState['superSources'][number]['boxes'][number]>,
): AtemCommandRecord {
  const bytes = new Uint8Array(22)
  bytes[0] = ssrcId
  bytes[1] = boxId
  bytes[2] = box.enabled ? 1 : 0
  writeUInt16Into(bytes, 4, box.source)
  writeInt16Into(bytes, 6, box.x)
  writeInt16Into(bytes, 8, box.y)
  writeUInt16Into(bytes, 10, box.size)
  bytes[12] = box.cropped ? 1 : 0
  writeUInt16Into(bytes, 14, box.cropTop)
  writeUInt16Into(bytes, 16, box.cropBottom)
  writeUInt16Into(bytes, 18, box.cropLeft)
  writeUInt16Into(bytes, 20, box.cropRight)
  return record('SSBP', bytes)
}

function mediaPlayerRecord(player: MediaPlayerId, state: AtemState): AtemCommandRecord {
  const mediaPlayer = state.mediaPlayers[player]
  return record('MPCE', Uint8Array.of(player - 1, 1, mediaPlayer.slot - 1, 0))
}

function upstreamKeyOnAirRecord(keyerId: 1 | 2 | 3 | 4, state: AtemState): AtemCommandRecord {
  return record('KeOn', Uint8Array.of(0, keyerId - 1, state.upstreamKeys[keyerId] ? 1 : 0, 0))
}

function upstreamKeyLumaRecord(keyerId: 1 | 2 | 3 | 4, state: AtemState): AtemCommandRecord {
  const luma = state.upstreamKeyLuma[keyerId]!
  const bytes = new Uint8Array(12)
  bytes[1] = keyerId - 1
  bytes[2] = luma.preMultiplied ? 1 : 0
  writeUInt16Into(bytes, 4, luma.clip)
  writeUInt16Into(bytes, 6, luma.gain)
  bytes[8] = luma.invert ? 1 : 0
  return record('KeLm', bytes)
}

function upstreamKeyPropertiesRecord(keyerId: 1 | 2 | 3 | 4, state: AtemState): AtemCommandRecord {
  const keyer = state.upstreamKeyProperties[keyerId]!
  const bytes = new Uint8Array(20)
  bytes[0] = 0
  bytes[1] = keyerId - 1
  bytes[2] = keyer.mixEffectKeyType
  bytes[4] = keyer.flyEnabled ? 1 : 0
  writeUInt16Into(bytes, 6, keyer.fillSource)
  writeUInt16Into(bytes, 8, keyer.cutSource)
  return record('KeBP', bytes)
}

function downstreamKeyStateRecord(keyerId: 1 | 2, state: AtemState): AtemCommandRecord {
  const keyer = state.downstreamKeys[keyerId]!
  const onAir = keyer.onAir ? 1 : 0
  return record(
    'DskS',
    Uint8Array.of(
      keyerId - 1,
      onAir,
      keyer.inTransition ? 1 : 0,
      keyer.isAuto ? 1 : 0,
      keyer.isTowardsOnAir ? 1 : 0,
      keyer.remainingFrames,
    ),
  )
}

function downstreamKeyPropertiesRecord(keyerId: 1 | 2, state: AtemState): AtemCommandRecord {
  const keyer = state.downstreamKeys[keyerId]!
  const bytes = new Uint8Array(18)
  bytes[0] = keyerId - 1
  bytes[1] = keyer.tie ? 1 : 0
  bytes[2] = keyer.rate
  return record('DskP', bytes)
}

function auxSourceRecord(auxBus: 1 | 2 | 3 | 4, state: AtemState): AtemCommandRecord {
  const bytes = new Uint8Array(4)
  bytes[0] = auxBus - 1
  writeUInt16Into(bytes, 2, sourceRefToAtemId(state.auxiliaries[auxBus]!))
  return record('AuxS', bytes)
}

function upstreamKeyerIds(profile: ReturnType<typeof getAtemDeviceProfile>): Array<1 | 2 | 3 | 4> {
  return [1, 2, 3, 4].slice(0, profile.topology.upstreamKeyersPerMixEffect) as Array<1 | 2 | 3 | 4>
}

function downstreamKeyerIds(profile: ReturnType<typeof getAtemDeviceProfile>): Array<1 | 2> {
  return [1, 2].slice(0, profile.topology.downstreamKeyers) as Array<1 | 2>
}

function auxiliaryBusIds(profile: ReturnType<typeof getAtemDeviceProfile>): Array<1 | 2 | 3 | 4> {
  return [1, 2, 3, 4].slice(0, profile.topology.auxiliaries) as Array<1 | 2 | 3 | 4>
}

function topologyPayload(profile: ReturnType<typeof getAtemDeviceProfile>): Uint8Array {
  // The V8.1.1+ topology layout has the multiviewer byte at index 6. The
  // established 28-byte payload leaves later capability fields explicitly 0.
  const bytes = new Uint8Array(28)
  bytes[0] = profile.topology.mixEffects
  bytes[1] = profile.topology.sources // media players have their own capability
  bytes[2] = profile.topology.downstreamKeyers
  bytes[3] = profile.topology.auxiliaries
  bytes[5] = profile.topology.mediaPlayers
  bytes[6] = 1 // expose one multiviewer surface
  bytes[9] = profile.effects.dves
  bytes[10] = 0 // stingers not modeled
  bytes[11] = profile.effects.superSource
  bytes[18] = 1 // camera control modeled
  bytes[22] = profile.effects.advancedChromaKeyers > 0 ? 1 : 0
  return bytes
}

function productIdentifierPayload(name: string, protocolModel: number): Uint8Array {
  const bytes = new Uint8Array(44)
  writeAscii(bytes, 0, name, 40)
  bytes[40] = protocolModel
  return bytes
}

function inputPropertiesPayload(input: AtemInputConfig, inputPortType: 1 | 2): Uint8Array {
  const bytes = new Uint8Array(36)
  writeUInt16Into(bytes, 0, input.id)
  writeAscii(bytes, 2, input.longName, 20)
  writeAscii(bytes, 22, input.shortName, 4)
  bytes[26] = 1 // names supplied by the switcher profile
  writeUInt16Into(bytes, 28, inputPortType)
  writeUInt16Into(bytes, 30, inputPortType)
  bytes[32] = 0 // external input
  bytes[34] = 0x1f // standard source availability flags
  bytes[35] = 1 // M/E 1
  return bytes
}

function mediaPlayerInputPropertiesPayload(player: MediaPlayerId, state: AtemState): Uint8Array {
  const bytes = new Uint8Array(36)
  const sourceId = player === 1 ? 3010 : 3020
  writeUInt16Into(bytes, 0, sourceId)
  writeAscii(bytes, 2, state.mediaPlayers[player].name, 20)
  writeAscii(bytes, 22, `MP${player}`, 4)
  writeUInt16Into(bytes, 28, 0x0100) // Internal external-port flag
  writeUInt16Into(bytes, 30, 0x0100)
  bytes[32] = 4 // media-player fill
  bytes[34] = 0x1f
  bytes[35] = 1
  return bytes
}

function mediaPoolFramePayload(index: number, name: string, used = true): Uint8Array {
  const encodedName = asciiBytes(name, 192)
  const bytes = new Uint8Array(24 + encodedName.byteLength)
  bytes[0] = 0 // still pool
  writeUInt16Into(bytes, 2, index)
  bytes[4] = used ? 1 : 0
  bytes[23] = encodedName.byteLength
  bytes.set(encodedName, 24)
  return bytes
}

function mixEffectSourcePayload(source: number): Uint8Array {
  const bytes = new Uint8Array(4)
  writeUInt16Into(bytes, 2, source)
  return bytes
}

function timecodePayload(
  timecode:
    | { hours: number; minutes: number; seconds: number; frames: number; isDropFrame: boolean }
    | undefined,
): Uint8Array {
  const bytes = new Uint8Array(5)
  if (timecode === undefined) {
    return bytes
  }
  bytes[0] = timecode.hours
  bytes[1] = timecode.minutes
  bytes[2] = timecode.seconds
  bytes[3] = timecode.frames
  bytes[4] = timecode.isDropFrame ? 1 : 0
  return bytes
}

function writeUInt32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  bytes[0] = (value >>> 24) & 0xff
  bytes[1] = (value >>> 16) & 0xff
  bytes[2] = (value >>> 8) & 0xff
  bytes[3] = value & 0xff
  return bytes
}

function writeUInt16Into(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 8) & 0xff
  bytes[offset + 1] = value & 0xff
}

function writeUInt32Into(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}

function writeInt32Into(bytes: Uint8Array, offset: number, value: number): void {
  writeUInt32Into(bytes, offset, value >>> 0)
}

function writeInt16Into(bytes: Uint8Array, offset: number, value: number): void {
  const normalized = value < 0 ? 0x10000 + value : value
  writeUInt16Into(bytes, offset, normalized)
}

function record(command: string, payload: Uint8Array): AtemCommandRecord {
  return { command, payload }
}

function writeAscii(bytes: Uint8Array, offset: number, value: string, maxLength: number): void {
  bytes.set(asciiBytes(value, maxLength), offset)
}

function asciiBytes(value: string, maxLength: number): Uint8Array {
  const bytes: number[] = []
  for (const character of value) {
    const code = character.codePointAt(0)
    if (code === undefined || code === 0 || code > 0x7f || bytes.length >= maxLength) {
      break
    }
    bytes.push(code)
  }
  return Uint8Array.from(bytes)
}
