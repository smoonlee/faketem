import {
  atemIdToSourceRef,
  type TransitionType,
  type MediaPlayerId,
  type SourceRef,
} from '@atem-sandbox/shared'
import type { AtemProtocolControl } from './control.js'
import type { AtemCommandRecord } from './packet-codec.js'

export interface CommandHandlingResult {
  accepted: boolean
  reason?: string
}

/** Translates the small, explicitly supported inbound ATEM command set. */
export function applyAtemCommand(
  command: AtemCommandRecord,
  control: AtemProtocolControl,
): CommandHandlingResult {
  try {
    switch (command.command) {
      case 'RcTM':
        return setRecordingStatus(command.payload, control)
      case 'ISOi':
        return setRecordingIso(command.payload, control)
      case 'RMSp':
        return switchRecordingDisk(command.payload, control)
      case 'StrR':
        return setStreamingStatus(command.payload, control)
      case 'CRSS':
        return setStreamingService(command.payload, control)
      case 'STAB':
        return setStreamingAudioBitrates(command.payload, control)
      case 'CVdM':
        return setVideoMode(command.payload, control)
      case 'CMPS':
        return setMediaPoolSettings(command.payload, control)
      case 'SRsv':
        return saveStartupState(command.payload, control)
      case 'SRcl':
        return clearStartupState(command.payload, control)
      case 'CTCC':
        return setTimeMode(command.payload, control)
      case 'Time':
        return setTime(command.payload, control)
      case 'DCSC':
        return setDisplayClockState(command.payload, control)
      case 'DCPC':
        return setDisplayClockProperties(command.payload, control)
      case 'CMvP':
        return setMultiviewerProperties(command.payload, control)
      case 'CMvI':
        return setMultiviewerSource(command.payload, control)
      case 'CAMM':
        return setClassicAudioMaster(command.payload, control)
      case 'CFMP':
        return setFairlightMaster(command.payload, control)
      case 'CFSP':
        return setFairlightSource(command.payload, control)
      case 'CCmd':
        return setCameraControl(command.payload, control)
      case 'FtbA':
        return runMixEffectAction(command.payload, () => control.fadeToBlack())
      case 'FtbC':
        return setFadeToBlackRate(command.payload, control)
      case 'MAct':
        return applyMacroAction(command.payload, control)
      case 'MSRc':
        return startMacroRecording(command.payload, control)
      case 'MSlp':
        if (command.payload.byteLength < 4) return unsupported('Macro pause command is too short.')
        control.macroAddPause(readUInt16(command.payload, 2))
        return { accepted: true }
      case 'CMPr':
        return updateMacroProperties(command.payload, control)
      case 'MRCP':
        return setMacroRunStatus(command.payload, control)
      case 'CSSc':
        return setSuperSourceProperties(command.payload, control)
      case 'CSBd':
        return setSuperSourceBorder(command.payload, control)
      case 'CSBP':
        return setSuperSourceBox(command.payload, control)
      case 'CPgI':
        return setSource(command.payload, control.setProgram.bind(control))
      case 'CPvI':
        return setSource(command.payload, control.setPreview.bind(control))
      case 'CAuS':
        return setAuxSource(command.payload, control)
      case 'DCut':
        return runMixEffectAction(command.payload, () => control.cut())
      case 'DAut':
        return runMixEffectAction(command.payload, () => control.startAuto())
      case 'CTTp':
        return setTransitionProperties(command.payload, control)
      case 'CTMx':
        return setTransitionRate(command.payload, control)
      case 'MPSS':
        return setMediaPlayerSource(command.payload, control)
      case 'CKOn':
        return setUpstreamKeyOnAir(command.payload, control)
      case 'CKLm':
        return setUpstreamKeyLuma(command.payload, control)
      case 'CKTp':
        return setUpstreamKeyType(command.payload, control)
      case 'CKeF':
        return setUpstreamKeyFillSource(command.payload, control)
      case 'CKeC':
        return setUpstreamKeyCutSource(command.payload, control)
      case 'CDsL':
        return setDownstreamKeyOnAir(command.payload, control)
      case 'CDsT':
        return setDownstreamKeyTie(command.payload, control)
      case 'CDsR':
        return setDownstreamKeyRate(command.payload, control)
      case 'DDsA':
        return autoDownstreamKey(command.payload, control)
      default:
        return { accepted: false, reason: `Unsupported ATEM command ${command.command}.` }
    }
  } catch (error) {
    return {
      accepted: false,
      reason: error instanceof Error ? error.message : 'The command could not be applied.',
    }
  }
}

