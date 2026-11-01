import { Atem } from 'atem-connection'
import { createSocket, type Socket } from 'node:dgram'
import { afterEach, describe, expect, it } from 'vitest'
import { AtemStateStore } from '@atem-sandbox/atem-state'
import {
  createDefaultConfig,
  type AtemDeviceProfileId,
  type MediaPlayerId,
  type SourceRef,
  type TransitionType,
} from '@atem-sandbox/shared'
import {
  AtemProtocolServer,
  AtemPacketFlag,
  decodeAtemPacket,
  encodeAtemCommandRecord,
  encodeAtemPacket,
  hasAtemPacketFlag,
  type AtemProtocolControl,
  type AtemProtocolLogger,
} from '../src/index.js'

const logger: AtemProtocolLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

interface StartedSandbox {
  store: AtemStateStore
  server: AtemProtocolServer
  client: Atem
}

const sandboxes: StartedSandbox[] = []
const rawClients: Socket[] = []

afterEach(async () => {
  await Promise.all(
    sandboxes.splice(0).map(async ({ client, server, store }) => {
      await client.destroy().catch(() => undefined)
      await server.stop()
      store.dispose()
    }),
  )
  await Promise.all(rawClients.splice(0).map(closeSocket))
})

describe('AtemProtocolServer', () => {
  it('records and plays routing actions over the ATEM protocol', async () => {
    const sandbox = await startSandbox()
    const connected = onceEvent(sandbox.client, 'connected')
    await sandbox.client.connect('127.0.0.1', sandbox.server.getPort())
    await connected
    expect(sandbox.client.state?.info.macroPool?.macroCount).toBe(100)
    await sandbox.client.macroStartRecord(1, 'Routing', 'Test macro')
    await waitFor(() => sandbox.client.state?.macro.macroRecorder.isRecording === true)
    await sandbox.client.changePreviewInput(3)
    await waitFor(() => hasInput(sandbox.store.getState().preview, 3))
    await sandbox.client.macroInsertTimedWait(2)
    await waitFor(
      () =>
        sandbox.store
          .getState()
          .macro.macros[1]?.operations.some((operation) => operation.type === 'pause') === true,
    )
    await sandbox.client.cut()
    await waitFor(() => hasInput(sandbox.store.getState().program, 3))
    await sandbox.client.macroStopRecord()
    await waitFor(() => sandbox.client.state?.macro.macroRecorder.isRecording === false)
    expect(sandbox.client.state?.macro.macroProperties[1]).toMatchObject({
      isUsed: true,
      name: 'Routing',
    })
    await sandbox.client.changeProgramInput(1)
    await waitFor(() => hasInput(sandbox.store.getState().program, 1))
    await sandbox.client.macroRun(1)
    await waitFor(() => hasInput(sandbox.store.getState().program, 3))
    await waitFor(() => sandbox.client.state?.macro.macroPlayer.isRunning === false)
    await sandbox.client.macroUpdateProperties({ name: 'Updated' }, 1)
    await waitFor(() => sandbox.client.state?.macro.macroProperties[1]?.name === 'Updated')
    await sandbox.client.macroDelete(1)
    await waitFor(() => sandbox.client.state?.macro.macroProperties[1]?.isUsed === false)
  })

  it('connects the pinned atem-connection client and routes its controls to shared state', async () => {
    const sandbox = await startSandbox()
    const connected = onceEvent(sandbox.client, 'connected')
    await sandbox.client.connect('127.0.0.1', sandbox.server.getPort())
    await connected

    const initialClientState = sandbox.client.state
    expect(initialClientState?.info.model).toBe(17)
    expect(initialClientState?.video.mixEffects[0]?.programInput).toBe(1)
    expect(initialClientState?.video.mixEffects[0]?.previewInput).toBe(2)
    expect(sandbox.server.getClientCount()).toBe(1)
    expect(initialClientState?.inputs[6000]?.longName).toBe('SuperSource')
    await sandbox.client.setUpstreamKeyerLumaSettings({ clip: 250, invert: true }, 0, 0)
    await waitFor(() => sandbox.store.getState().upstreamKeyLuma[1]?.clip === 250)
    await waitFor(
      () =>
        sandbox.client.state?.video.mixEffects[0]?.upstreamKeyers[0]?.lumaSettings?.invert === true,
    )
    await sandbox.client.setUpstreamKeyerLumaSettings({ gain: 600 }, 0, 0)
    await waitFor(
      () =>
        sandbox.client.state?.video.mixEffects[0]?.upstreamKeyers[0]?.lumaSettings?.gain === 600,
    )
    expect(
      sandbox.client.state?.video.mixEffects[0]?.upstreamKeyers[0]?.lumaSettings,
    ).toMatchObject({ clip: 250, invert: true })

    expect(
      initialClientState?.fairlight?.inputs[1301]?.sources['-65280']?.properties,
    ).toMatchObject({
      mixOption: 1,
      faderGain: 0,
    })
    await sandbox.client.setFairlightAudioMixerSourceProps(1301, '-65280', {
      mixOption: 2,
      faderGain: -1200,
    })
    await waitFor(() => sandbox.store.getState().fairlightAudio.inputs[1301]?.faderGain === -1200)
    await waitFor(
      () =>
        sandbox.client.state?.fairlight?.inputs[1301]?.sources['-65280']?.properties?.mixOption ===
        2,
    )
    sandbox.store.setFairlightSource(1302, '-65280', { mixOption: 4, faderGain: -300 }, 'ui')
    await waitFor(
      () =>
        sandbox.client.state?.fairlight?.inputs[1302]?.sources['-65280']?.properties?.faderGain ===
        -300,
    )

    await sandbox.client.changePreviewInput(6000)
    await waitFor(() => sandbox.store.getState().preview.kind === 'super-source')
    await waitFor(() => sandbox.client.state?.video.mixEffects[0]?.previewInput === 6000)

    await sandbox.client.changePreviewInput(4)
    await waitFor(() => hasInput(sandbox.store.getState().preview, 4))

    await sandbox.client.changeProgramInput(3)
    await waitFor(() => hasInput(sandbox.store.getState().program, 3))

    await sandbox.client.cut()
    await waitFor(
      () =>
        hasInput(sandbox.store.getState().program, 4) &&
        hasInput(sandbox.store.getState().preview, 3),
    )

    await sandbox.client.setMixTransitionSettings({ rate: 12 })
    await waitFor(() => sandbox.store.getState().transition.rateFrames === 12)

    await sandbox.client.setTransitionStyle({ nextStyle: 1 })
    await waitFor(() => sandbox.store.getState().transition.type === 'dip')

    await sandbox.client.autoTransition()
    await waitFor(
      () =>
        !sandbox.store.getState().transition.inTransition &&
        hasInput(sandbox.store.getState().program, 3) &&
        hasInput(sandbox.store.getState().preview, 4),
    )

    await sandbox.client.setMediaPlayerSource({ sourceType: 1, stillIndex: 1 }, 0)
    await waitFor(() => sandbox.store.getState().mediaPlayers[1].slot === 2)

    await sandbox.client.startRecording()
    await waitFor(() => sandbox.store.getState().recording.status.state !== 0)
    await waitFor(() => sandbox.client.state?.recording?.status?.state !== undefined)

    await sandbox.client.stopRecording()
    await waitFor(() => sandbox.store.getState().recording.status.state === 0)

    await sandbox.client.startStreaming()
    await waitFor(() => sandbox.store.getState().streaming.status.state !== 1)
    await waitFor(() => sandbox.client.state?.streaming?.status?.state !== undefined)

    await sandbox.client.setStreamingService({
      serviceName: 'Sandbox Test',
      url: 'rtmp://sandbox.local/live',
      key: 'stream-key',
      bitrates: [2_000_000, 3_000_000],
    })
    await waitFor(() => sandbox.store.getState().streaming.service.serviceName === 'Sandbox Test')

    await sandbox.client.setStreamingAudioBitrates(96_000, 160_000)
    await waitFor(() => sandbox.store.getState().streaming.audioBitrates?.lowBitrate === 96_000)

    await sandbox.client.stopStreaming()
    await waitFor(() => sandbox.store.getState().streaming.status.state === 1)

    const originalDiskId = sandbox.store.getState().recording.properties.workingSet1DiskId
    await sandbox.client.switchRecordingDisk()
    await waitFor(
      () => sandbox.store.getState().recording.properties.workingSet1DiskId !== originalDiskId,
    )

    await sandbox.client.setFadeToBlackRate(18)
    await waitFor(() => sandbox.store.getState().fadeToBlack.rate === 18)

    await sandbox.client.fadeToBlack()
    await waitFor(() => sandbox.store.getState().fadeToBlack.isFullyBlack === true)

    sandbox.store.macroStartRecord(3, 'Test', '', 'api')
    sandbox.store.macroInsertUserWait('api')
    sandbox.store.macroStopRecord('api')
    await sandbox.client.macroRun(3)
    await waitFor(() => sandbox.store.getState().macro.macroPlayer.isRunning === true)
    expect(sandbox.store.getState().macro.macroPlayer.macroIndex).toBe(3)
    await waitFor(
      () =>
        sandbox.client.state?.macro.macroPlayer.isRunning === true &&
        sandbox.client.state.macro.macroPlayer.macroIndex === 3,
    )

    await sandbox.client.macroInsertUserWait()
    await waitFor(() => sandbox.store.getState().macro.macroPlayer.isWaiting === true)
    await waitFor(() => sandbox.client.state?.macro.macroPlayer.isWaiting === true)

    await sandbox.client.macroSetLoop(true)
    await waitFor(() => sandbox.store.getState().macro.macroPlayer.loop === true)
    await waitFor(() => sandbox.client.state?.macro.macroPlayer.loop === true)

    await sandbox.client.macroContinue()
    await waitFor(() => sandbox.store.getState().macro.macroPlayer.isWaiting === false)
    await waitFor(() => sandbox.client.state?.macro.macroPlayer.isWaiting === false)

    await sandbox.client.macroStop()
    await waitFor(() => sandbox.store.getState().macro.macroPlayer.isRunning === false)
    await waitFor(() => sandbox.client.state?.macro.macroPlayer.isRunning === false)

    await sandbox.client.setSuperSourceProperties({ artFillSource: 3 }, 0)
    await waitFor(() => sandbox.store.getState().superSources[0]?.properties?.artFillSource === 3)

    await sandbox.client.setSuperSourceBorder({ borderEnabled: true }, 0)
    await waitFor(() => sandbox.store.getState().superSources[0]?.border?.borderEnabled === true)

    await sandbox.client.setSuperSourceBoxSettings({ enabled: true, source: 2 }, 0, 0)
    await waitFor(() => sandbox.store.getState().superSources[0]?.boxes[0]?.enabled === true)

    await sandbox.client.setSuperSourceBoxSettings({ x: 120 }, 0, 0)
    await waitFor(() => sandbox.store.getState().superSources[0]?.boxes[0]?.x === 120)
    expect(sandbox.store.getState().superSources[0]?.boxes[0]?.source).toBe(2)
  })

  it('does not acknowledge or apply a reordered control packet before its predecessor', async () => {
    const sandbox = await startSandbox()
    const rawClient = createSocket('udp4')
    const received: Buffer[] = []
    rawClient.on('message', (message) => received.push(message))
    rawClients.push(rawClient)
    const port = sandbox.server.getPort()
    if (port === undefined) {
      throw new Error('ATEM UDP server did not bind a port.')
    }

    await sendUdp(
      rawClient,
      encodeAtemPacket(
        { flags: AtemPacketFlag.NewSession, sessionId: 0x53ab },
        Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 0),
      ),
      port,
    )
    const handshake = await takePacket(received, (packet) =>
      hasAtemPacketFlag(packet.header.flags, AtemPacketFlag.NewSession),
    )
    const sessionId = handshake.header.sessionId
    await sendUdp(
      rawClient,
      encodeAtemPacket({
        flags: AtemPacketFlag.AckReply,
        sessionId,
        acknowledgementNumber: 0,
      }),
      port,
    )
    const snapshot = await takePacket(received, (packet) =>
      hasAtemPacketFlag(packet.header.flags, AtemPacketFlag.AckRequest),
    )
    await sendUdp(
      rawClient,
      encodeAtemPacket({
        flags: AtemPacketFlag.AckReply,
        sessionId,
        acknowledgementNumber: snapshot.header.packetSequence,
      }),
      port,
    )

    const previewCommand = encodeAtemCommandRecord({
      command: 'CPvI',
      payload: Uint8Array.of(0, 0, 0, 4),
    })
    await sendUdp(
      rawClient,
      encodeAtemPacket(
        {
          flags: AtemPacketFlag.AckRequest,
          sessionId,
          packetSequence: 2,
        },
        previewCommand,
      ),
      port,
    )

    const retransmitRequest = await takePacket(received, (packet) =>
      hasAtemPacketFlag(packet.header.flags, AtemPacketFlag.RetransmitRequest),
    )
    expect(retransmitRequest.header.retransmitFrom).toBe(1)
    expect(hasInput(sandbox.store.getState().preview, 2)).toBe(true)

    const programCommand = encodeAtemCommandRecord({
      command: 'CPgI',
      payload: Uint8Array.of(0, 0, 0, 3),
    })
    await sendUdp(
      rawClient,
      encodeAtemPacket(
        {
          flags: AtemPacketFlag.AckRequest,
          sessionId,
          packetSequence: 1,
        },
        programCommand,
      ),
      port,
    )
    const firstAck = await takePacket(
      received,
      (packet) =>
        hasAtemPacketFlag(packet.header.flags, AtemPacketFlag.AckReply) &&
        packet.header.acknowledgementNumber === 1,
    )
    expect(firstAck.header.acknowledgementNumber).toBe(1)
    await waitFor(() => hasInput(sandbox.store.getState().program, 3))

    await sendUdp(
      rawClient,
      encodeAtemPacket(
        {
          flags: AtemPacketFlag.AckRequest,
          sessionId,
          packetSequence: 2,
        },
        previewCommand,
      ),
      port,
    )
    const secondAck = await takePacket(
      received,
      (packet) =>
        hasAtemPacketFlag(packet.header.flags, AtemPacketFlag.AckReply) &&
        packet.header.acknowledgementNumber === 2,
    )
    expect(secondAck.header.acknowledgementNumber).toBe(2)
    await waitFor(() => hasInput(sandbox.store.getState().preview, 4))
  })

  it('advertises the selected identity profile to a real ATEM client', async () => {
    const sandbox = await startSandbox('atem-mini-extreme-iso-g2')
    const connected = onceEvent(sandbox.client, 'connected')
    await sandbox.client.connect('127.0.0.1', sandbox.server.getPort())
    await connected

    expect(sandbox.client.state?.info.model).toBe(33)
    expect(sandbox.client.state?.info.capabilities?.superSources).toBe(1)
    expect(
      sandbox.client.state?.fairlight?.inputs[1001]?.sources['-65280']?.properties?.mixOption,
    ).toBe(1)
    expect(sandbox.client.state?.fairlight?.inputs[1301]).toBeUndefined()
    await sandbox.client.setFairlightAudioMixerSourceProps(1001, '-65280', {
      mixOption: 4,
      faderGain: -600,
    })
    await waitFor(() => sandbox.store.getState().fairlightAudio.inputs[1001]?.faderGain === -600)
    await waitFor(
      () =>
        sandbox.client.state?.fairlight?.inputs[1001]?.sources['-65280']?.properties?.mixOption ===
        4,
    )
  })

  it('connects a four-input Mini Pro sandbox with the pinned ATEM client', async () => {
    const sandbox = await startSandbox('atem-mini-pro-iso')
    const connected = onceEvent(sandbox.client, 'connected')
    await sandbox.client.connect('127.0.0.1', sandbox.server.getPort())
    await connected

    expect(sandbox.client.state?.info.model).toBe(15)
    expect(sandbox.store.getState().inputs).toHaveLength(4)

    await sandbox.client.changePreviewInput(4)
    await waitFor(() => hasInput(sandbox.store.getState().preview, 4))
  })

  it('supports recording and streaming commands across all supported profiles', async () => {
    const profiles = [
      'atem-mini-extreme-iso-g2',
      'atem-mini-extreme-iso',
      'atem-mini-pro-iso',
      'atem-mini-pro',
    ] as const

    for (const profile of profiles) {
      const sandbox = await startSandbox(profile)
      const connected = onceEvent(sandbox.client, 'connected')
      await sandbox.client.connect('127.0.0.1', sandbox.server.getPort())
      await connected

      await sandbox.client.startRecording()
      await waitFor(() => sandbox.store.getState().recording.status.state !== 0)
      await waitFor(() => sandbox.client.state?.recording?.status?.state !== undefined)

      await sandbox.client.stopRecording()
      await waitFor(() => sandbox.store.getState().recording.status.state === 0)

      await sandbox.client.startStreaming()
      await waitFor(() => sandbox.store.getState().streaming.status.state !== 1)
      await waitFor(() => sandbox.client.state?.streaming?.status?.state !== undefined)

      await sandbox.client.stopStreaming()
      await waitFor(() => sandbox.store.getState().streaming.status.state === 1)

      await sandbox.client.destroy().catch(() => undefined)
      await sandbox.server.stop()
      sandbox.store.dispose()
      sandboxes.splice(sandboxes.indexOf(sandbox), 1)
    }
  })

  it('accepts keyer on-air commands over the ATEM protocol', async () => {
    const sandbox = await startSandbox('atem-mini-extreme-iso')
    const connected = onceEvent(sandbox.client, 'connected')
    await sandbox.client.connect('127.0.0.1', sandbox.server.getPort())
    await connected

    const rawClient = createSocket('udp4')
    const received: Buffer[] = []
    rawClient.on('message', (message) => received.push(message))
    rawClients.push(rawClient)
    const port = sandbox.server.getPort()
    if (port === undefined) {
      throw new Error('ATEM UDP server did not bind a port.')
    }

    await sendUdp(
      rawClient,
      encodeAtemPacket(
        { flags: AtemPacketFlag.NewSession, sessionId: 0x44aa },
        Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 0),
      ),
      port,
    )
    const handshake = await takePacket(received, (packet) =>
      hasAtemPacketFlag(packet.header.flags, AtemPacketFlag.NewSession),
    )
    const sessionId = handshake.header.sessionId
    await sendUdp(
      rawClient,
      encodeAtemPacket({ flags: AtemPacketFlag.AckReply, sessionId, acknowledgementNumber: 0 }),
      port,
    )
    const snapshotPacket = await takePacket(received, (packet) =>
      hasAtemPacketFlag(packet.header.flags, AtemPacketFlag.AckRequest),
    )
    await sendUdp(
      rawClient,
      encodeAtemPacket({
        flags: AtemPacketFlag.AckReply,
        sessionId,
        acknowledgementNumber: snapshotPacket.header.packetSequence,
      }),
      port,
    )

    const upstreamOnAir = encodeAtemCommandRecord({
      command: 'CKOn',
      payload: Uint8Array.of(0, 0, 1, 0),
    })
    await sendUdp(
      rawClient,
      encodeAtemPacket(
        { flags: AtemPacketFlag.AckRequest, sessionId, packetSequence: 1 },
        upstreamOnAir,
      ),
      port,
    )
    await waitFor(() => sandbox.store.getState().upstreamKeys[1] === true)

    const upstreamType = encodeAtemCommandRecord({
      command: 'CKTp',
      payload: Uint8Array.of(1, 0, 0, 2, 0, 0, 0, 0),
    })
    await sendUdp(
      rawClient,
      encodeAtemPacket(
        { flags: AtemPacketFlag.AckRequest, sessionId, packetSequence: 2 },
        upstreamType,
      ),
      port,
    )
    await waitFor(() => sandbox.store.getState().upstreamKeyProperties[1]!.mixEffectKeyType === 2)

    const upstreamFill = encodeAtemCommandRecord({
      command: 'CKeF',
      payload: Uint8Array.of(0, 0, 0x0b, 0xc2),
    })
    await sendUdp(
      rawClient,
      encodeAtemPacket(
        { flags: AtemPacketFlag.AckRequest, sessionId, packetSequence: 3 },
        upstreamFill,
      ),
      port,
    )
    await waitFor(() => sandbox.store.getState().upstreamKeyProperties[1]!.fillSource === 3010)

    const auxSource = encodeAtemCommandRecord({
      command: 'CAuS',
      payload: Uint8Array.of(0x01, 1, 0x0b, 0xc2),
    })
    await sendUdp(
      rawClient,
      encodeAtemPacket(
        { flags: AtemPacketFlag.AckRequest, sessionId, packetSequence: 4 },
        auxSource,
      ),
      port,
    )
    await waitFor(() => sandbox.store.getState().auxiliaries[2]!.kind === 'media-player')

    await sandbox.client.setDownstreamKeyOnAir(true, 1)
    await waitFor(() => sandbox.store.getState().downstreamKeys[2]!.onAir === true)

    await sandbox.client.setDownstreamKeyTie(true, 1)
    await waitFor(() => sandbox.store.getState().downstreamKeys[2]!.tie === true)

    await sandbox.client.setDownstreamKeyRate(22, 1)
    await waitFor(() => sandbox.store.getState().downstreamKeys[2]!.rate === 22)

    await sandbox.client.autoDownstreamKey(1)
    await waitFor(() => sandbox.store.getState().downstreamKeys[2]!.isAuto === true)
  })

  it('projects upstream and downstream keyer feedback into connected ATEM client state', async () => {
    const sandbox = await startSandbox('atem-mini-extreme-iso')
    const connected = onceEvent(sandbox.client, 'connected')
    await sandbox.client.connect('127.0.0.1', sandbox.server.getPort())
    await connected

    sandbox.store.setUpstreamKey(1, true, 'api')
    await waitFor(
      () => sandbox.client.state?.video.mixEffects[0]?.upstreamKeyers[0]?.onAir === true,
    )

    sandbox.store.setUpstreamKeyType(1, 2, 'api')
    await waitFor(
      () => sandbox.client.state?.video.mixEffects[0]?.upstreamKeyers[0]?.mixEffectKeyType === 2,
    )

    sandbox.store.setUpstreamKeyFillSource(1, 3010, 'api')
    await waitFor(
      () => sandbox.client.state?.video.mixEffects[0]?.upstreamKeyers[0]?.fillSource === 3010,
    )

    sandbox.store.setUpstreamKeyCutSource(1, 2, 'api')
    await waitFor(
      () => sandbox.client.state?.video.mixEffects[0]?.upstreamKeyers[0]?.cutSource === 2,
    )

    sandbox.store.setDownstreamKey(2, true, 'api')
    await waitFor(() => sandbox.client.state?.video.downstreamKeyers[1]?.onAir === true)

    sandbox.store.setDownstreamKeyTie(2, true, 'api')
    await waitFor(() => sandbox.client.state?.video.downstreamKeyers[1]?.properties?.tie === true)

    sandbox.store.setDownstreamKeyRate(2, 35, 'api')
    await waitFor(() => sandbox.client.state?.video.downstreamKeyers[1]?.properties?.rate === 35)

    sandbox.store.autoDownstreamKey(2, 'api', false)
    await waitFor(() => sandbox.client.state?.video.downstreamKeyers[1]?.isAuto === true)
  })

  it('projects SuperSource feedback into connected ATEM client state', async () => {
    const sandbox = await startSandbox('atem-mini-extreme-iso')
    const connected = onceEvent(sandbox.client, 'connected')
    await sandbox.client.connect('127.0.0.1', sandbox.server.getPort())
    await connected

    sandbox.store.setSuperSourceProperties(0, { artFillSource: 6, artOption: 1 }, 'api')
    await waitFor(
      () => sandbox.client.state?.video.superSources[0]?.properties?.artFillSource === 6,
    )
    await waitFor(() => sandbox.client.state?.video.superSources[0]?.properties?.artOption === 1)

    sandbox.store.setSuperSourceBorder(0, { borderEnabled: true, borderHue: 80 }, 'api')
    await waitFor(() => sandbox.client.state?.video.superSources[0]?.border?.borderEnabled === true)
    await waitFor(() => sandbox.client.state?.video.superSources[0]?.border?.borderHue === 80)

    sandbox.store.setSuperSourceBox(0, 0, { enabled: true, source: 3, x: -150 }, 'api')
    await waitFor(() => sandbox.client.state?.video.superSources[0]?.boxes[0]?.enabled === true)
    await waitFor(() => sandbox.client.state?.video.superSources[0]?.boxes[0]?.source === 3)
    await waitFor(() => sandbox.client.state?.video.superSources[0]?.boxes[0]?.x === -150)
  })

  it('keeps streaming idle with InvalidState when service configuration is missing', async () => {
    const sandbox = await startSandbox('atem-mini-extreme-iso')
    const connected = onceEvent(sandbox.client, 'connected')
    await sandbox.client.connect('127.0.0.1', sandbox.server.getPort())
    await connected

    sandbox.store.setStreamingService({ url: '', key: '' }, 'api')

    await sandbox.client.startStreaming()
    await waitFor(() => sandbox.store.getState().streaming.status.error === 16)
    expect(sandbox.store.getState().streaming.status.state).toBe(1)
  })
})

