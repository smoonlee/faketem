import { describe, expect, it } from 'vitest'
import { AtemStateStore } from '@atem-sandbox/atem-state'
import { createDefaultConfig, getAtemDeviceProfile, mediaPlayerSource } from '@atem-sandbox/shared'
import {
  ATEM_SANDBOX_PROTOCOL_VERSION,
  createInitialStateRecords,
  createStateChangeRecords,
} from '../src/index.js'

describe('ATEM state projection', () => {
  it('creates a padded, ordered initial profile snapshot', () => {
    const config = createDefaultConfig()
    const store = new AtemStateStore(config)
    const records = createInitialStateRecords(store.getState(), {
      name: config.device.name,
      profileId: config.device.modelId,
      videoMode: config.device.videoMode,
    })

    const commands = records.map((record) => record.command)
    expect(commands.slice(0, 6)).toEqual(['_ver', '_pin', '_top', '_MeC', '_MvC', '_AMC'])
    expect(commands).toContain('_FAC')
    expect(record(records, '_MAC').payload[0]).toBe(100)
    expect(records.filter((candidate) => candidate.command === 'MPrp')).toHaveLength(100)
    expect(commands).toContain('MPSp')
    expect(commands).toContain('TCCc')
    expect(commands).toContain('DCPV')
    expect(commands).toContain('DSTV')
    expect(commands).toContain('AMMO')
    expect(commands).toContain('FAMP')
    expect(commands).toContain('CCdP')
    expect(commands).toContain('TlSr')
    expect(commands).toContain('MvPr')
    expect(records.filter((candidate) => candidate.command === 'MvIn')).toHaveLength(10)
    expect(record(records, '_ver').payload).toEqual(uint32(ATEM_SANDBOX_PROTOCOL_VERSION))
    expect(record(records, '_pin').payload).toHaveLength(44)
    expect(record(records, '_top').payload).toHaveLength(28)
    expect(record(records, '_MeC').payload).toHaveLength(4)
    expect(record(records, '_MvC').payload).toHaveLength(2)
    expect(record(records, '_AMC').payload).toHaveLength(4)
    expect(record(records, '_FAC').payload).toHaveLength(4)
    expect(record(records, 'PrvI').payload).toHaveLength(8)
    expect(record(records, 'TrSS').payload).toHaveLength(8)
    expect(record(records, 'FtbP').payload).toHaveLength(2)
    expect(record(records, 'FtbS').payload).toHaveLength(4)
    expect(record(records, 'RMSu').payload).toHaveLength(140)
    expect(record(records, 'RTMS').payload).toHaveLength(8)
    expect(record(records, 'RTMR').payload).toHaveLength(5)
    expect(record(records, 'ISOi').payload).toHaveLength(4)
    expect(record(records, 'SRSU').payload).toHaveLength(1096)
    expect(record(records, 'StRS').payload).toHaveLength(2)
    expect(record(records, 'SRST').payload).toHaveLength(5)
    expect(record(records, 'SRSS').payload).toHaveLength(6)
    expect(record(records, 'STAB').payload).toHaveLength(8)
    expect(record(records, 'MPSp').payload).toHaveLength(10)
    expect(record(records, 'TCCc').payload).toHaveLength(1)
    expect(record(records, 'DCPV').payload).toHaveLength(17)
    expect(record(records, 'DSTV').payload).toHaveLength(5)
    expect(record(records, 'AMMO').payload).toHaveLength(5)
    expect(record(records, 'FAMP').payload).toHaveLength(20)
    expect(record(records, 'CCdP').payload).toHaveLength(24)
    expect(record(records, 'TlSr').payload.length).toBeGreaterThan(2)
    expect(records.filter((candidate) => candidate.command === 'RTMD')).toHaveLength(2)
    expect(record(records, 'SSrc').payload).toHaveLength(13)
    expect(record(records, 'SSBd').payload).toHaveLength(21)
    expect(records.filter((candidate) => candidate.command === 'SSBP')).toHaveLength(4)
    expect(records.at(-1)).toEqual({ command: 'InCm', payload: Uint8Array.of(1, 0, 0, 0) })
    store.dispose()
  })

  it('projects each selectable Mini identity with its supported camera count', () => {
    const expectedModels = [
      ['atem-mini-extreme-iso-g2', 33, 8, 2, 2, 4, 4],
      ['atem-mini-extreme-iso', 17, 8, 2, 2, 4, 2],
      ['atem-mini-pro-iso', 15, 4, 1, 1, 1, 1],
      ['atem-mini-pro', 14, 4, 1, 1, 1, 1],
    ] as const

    for (const [
      profileId,
      protocolModel,
      inputCount,
      mediaPlayers,
      downstreamKeyers,
      upstreamKeyers,
      auxiliaries,
    ] of expectedModels) {
      const config = createDefaultConfig(profileId)
      const store = new AtemStateStore(config)
      const records = createInitialStateRecords(store.getState(), {
        name: config.device.name,
        profileId,
        videoMode: config.device.videoMode,
      })

      expect(record(records, '_pin').payload[40]).toBe(protocolModel)
      expect(record(records, '_top').payload.slice(0, 7)).toEqual(
        Uint8Array.of(1, inputCount, downstreamKeyers, auxiliaries, 0, mediaPlayers, 1),
      )
      expect(record(records, '_MeC').payload[1]).toBe(upstreamKeyers)
      expect(records.filter((candidate) => candidate.command === 'InPr')).toHaveLength(
        inputCount +
          mediaPlayers +
          (getAtemDeviceProfile(profileId).effects.superSource > 0 ? 1 : 0),
      )
      expect(record(records, 'InPr').payload.slice(28, 32)).toEqual(Uint8Array.of(0, 2, 0, 2))
      expect(config.inputs.map((input) => [input.longName, input.shortName])).toEqual(
        Array.from({ length: inputCount }, (_, index) => [
          `Camera ${index + 1}`,
          `CAM${index + 1}`,
        ]),
      )
      store.dispose()
    }
  })

  it('emits only the necessary program feedback', () => {
    const config = createDefaultConfig()
    const store = new AtemStateStore(config)
    let change: Parameters<typeof createStateChangeRecords>[0] | undefined
    const unsubscribe = store.subscribe((nextChange) => {
      change = nextChange
    })

    store.setProgram({ kind: 'input', inputId: 3 }, 'api')

    expect(change).toBeDefined()
    expect(
      createStateChangeRecords(change!, {
        name: config.device.name,
        profileId: config.device.modelId,
        videoMode: config.device.videoMode,
      }).map((record) => record.command),
    ).toEqual(['PrgI', 'TlSr'])
    unsubscribe()
    store.dispose()
  })

  it('publishes a complete snapshot when a sandbox profile is imported', () => {
    const config = createDefaultConfig()
    const replacement = createDefaultConfig()
    replacement.inputs[0] = {
      ...replacement.inputs[0]!,
      longName: 'Imported Camera',
      shortName: 'IMP1',
    }
    replacement.initialState = { program: 2, preview: 1 }
    const store = new AtemStateStore(config)
    let change: Parameters<typeof createStateChangeRecords>[0] | undefined
    const unsubscribe = store.subscribe((nextChange) => {
      change = nextChange
    })

    store.replaceConfiguration(replacement, 'api')

    expect(change?.action).toEqual({ type: 'load-config', origin: 'api' })
    const device = {
      name: replacement.device.name,
      profileId: replacement.device.modelId,
      videoMode: replacement.device.videoMode,
    }
    expect(createStateChangeRecords(change!, device)).toEqual(
      createInitialStateRecords(store.getState(), device),
    )
    unsubscribe()
    store.dispose()
  })

  it('announces editable Media Player labels in snapshots and change deltas', () => {
    const config = createDefaultConfig()
    const store = new AtemStateStore(config)
    store.updateMediaPlayerName(1, 'Lyrics', 'api')
    const device = {
      name: config.device.name,
      profileId: config.device.modelId,
      videoMode: config.device.videoMode,
    }

    const snapshotMediaInputs = createInitialStateRecords(store.getState(), device).filter(
      (candidate) =>
        candidate.command === 'InPr' &&
        [3010, 3020].includes((candidate.payload[0]! << 8) | candidate.payload[1]!),
    )
    expect(readAscii(snapshotMediaInputs[0]!.payload, 2, 20)).toBe('Lyrics')
    expect(readAscii(snapshotMediaInputs[1]!.payload, 2, 20)).toBe('Media Player 2')
    expect(readAscii(snapshotMediaInputs[0]!.payload, 22, 4)).toBe('MP1')

    let change: Parameters<typeof createStateChangeRecords>[0] | undefined
    const unsubscribe = store.subscribe((nextChange) => {
      change = nextChange
    })
    store.updateMediaPlayerName(2, 'Walk-in', 'api')

    expect(change).toBeDefined()
    const delta = createStateChangeRecords(change!, device)
    expect(delta.map((candidate) => candidate.command)).toEqual(['InPr', 'InPr'])
    expect(readAscii(delta[0]!.payload, 2, 20)).toBe('Lyrics')
    expect(readAscii(delta[1]!.payload, 2, 20)).toBe('Walk-in')

    unsubscribe()
    store.dispose()
  })

  it('announces only one media player for Mini Pro identities', () => {
    const config = createDefaultConfig('atem-mini-pro')
    const store = new AtemStateStore(config)
    const device = {
      name: config.device.name,
      profileId: config.device.modelId,
      videoMode: config.device.videoMode,
    }

    const records = createInitialStateRecords(store.getState(), device)
    const mediaInputs = records.filter((candidate) => candidate.command === 'InPr').slice(-1)
    expect(mediaInputs).toHaveLength(1)
    expect(readAscii(mediaInputs[0]!.payload, 22, 4)).toBe('MP1')
    expect(records.filter((candidate) => candidate.command === 'MPCE')).toHaveLength(1)
    expect(records.filter((candidate) => candidate.command === 'KeOn')).toHaveLength(1)
    expect(records.filter((candidate) => candidate.command === 'DskS')).toHaveLength(1)

    store.dispose()
  })

  it('projects keyer state changes into protocol feedback records', () => {
    const config = createDefaultConfig('atem-mini-extreme-iso')
    const store = new AtemStateStore(config)
    let change: Parameters<typeof createStateChangeRecords>[0] | undefined
    const unsubscribe = store.subscribe((nextChange) => {
      change = nextChange
    })

    store.setUpstreamKey(1, true, 'api')
    const device = {
      name: config.device.name,
      profileId: config.device.modelId,
      videoMode: config.device.videoMode,
    }
    expect(createStateChangeRecords(change!, device).map((record) => record.command)).toEqual([
      'KeOn',
      'KeOn',
      'KeOn',
      'KeOn',
    ])

    store.setDownstreamKey(2, true, 'api')
    expect(createStateChangeRecords(change!, device).map((record) => record.command)).toEqual([
      'DskS',
      'DskS',
    ])

    unsubscribe()
    store.dispose()
  })

  it('projects recording and streaming status changes into protocol feedback records', () => {
    const config = createDefaultConfig('atem-mini-extreme-iso')
    const store = new AtemStateStore(config)
    let change: Parameters<typeof createStateChangeRecords>[0] | undefined
    const unsubscribe = store.subscribe((nextChange) => {
      change = nextChange
    })
    const device = {
      name: config.device.name,
      profileId: config.device.modelId,
      videoMode: config.device.videoMode,
    }

    store.setRecordingStatus(true, 'api')
    expect(createStateChangeRecords(change!, device).map((record) => record.command)).toEqual([
      'RTMS',
      'RTMR',
      'RTMD',
      'RTMD',
    ])

    store.setStreamingStatus(true, 'api')
    expect(createStateChangeRecords(change!, device).map((record) => record.command)).toEqual([
      'StRS',
      'SRST',
      'SRSS',
    ])

    store.setRecordingIso(true, 'api')
    expect(createStateChangeRecords(change!, device).map((record) => record.command)).toEqual([
      'ISOi',
    ])

    store.setStreamingAudioBitrates(96_000, 160_000, 'api')
    expect(createStateChangeRecords(change!, device).map((record) => record.command)).toEqual([
      'STAB',
    ])

    unsubscribe()
    store.dispose()
  })

  it('projects fade-to-black and macro runtime changes into protocol feedback records', () => {
    const config = createDefaultConfig('atem-mini-extreme-iso')
    const store = new AtemStateStore(config)
    let change: Parameters<typeof createStateChangeRecords>[0] | undefined
    const unsubscribe = store.subscribe((nextChange) => {
      change = nextChange
    })
    const device = {
      name: config.device.name,
      profileId: config.device.modelId,
      videoMode: config.device.videoMode,
    }

    store.setFadeToBlackRate(20, 'api')
    expect(createStateChangeRecords(change!, device).map((record) => record.command)).toEqual([
      'FtbP',
    ])

    store.fadeToBlack('api')
    expect(createStateChangeRecords(change!, device).map((record) => record.command)).toEqual([
      'FtbS',
    ])

    store.macroStartRecord(7, 'Test', '', 'api')
    store.macroInsertUserWait('api')
    store.macroStopRecord('api')
    store.macroRun(7, 'api')
    expect(createStateChangeRecords(change!, device).map((record) => record.command)).toEqual([
      'MRPr',
    ])

    store.macroInsertUserWait('api')
    expect(createStateChangeRecords(change!, device).map((record) => record.command)).toEqual([
      'MRPr',
    ])

    store.setMacroLoop(true, 'api')
    expect(createStateChangeRecords(change!, device).map((record) => record.command)).toEqual([
      'MRPr',
    ])

    unsubscribe()
    store.dispose()
  })

  it('projects SuperSource changes into protocol feedback records', () => {
    const config = createDefaultConfig('atem-mini-extreme-iso')
    const store = new AtemStateStore(config)
    let change: Parameters<typeof createStateChangeRecords>[0] | undefined
    const unsubscribe = store.subscribe((nextChange) => {
      change = nextChange
    })
    const device = {
      name: config.device.name,
      profileId: config.device.modelId,
      videoMode: config.device.videoMode,
    }

    store.setSuperSourceProperties(0, { artFillSource: 7 }, 'api')
    expect(createStateChangeRecords(change!, device).map((record) => record.command)).toEqual([
      'SSrc',
    ])

    store.setSuperSourceBorder(0, { borderEnabled: true }, 'api')
    expect(createStateChangeRecords(change!, device).map((record) => record.command)).toEqual([
      'SSBd',
    ])

    store.setSuperSourceBox(0, 0, { enabled: true, source: 2 }, 'api')
    expect(createStateChangeRecords(change!, device).map((record) => record.command)).toEqual([
      'SSBP',
      'SSBP',
      'SSBP',
      'SSBP',
    ])

    unsubscribe()
    store.dispose()
  })

  it('projects upstream key property changes into KeBP feedback records', () => {
    const config = createDefaultConfig('atem-mini-extreme-iso')
    const store = new AtemStateStore(config)
    let change: Parameters<typeof createStateChangeRecords>[0] | undefined
    const unsubscribe = store.subscribe((nextChange) => {
      change = nextChange
    })

    store.setUpstreamKeyType(1, 2, 'api')
    const device = {
      name: config.device.name,
      profileId: config.device.modelId,
      videoMode: config.device.videoMode,
    }
    expect(createStateChangeRecords(change!, device).map((record) => record.command)).toEqual([
      'KeBP',
      'KeBP',
      'KeBP',
      'KeBP',
    ])

    unsubscribe()
    store.dispose()
  })

  it('projects auxiliary routing changes into AuxS feedback records', () => {
    const config = createDefaultConfig('atem-mini-extreme-iso')
    const store = new AtemStateStore(config)
    let change: Parameters<typeof createStateChangeRecords>[0] | undefined
    const unsubscribe = store.subscribe((nextChange) => {
      change = nextChange
    })

    store.setAuxSource(2, mediaPlayerSource(1), 'api')
    const device = {
      name: config.device.name,
      profileId: config.device.modelId,
      videoMode: config.device.videoMode,
    }
    expect(createStateChangeRecords(change!, device).map((record) => record.command)).toEqual([
      'AuxS',
      'AuxS',
    ])

    unsubscribe()
    store.dispose()
  })

  it('maps documented hardware effect capabilities into the supported profiles', () => {
    expect(getAtemDeviceProfile('atem-mini-extreme-iso-g2').effects).toMatchObject({
      advancedChromaKeyers: 4,
      linearLumaKeyers: 4,
      dves: 2,
      colorGenerators: 2,
      superSource: 1,
      transitionKeyer: 'dve-only',
    })

    expect(getAtemDeviceProfile('atem-mini-extreme-iso').effects).toEqual({
      advancedChromaKeyers: 4,
      linearLumaKeyers: 4,
      dves: 2,
      patternGenerators: 5,
      colorGenerators: 2,
      superSource: 1,
      transitionKeyer: 'dve-only',
      totalLayers: 9,
    })

    expect(getAtemDeviceProfile('atem-mini-pro-iso').effects).toEqual({
      advancedChromaKeyers: 1,
      linearLumaKeyers: 2,
      dves: 1,
      patternGenerators: 1,
      colorGenerators: 2,
      superSource: 0,
      transitionKeyer: 'dve-only',
      totalLayers: 5,
    })

    expect(getAtemDeviceProfile('atem-mini-pro').effects).toEqual({
      advancedChromaKeyers: 1,
      linearLumaKeyers: 2,
      dves: 1,
      patternGenerators: 1,
      colorGenerators: 2,
      superSource: 0,
      transitionKeyer: 'dve-only',
      totalLayers: 5,
    })
  })
})

function record(
  records: ReturnType<typeof createInitialStateRecords>,
  command: string,
): (typeof records)[number] {
  const found = records.find((candidate) => candidate.command === command)
  if (found === undefined) {
    throw new Error(`Missing ${command}.`)
  }
  return found
}

function uint32(value: number): Uint8Array {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  )
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length)).replace(/\0+$/, '')
}