function setRecordingStatus(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 1) {
    return unsupported('Recording status command is too short.')
  }
  control.setRecordingStatus(payload[0] === 1)
  return { accepted: true }
}

function setRecordingIso(payload: Uint8Array, control: AtemProtocolControl): CommandHandlingResult {
  if (payload.byteLength < 1) {
    return unsupported('Recording ISO command is too short.')
  }
  control.setRecordingIso(payload[0] === 1)
  return { accepted: true }
}

function switchRecordingDisk(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength > 0) {
    // v8.1.1 writes this as an empty payload; ignore trailing bytes defensively.
  }
  control.switchRecordingDisk()
  return { accepted: true }
}

function setStreamingStatus(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 1) {
    return unsupported('Streaming status command is too short.')
  }
  control.setStreamingStatus(payload[0] === 1)
  return { accepted: true }
}

function setStreamingService(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 1100) {
    return unsupported('Streaming service command is too short.')
  }
  const mask = payload[0] ?? 0
  const service: {
    serviceName?: string
    url?: string
    key?: string
    bitrates?: [number, number]
  } = {}
  if ((mask & (1 << 0)) !== 0) {
    service.serviceName = readNullTerminatedAscii(payload, 1, 64)
  }
  if ((mask & (1 << 1)) !== 0) {
    service.url = readNullTerminatedAscii(payload, 65, 512)
  }
  if ((mask & (1 << 2)) !== 0) {
    service.key = readNullTerminatedAscii(payload, 577, 512)
  }
  if ((mask & (1 << 3)) !== 0) {
    service.bitrates = [readUInt32(payload, 1092), readUInt32(payload, 1096)]
  }
  control.setStreamingService(service)
  return { accepted: true }
}

function setStreamingAudioBitrates(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 8) {
    return unsupported('Streaming audio bitrate command is too short.')
  }
  control.setStreamingAudioBitrates(readUInt32(payload, 0), readUInt32(payload, 4))
  return { accepted: true }
}

function setVideoMode(payload: Uint8Array, control: AtemProtocolControl): CommandHandlingResult {
  if (payload.byteLength < 1) {
    return unsupported('Video mode command is too short.')
  }
  control.setVideoModeCode(payload[0] ?? 0)
  return { accepted: true }
}

function setMediaPoolSettings(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 8) {
    return unsupported('Media pool settings command is too short.')
  }
  control.setMediaPoolSettings([
    readUInt16(payload, 0),
    readUInt16(payload, 2),
    readUInt16(payload, 4),
    readUInt16(payload, 6),
  ])
  return { accepted: true }
}

function saveStartupState(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  void payload
  control.saveStartupState()
  return { accepted: true }
}

function clearStartupState(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  void payload
  control.clearStartupState()
  return { accepted: true }
}

function setTimeMode(payload: Uint8Array, control: AtemProtocolControl): CommandHandlingResult {
  if (payload.byteLength < 1) {
    return unsupported('Time mode command is too short.')
  }
  control.setTimeMode(payload[0] ?? 0)
  return { accepted: true }
}

function setTime(payload: Uint8Array, control: AtemProtocolControl): CommandHandlingResult {
  if (payload.byteLength < 6) {
    return unsupported('Time command is too short.')
  }
  control.setTime({
    hours: payload[0] ?? 0,
    minutes: payload[1] ?? 0,
    seconds: payload[2] ?? 0,
    frames: payload[3] ?? 0,
    dropFrame: (payload[5] ?? 0) === 1,
  })
  return { accepted: true }
}