async function startSandbox(profileId?: AtemDeviceProfileId): Promise<StartedSandbox> {
  const config = createDefaultConfig(profileId)
  const store = new AtemStateStore(config)
  const server = new AtemProtocolServer({
    host: '127.0.0.1',
    port: 0,
    device: {
      name: config.device.name,
      profileId: config.device.modelId,
      videoMode: config.device.videoMode,
    },
    control: createControl(store),
    logger,
  })
  await server.start()
  const client = new Atem({ disableMultithreaded: true })
  const sandbox = { store, server, client }
  sandboxes.push(sandbox)
  return sandbox
}

function createControl(store: AtemStateStore): AtemProtocolControl {
  return {
    getState: () => store.getState(),
    subscribe: (listener) => store.subscribe(listener),
    setRecordingStatus: (recording: boolean) => {
      store.setRecordingStatus(recording, 'atem-protocol')
    },
    setRecordingIso: (recordAllInputs: boolean) => {
      store.setRecordingIso(recordAllInputs, 'atem-protocol')
    },
    switchRecordingDisk: () => {
      store.switchRecordingDisk('atem-protocol')
    },
    setStreamingStatus: (streaming: boolean) => {
      store.setStreamingStatus(streaming, 'atem-protocol')
    },
    setStreamingService: (service) => {
      store.setStreamingService(service, 'atem-protocol')
    },
    setStreamingAudioBitrates: (lowBitrate: number, highBitrate: number) => {
      store.setStreamingAudioBitrates(lowBitrate, highBitrate, 'atem-protocol')
    },
    setVideoModeCode: (mode: number) => {
      store.setVideoModeCode(mode, 'atem-protocol')
    },
    setMediaPoolSettings: (maxFrames: [number, number, number, number]) => {
      store.setMediaPoolSettings(
        maxFrames,
        store.getState().settings.mediaPool.unassignedFrames,
        'atem-protocol',
      )
    },
    saveStartupState: () => {
      store.saveStartupState('atem-protocol')
    },
    clearStartupState: () => {
      store.clearStartupState('atem-protocol')
    },
    setTimeMode: (mode: number) => {
      store.setTimeMode(mode, 'atem-protocol')
    },
    setTime: (time) => {
      store.setTime(time, 'atem-protocol')
    },
    setDisplayClockState: (state: number) => {
      store.setDisplayClockState(state, 'atem-protocol')
    },
    setDisplayClockProperties: (properties) => {
      store.setDisplayClockProperties(properties as never, 'atem-protocol')
    },
    setMultiviewerProperties: (layout: number, programPreviewSwapped: boolean) => {
      store.setMultiviewerProperties(layout, programPreviewSwapped, 'atem-protocol')
    },
    setMultiviewerWindowSource: (
      windowIndex: number,
      source: number,
      supportsVuMeter: boolean,
      supportsSafeArea: boolean,
    ) => {
      store.setMultiviewerWindowSource(
        windowIndex,
        source,
        supportsVuMeter,
        supportsSafeArea,
        'atem-protocol',
      )
    },
    setClassicAudioMaster: (master) => {
      store.setClassicAudioMaster(master as never, 'atem-protocol')
    },
    setFairlightMaster: (master) => {
      store.setFairlightMaster(master as never, 'atem-protocol')
    },
    setFairlightSource: (id, sourceId, properties) => {
      store.setFairlightSource(id, sourceId, properties, 'atem-protocol')
    },
    setCameraControl: (control) => {
      store.setCameraControl(control as never, 'atem-protocol')
    },
    setFadeToBlackRate: (rate: number) => {
      store.setFadeToBlackRate(rate, 'atem-protocol')
    },
    fadeToBlack: () => {
      store.fadeToBlack('atem-protocol')
    },
    macroRun: (index: number) => {
      store.macroRun(index, 'atem-protocol')
    },
    macroStop: () => {
      store.macroStop('atem-protocol')
    },
    macroStartRecord: (index, name, description) => {
      store.macroStartRecord(index, name, description, 'atem-protocol')
    },
    macroStopRecord: () => {
      store.macroStopRecord('atem-protocol')
    },
    macroDelete: (index) => {
      store.macroDelete(index, 'atem-protocol')
    },
    macroUpdateProperties: (index, properties) => {
      store.macroUpdateProperties(index, properties, 'atem-protocol')
    },
    macroAddPause: (frames) => {
      store.macroAddPause(frames, 'atem-protocol')
    },
    macroContinue: () => {
      store.macroContinue('atem-protocol')
    },
    macroInsertUserWait: () => {
      store.macroInsertUserWait('atem-protocol')
    },
    setMacroLoop: (loop: boolean) => {
      store.setMacroLoop(loop, 'atem-protocol')
    },
    setSuperSourceProperties: (ssrcId: number, props: Record<string, unknown>) => {
      store.setSuperSourceProperties(ssrcId, props as never, 'atem-protocol')
    },
    setSuperSourceBorder: (ssrcId: number, props: Record<string, unknown>) => {
      store.setSuperSourceBorder(ssrcId, props as never, 'atem-protocol')
    },
    setSuperSourceBox: (ssrcId: number, boxId: number, props: Record<string, unknown>) => {
      store.setSuperSourceBox(ssrcId, boxId, props as never, 'atem-protocol')
    },
    setProgram: (source: SourceRef) => {
      store.setProgram(source, 'atem-protocol')
    },
    setPreview: (source: SourceRef) => {
      store.setPreview(source, 'atem-protocol')
    },
    setAuxSource: (bus, source) => {
      store.setAuxSource(bus, source, 'atem-protocol')
    },
    cut: () => {
      store.cut('atem-protocol')
    },
    startAuto: () => {
      void store.auto('atem-protocol')
    },
    setTransitionType: (type: TransitionType) => {
      store.setTransitionType(type, 'atem-protocol')
    },
    setTransitionRate: (rateFrames: number) => {
      store.setTransitionRate(rateFrames, 'atem-protocol')
    },
    selectMediaPlayerStill: (player: MediaPlayerId, slot: number) => {
      store.selectMediaPlayerStill(player, slot, 'atem-protocol')
    },
    setUpstreamKey: (index, enabled) => {
      store.setUpstreamKey(index, enabled, 'atem-protocol')
    },
    setUpstreamKeyLuma: (index, properties) => {
      store.setUpstreamKeyLuma(index, properties, 'atem-protocol')
    },
    setUpstreamKeyType: (index, mixEffectKeyType) => {
      store.setUpstreamKeyType(index, mixEffectKeyType, 'atem-protocol')
    },
    setUpstreamKeyFillSource: (index, fillSource) => {
      store.setUpstreamKeyFillSource(index, fillSource, 'atem-protocol')
    },
    setUpstreamKeyCutSource: (index, cutSource) => {
      store.setUpstreamKeyCutSource(index, cutSource, 'atem-protocol')
    },
    setDownstreamKey: (index, enabled) => {
      store.setDownstreamKey(index, enabled, 'atem-protocol')
    },
    setDownstreamKeyTie: (index, enabled) => {
      store.setDownstreamKeyTie(index, enabled, 'atem-protocol')
    },
    setDownstreamKeyRate: (index, rate) => {
      store.setDownstreamKeyRate(index, rate, 'atem-protocol')
    },
    autoDownstreamKey: (index, isTowardsOnAir) => {
      store.autoDownstreamKey(index, 'atem-protocol', isTowardsOnAir)
    },
  }
}

function onceEvent(client: Atem, event: 'connected'): Promise<void> {
  return new Promise((resolve) => client.once(event, resolve))
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for the expected shared state.')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function hasInput(source: SourceRef, inputId: number): boolean {
  return source.kind === 'input' && source.inputId === inputId
}

async function sendUdp(socket: Socket, packet: Uint8Array, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.send(packet, port, '127.0.0.1', (error) => {
      if (error === null) {
        resolve()
      } else {
        reject(error)
      }
    })
  })
}

async function takePacket(
  received: Buffer[],
  predicate: (packet: ReturnType<typeof decodeAtemPacket>) => boolean,
): Promise<ReturnType<typeof decodeAtemPacket>> {
  await waitFor(() => received.some((message) => predicate(decodeAtemPacket(message))))
  const index = received.findIndex((message) => predicate(decodeAtemPacket(message)))
  if (index === -1) {
    throw new Error('Expected UDP packet was not received.')
  }
  return decodeAtemPacket(received.splice(index, 1)[0]!)
}

async function closeSocket(socket: Socket): Promise<void> {
  await new Promise<void>((resolve) => socket.close(() => resolve()))
}