function setDisplayClockState(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 2) {
    return unsupported('Display clock state command is too short.')
  }
  control.setDisplayClockState(payload[1] ?? 0)
  return { accepted: true }
}

function setDisplayClockProperties(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 25) {
    return unsupported('Display clock properties command is too short.')
  }
  const mask = readUInt16(payload, 0)
  const properties: {
    enabled?: boolean
    size?: number
    opacity?: number
    positionX?: number
    positionY?: number
    autoHide?: boolean
    startFrom?: { hours: number; minutes: number; seconds: number; frames: number }
    startFromFrames?: number
    clockMode?: number
  } = {}
  if ((mask & (1 << 0)) !== 0) properties.enabled = (payload[3] ?? 0) > 0
  if ((mask & (1 << 1)) !== 0) properties.size = payload[5] ?? 0
  if ((mask & (1 << 2)) !== 0) properties.opacity = payload[7] ?? 0
  if ((mask & (1 << 3)) !== 0) properties.positionX = readInt16(payload, 8)
  if ((mask & (1 << 4)) !== 0) properties.positionY = readInt16(payload, 10)
  if ((mask & (1 << 5)) !== 0) properties.autoHide = (payload[12] ?? 0) > 0
  if ((mask & (1 << 6)) !== 0) {
    properties.startFrom = {
      hours: payload[13] ?? 0,
      minutes: payload[14] ?? 0,
      seconds: payload[15] ?? 0,
      frames: payload[16] ?? 0,
    }
  }
  if ((mask & (1 << 7)) !== 0) properties.startFromFrames = readUInt32(payload, 20)
  if ((mask & (1 << 8)) !== 0) properties.clockMode = payload[24] ?? 0
  control.setDisplayClockProperties(properties)
  return { accepted: true }
}

function setMultiviewerProperties(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 4) {
    return unsupported('Multiviewer properties command is too short.')
  }
  control.setMultiviewerProperties(payload[2] ?? 0, (payload[3] ?? 0) > 0)
  return { accepted: true }
}

function setMultiviewerSource(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 4) {
    return unsupported('Multiviewer source command is too short.')
  }
  control.setMultiviewerWindowSource(payload[1] ?? 0, readUInt16(payload, 2), true, true)
  return { accepted: true }
}

function setClassicAudioMaster(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 7) {
    return unsupported('Classic audio master command is too short.')
  }
  const mask = payload[0] ?? 0
  const master: { gain?: number; balance?: number; followFadeToBlack?: boolean } = {}
  if ((mask & (1 << 0)) !== 0) master.gain = readUInt16(payload, 2)
  if ((mask & (1 << 1)) !== 0) master.balance = readInt16(payload, 4)
  if ((mask & (1 << 2)) !== 0) master.followFadeToBlack = (payload[6] ?? 0) > 0
  control.setClassicAudioMaster(master)
  return { accepted: true }
}

function setFairlightMaster(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 17) {
    return unsupported('Fairlight master command is too short.')
  }
  const mask = payload[0] ?? 0
  const master: {
    equalizerEnabled?: boolean
    equalizerGain?: number
    makeUpGain?: number
    faderGain?: number
    followFadeToBlack?: boolean
  } = {}
  if ((mask & (1 << 0)) !== 0) master.equalizerEnabled = (payload[1] ?? 0) > 0
  if ((mask & (1 << 1)) !== 0) master.equalizerGain = readInt32(payload, 4)
  if ((mask & (1 << 2)) !== 0) master.makeUpGain = readInt32(payload, 8)
  if ((mask & (1 << 3)) !== 0) master.faderGain = readInt32(payload, 12)
  if ((mask & (1 << 4)) !== 0) master.followFadeToBlack = (payload[16] ?? 0) > 0
  control.setFairlightMaster(master)
  return { accepted: true }
}

function setFairlightSource(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 45) return unsupported('Fairlight source command is too short.')
  const mask = readUInt16(payload, 0)
  if ((mask & ~0x180) !== 0 || (mask & 0x180) === 0)
    return unsupported('Unsupported Fairlight source properties.')
  const sourceId = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    .getBigInt64(8)
    .toString()
  const properties: { mixOption?: 1 | 2 | 4; faderGain?: number } = {}
  if ((mask & 0x80) !== 0) properties.faderGain = readInt32(payload, 40)
  if ((mask & 0x100) !== 0) {
    const option = payload[44]
    if (option !== 1 && option !== 2 && option !== 4)
      return unsupported('Invalid Fairlight mix option.')
    properties.mixOption = option
  }
  control.setFairlightSource(readUInt16(payload, 2), sourceId, properties)
  return { accepted: true }
}

function setCameraControl(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 16) {
    return unsupported('Camera control command is too short.')
  }
  const source = payload[0] ?? 0
  const category = payload[1] ?? 0
  const parameter = payload[2] ?? 0
  const type = payload[4] ?? 0
  const count8Bit = readUInt16(payload, 6)
  const count16Bit = readUInt16(payload, 8)
  const count32Bit = readUInt16(payload, 10)
  const count64Bit = readUInt16(payload, 12)

  const boolData: boolean[] = []
  const numberData: number[] = []
  const bigintData: bigint[] = []
  let stringData = ''
  let offset = 16

  if (type === 0 || type === 1) {
    for (let index = 0; index < count8Bit && offset < payload.byteLength; index += 1) {
      const value = payload[offset] ?? 0
      if (type === 0) {
        boolData.push(value > 0)
      } else {
        numberData.push((value << 24) >> 24)
      }
      offset += 1
    }
  } else if (type === 2 || type === 128) {
    for (let index = 0; index < count16Bit && offset + 1 < payload.byteLength; index += 1) {
      const value = readInt16(payload, offset)
      numberData.push(type === 128 ? value / 2048 : value)
      offset += 2
    }
  } else if (type === 3) {
    for (let index = 0; index < count32Bit && offset + 3 < payload.byteLength; index += 1) {
      numberData.push(readInt32(payload, offset))
      offset += 4
    }
  } else if (type === 4) {
    for (let index = 0; index < count64Bit && offset + 7 < payload.byteLength; index += 1) {
      const value =
        (BigInt(payload[offset] ?? 0) << 56n) |
        (BigInt(payload[offset + 1] ?? 0) << 48n) |
        (BigInt(payload[offset + 2] ?? 0) << 40n) |
        (BigInt(payload[offset + 3] ?? 0) << 32n) |
        (BigInt(payload[offset + 4] ?? 0) << 24n) |
        (BigInt(payload[offset + 5] ?? 0) << 16n) |
        (BigInt(payload[offset + 6] ?? 0) << 8n) |
        BigInt(payload[offset + 7] ?? 0)
      bigintData.push(value)
      offset += 8
    }
  } else if (type === 5) {
    stringData = readNullTerminatedAscii(payload, 16, payload.byteLength - 16)
  }

  control.setCameraControl({
    source,
    category,
    parameter,
    type,
    boolData,
    numberData,
    bigintData,
    stringData,
  })
  return { accepted: true }
}

function setFadeToBlackRate(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 3 || payload[1] !== 0) {
    return unsupported('Only M/E 1 fade to black is available.')
  }
  const rate = payload[2]!
  control.setFadeToBlackRate(rate)
  return { accepted: true }
}

function applyMacroAction(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 3) {
    return unsupported('Macro action command is too short.')
  }
  const index = readUInt16(payload, 0)
  const action = payload[2]!
  switch (action) {
    case 0:
      control.macroRun(index)
      return { accepted: true }
    case 1:
      control.macroStop()
      return { accepted: true }
    case 2:
      control.macroStopRecord()
      return { accepted: true }
    case 3:
      control.macroInsertUserWait()
      return { accepted: true }
    case 4:
      control.macroContinue()
      return { accepted: true }
    case 5:
      control.macroDelete(index)
      return { accepted: true }
    default:
      return unsupported('The requested macro action is not available in ATEM Sandbox v1.')
  }
}

function updateMacroProperties(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 8) return unsupported('Macro properties command is too short.')
  const mask = payload[0]!
  const nameLength = readUInt16(payload, 4)
  const descriptionLength = readUInt16(payload, 6)
  if (8 + nameLength + descriptionLength > payload.byteLength)
    return unsupported('Macro properties command has invalid text lengths.')
  const decoder = new TextDecoder()
  control.macroUpdateProperties(readUInt16(payload, 2), {
    ...((mask & 1) !== 0 ? { name: decoder.decode(payload.subarray(8, 8 + nameLength)) } : {}),
    ...((mask & 2) !== 0
      ? {
          description: decoder.decode(
            payload.subarray(8 + nameLength, 8 + nameLength + descriptionLength),
          ),
        }
      : {}),
  })
  return { accepted: true }
}

function startMacroRecording(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 6) return unsupported('Macro record command is too short.')
  const index = readUInt16(payload, 0)
  const nameLength = readUInt16(payload, 2)
  const descriptionLength = readUInt16(payload, 4)
  if (6 + nameLength + descriptionLength > payload.byteLength) {
    return unsupported('Macro record command has invalid text lengths.')
  }
  const decoder = new TextDecoder()
  const name = decoder.decode(payload.subarray(6, 6 + nameLength))
  const description = decoder.decode(
    payload.subarray(6 + nameLength, 6 + nameLength + descriptionLength),
  )
  control.macroStartRecord(index, name, description)
  return { accepted: true }
}

function setMacroRunStatus(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 2) {
    return unsupported('Macro run-status command is too short.')
  }
  const mask = payload[0] ?? 0
  if ((mask & (1 << 0)) !== 0) {
    control.setMacroLoop((payload[1] ?? 0) !== 0)
  }
  return { accepted: true }
}

function setSuperSourceProperties(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength >= 16) {
    const mask = payload[0] ?? 0
    const ssrcId = payload[1] ?? 0
    const props: Record<string, unknown> = {}

    if ((mask & (1 << 0)) !== 0) props.artFillSource = readUInt16(payload, 2)
    if ((mask & (1 << 1)) !== 0) props.artCutSource = readUInt16(payload, 4)
    if ((mask & (1 << 2)) !== 0) props.artOption = payload[6]
    if ((mask & (1 << 3)) !== 0) props.artPreMultiplied = payload[7] === 1
    if ((mask & (1 << 4)) !== 0) props.artClip = readUInt16(payload, 8)
    if ((mask & (1 << 5)) !== 0) props.artGain = readUInt16(payload, 10)
    if ((mask & (1 << 6)) !== 0) props.artInvertKey = payload[12] === 1

    control.setSuperSourceProperties(ssrcId, props)
    return { accepted: true }
  }

  if (payload.byteLength < 13) {
    return unsupported('SuperSource properties command is too short.')
  }
  const props: Record<string, unknown> = {
    artFillSource: readUInt16(payload, 2),
    artCutSource: readUInt16(payload, 4),
    artOption: payload[6],
    artPreMultiplied: payload[7] === 1,
    artClip: readUInt16(payload, 8),
    artGain: readUInt16(payload, 10),
    artInvertKey: payload[12] === 1,
  }
  control.setSuperSourceProperties(0, props)
  return { accepted: true }
}

function setSuperSourceBorder(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 24) {
    return unsupported('SuperSource border command is too short.')
  }
  const mask = readUInt16(payload, 0)
  const ssrcId = payload[2] ?? 0
  const props: Record<string, unknown> = {}
  if ((mask & (1 << 0)) !== 0) props.borderEnabled = payload[3] === 1
  if ((mask & (1 << 1)) !== 0) props.borderBevel = payload[4]
  if ((mask & (1 << 2)) !== 0) props.borderOuterWidth = readUInt16(payload, 6)
  if ((mask & (1 << 3)) !== 0) props.borderInnerWidth = readUInt16(payload, 8)
  if ((mask & (1 << 4)) !== 0) props.borderOuterSoftness = payload[10]
  if ((mask & (1 << 5)) !== 0) props.borderInnerSoftness = payload[11]
  if ((mask & (1 << 6)) !== 0) props.borderBevelSoftness = payload[12]
  if ((mask & (1 << 7)) !== 0) props.borderBevelPosition = payload[13]
  if ((mask & (1 << 8)) !== 0) props.borderHue = readUInt16(payload, 14)
  if ((mask & (1 << 9)) !== 0) props.borderSaturation = readUInt16(payload, 16)
  if ((mask & (1 << 10)) !== 0) props.borderLuma = readUInt16(payload, 18)
  if ((mask & (1 << 11)) !== 0) props.borderLightSourceDirection = readUInt16(payload, 20)
  if ((mask & (1 << 12)) !== 0) props.borderLightSourceAltitude = payload[22]
  control.setSuperSourceBorder(ssrcId, props)
  return { accepted: true }
}

function setSuperSourceBox(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 24) {
    return unsupported('SuperSource box command is too short.')
  }
  const mask = readUInt16(payload, 0)
  const ssrcId = payload[2] ?? 0
  const boxId = payload[3] ?? 0
  const props: Record<string, unknown> = {}
  if ((mask & (1 << 0)) !== 0) props.enabled = payload[4] === 1
  if ((mask & (1 << 1)) !== 0) props.source = readUInt16(payload, 6)
  if ((mask & (1 << 2)) !== 0) props.x = readInt16(payload, 8)
  if ((mask & (1 << 3)) !== 0) props.y = readInt16(payload, 10)
  if ((mask & (1 << 4)) !== 0) props.size = readUInt16(payload, 12)
  if ((mask & (1 << 5)) !== 0) props.cropped = payload[14] === 1
  if ((mask & (1 << 6)) !== 0) props.cropTop = readUInt16(payload, 16)
  if ((mask & (1 << 7)) !== 0) props.cropBottom = readUInt16(payload, 18)
  if ((mask & (1 << 8)) !== 0) props.cropLeft = readUInt16(payload, 20)
  if ((mask & (1 << 9)) !== 0) props.cropRight = readUInt16(payload, 22)
  control.setSuperSourceBox(ssrcId, boxId, props)
  return { accepted: true }
}

function setSource(payload: Uint8Array, apply: (source: SourceRef) => void): CommandHandlingResult {
  if (payload.byteLength < 4 || payload[0] !== 0) {
    return unsupported('Only M/E 1 is available.')
  }
  const source = atemIdToSourceRef(readUInt16(payload, 2))
  if (source === undefined) {
    return unsupported('The requested source is not available in ATEM Sandbox v1.')
  }
  apply(source)
  return { accepted: true }
}

function setAuxSource(payload: Uint8Array, control: AtemProtocolControl): CommandHandlingResult {
  if (payload.byteLength < 4 || payload[0] !== 0x01) {
    return unsupported('Aux source command is malformed.')
  }
  const bus = payload[1]! + 1
  const source = atemIdToSourceRef(readUInt16(payload, 2))
  if (bus < 1 || bus > 4 || source === undefined) {
    return unsupported('The requested aux bus or source is not available in ATEM Sandbox v1.')
  }
  control.setAuxSource(bus as 1 | 2 | 3 | 4, source)
  return { accepted: true }
}

function runMixEffectAction(payload: Uint8Array, action: () => void): CommandHandlingResult {
  if (payload.byteLength < 1 || payload[0] !== 0) {
    return unsupported('Only M/E 1 is available.')
  }
  action()
  return { accepted: true }
}

function setTransitionProperties(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 4 || payload[1] !== 0) {
    return unsupported('Only M/E 1 is available.')
  }
  if ((payload[0]! & 1) === 0) {
    return { accepted: true }
  }
  const style = transitionTypeForWireValue(payload[2]!)
  if (style === undefined) {
    return unsupported('The requested transition style is not available in ATEM Sandbox v1.')
  }
  control.setTransitionType(style)
  return { accepted: true }
}

function setTransitionRate(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 2 || payload[0] !== 0) {
    return unsupported('Only M/E 1 is available.')
  }
  const rate = payload[1]!
  if (rate < 1) {
    return unsupported('Transition rate must be at least one frame.')
  }
  control.setTransitionRate(rate)
  return { accepted: true }
}

function setMediaPlayerSource(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 5) {
    return unsupported('Media-player source command is too short.')
  }
  const flags = payload[0]!
  const player = payload[1]! + 1
  const sourceType = payload[2]!
  const stillIndex = payload[3]!
  if (player !== 1 && player !== 2) {
    return unsupported('The requested media player is not available in ATEM Sandbox v1.')
  }
  if ((flags & 0x03) !== 0x03 || sourceType !== 1) {
    return unsupported('Only still-media player sources are available in ATEM Sandbox v1.')
  }
  control.selectMediaPlayerStill(player as MediaPlayerId, stillIndex + 1)
  return { accepted: true }
}

function setUpstreamKeyOnAir(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 3 || payload[0] !== 0) {
    return unsupported('Only M/E 1 is available.')
  }
  const upstreamKeyerId = payload[1]! + 1
  const onAir = payload[2] === 1
  if (upstreamKeyerId < 1 || upstreamKeyerId > 4) {
    return unsupported('The requested upstream keyer is not available in ATEM Sandbox v1.')
  }
  control.setUpstreamKey(upstreamKeyerId as 1 | 2 | 3 | 4, onAir)
  return { accepted: true }
}

function setUpstreamKeyLuma(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 9 || payload[1] !== 0 || payload[2]! > 3) {
    return unsupported('The requested upstream keyer is not available.')
  }
  const mask = payload[0]!
  const properties: { preMultiplied?: boolean; clip?: number; gain?: number; invert?: boolean } = {}
  if (mask & 1) properties.preMultiplied = payload[3] === 1
  if (mask & 2) properties.clip = readUInt16(payload, 4)
  if (mask & 4) properties.gain = readUInt16(payload, 6)
  if (mask & 8) properties.invert = payload[8] === 1
  control.setUpstreamKeyLuma((payload[2]! + 1) as 1 | 2 | 3 | 4, properties)
  return { accepted: true }
}

function setUpstreamKeyType(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 4 || payload[1] !== 0) {
    return unsupported('Only M/E 1 is available.')
  }
  const upstreamKeyerId = payload[2]! + 1
  const mixEffectKeyType = payload[3]!
  if (upstreamKeyerId < 1 || upstreamKeyerId > 4 || mixEffectKeyType > 3) {
    return unsupported(
      'The requested upstream keyer configuration is not available in ATEM Sandbox v1.',
    )
  }
  control.setUpstreamKeyType(upstreamKeyerId as 1 | 2 | 3 | 4, mixEffectKeyType as 0 | 1 | 2 | 3)
  return { accepted: true }
}

function setUpstreamKeyFillSource(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 4 || payload[0] !== 0) {
    return unsupported('Only M/E 1 is available.')
  }
  const upstreamKeyerId = payload[1]! + 1
  const fillSource = readUInt16(payload, 2)
  if (upstreamKeyerId < 1 || upstreamKeyerId > 4) {
    return unsupported('The requested upstream keyer is not available in ATEM Sandbox v1.')
  }
  control.setUpstreamKeyFillSource(upstreamKeyerId as 1 | 2 | 3 | 4, fillSource)
  return { accepted: true }
}

function setUpstreamKeyCutSource(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 4 || payload[0] !== 0) {
    return unsupported('Only M/E 1 is available.')
  }
  const upstreamKeyerId = payload[1]! + 1
  const cutSource = readUInt16(payload, 2)
  if (upstreamKeyerId < 1 || upstreamKeyerId > 4) {
    return unsupported('The requested upstream keyer is not available in ATEM Sandbox v1.')
  }
  control.setUpstreamKeyCutSource(upstreamKeyerId as 1 | 2 | 3 | 4, cutSource)
  return { accepted: true }
}

function setDownstreamKeyOnAir(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 2) {
    return unsupported('Downstream-key on-air command is too short.')
  }
  const downstreamKeyerId = payload[0]! + 1
  const onAir = payload[1] === 1
  if (downstreamKeyerId < 1 || downstreamKeyerId > 2) {
    return unsupported('The requested downstream keyer is not available in ATEM Sandbox v1.')
  }
  control.setDownstreamKey(downstreamKeyerId as 1 | 2, onAir)
  return { accepted: true }
}

function setDownstreamKeyTie(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 2) {
    return unsupported('Downstream-key tie command is too short.')
  }
  const downstreamKeyerId = payload[0]! + 1
  const tie = payload[1] === 1
  if (downstreamKeyerId < 1 || downstreamKeyerId > 2) {
    return unsupported('The requested downstream keyer is not available in ATEM Sandbox v1.')
  }
  control.setDownstreamKeyTie(downstreamKeyerId as 1 | 2, tie)
  return { accepted: true }
}

function setDownstreamKeyRate(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 2) {
    return unsupported('Downstream-key rate command is too short.')
  }
  const downstreamKeyerId = payload[0]! + 1
  const rate = payload[1]!
  if (downstreamKeyerId < 1 || downstreamKeyerId > 2) {
    return unsupported('The requested downstream keyer is not available in ATEM Sandbox v1.')
  }
  control.setDownstreamKeyRate(downstreamKeyerId as 1 | 2, rate)
  return { accepted: true }
}

function autoDownstreamKey(
  payload: Uint8Array,
  control: AtemProtocolControl,
): CommandHandlingResult {
  if (payload.byteLength < 1) {
    return unsupported('Downstream-key auto command is too short.')
  }
  const rawKeyerId = payload.byteLength >= 2 ? payload[1]! : payload[0]!
  const downstreamKeyerId = rawKeyerId + 1
  const isTowardsOnAir = payload.byteLength >= 3 ? payload[2] === 1 : undefined
  if (downstreamKeyerId < 1 || downstreamKeyerId > 2) {
    return unsupported('The requested downstream keyer is not available in ATEM Sandbox v1.')
  }
  control.autoDownstreamKey(downstreamKeyerId as 1 | 2, isTowardsOnAir)
  return { accepted: true }
}

function transitionTypeForWireValue(value: number): TransitionType | undefined {
  switch (value) {
    case 0:
      return 'mix'
    case 1:
      return 'dip'
    case 2:
      return 'wipe'
    default:
      return undefined
  }
}

function readUInt16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!
}

function readInt16(bytes: Uint8Array, offset: number): number {
  const value = readUInt16(bytes, offset)
  return value > 0x7fff ? value - 0x10000 : value
}

function readUInt32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  )
}

function readInt32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  )
}

function readNullTerminatedAscii(bytes: Uint8Array, offset: number, length: number): string {
  const end = Math.min(bytes.byteLength, offset + length)
  const chars: number[] = []
  for (let index = offset; index < end; index += 1) {
    const code = bytes[index] ?? 0
    if (code === 0) {
      break
    }
    chars.push(code)
  }
  return String.fromCharCode(...chars)
}

function unsupported(reason: string): CommandHandlingResult {
  return { accepted: false, reason }
}
