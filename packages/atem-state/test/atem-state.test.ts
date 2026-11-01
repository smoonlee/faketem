import { describe, expect, it } from 'vitest'
import {
  createDefaultConfig,
  frameDurationMs,
  inputSource,
  mediaPlayerSource,
} from '@atem-sandbox/shared'
import {
  availableSources,
  AtemStateError,
  AtemStateStore,
  resolveSourceSurface,
  type TransitionScheduler,
} from '../src/index.js'

class ManualScheduler implements TransitionScheduler {
  private currentTime = 0
  private nextId = 1
  private readonly tasks = new Map<number, { dueAt: number; callback: () => void }>()

  public now(): number {
    return this.currentTime
  }

  public setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++
    this.tasks.set(id, { dueAt: this.currentTime + delayMs, callback })
    return id
  }

  public clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number)
  }

  public advanceBy(durationMs: number): void {
    const target = this.currentTime + durationMs
    while (true) {
      const nextTask = [...this.tasks.entries()]
        .filter(([, task]) => task.dueAt <= target)
        .sort(([, left], [, right]) => left.dueAt - right.dueAt)[0]

      if (nextTask === undefined) {
        break
      }

      const [id, task] = nextTask
      this.tasks.delete(id)
      this.currentTime = task.dueAt
      task.callback()
    }
    this.currentTime = target
  }
}

function createStore(): { store: AtemStateStore; scheduler: ManualScheduler } {
  const scheduler = new ManualScheduler()
  return { store: new AtemStateStore(createDefaultConfig(), scheduler), scheduler }
}

describe('AtemStateStore', () => {
  it('tracks microphone mix and fader settings independently', () => {
    const { store } = createStore()
    const microphones = Object.values(store.getState().fairlightAudio.inputs)
    expect(microphones).toHaveLength(2)

    const first = microphones[0]!
    const second = microphones[1]!
    store.setFairlightSource(first.id, first.sourceId, { mixOption: 2, faderGain: -1200 }, 'ui')

    const updated = store.getState().fairlightAudio.inputs
    expect(updated[first.id]).toMatchObject({ mixOption: 2, faderGain: -1200 })
    expect(updated[second.id]).toMatchObject({ mixOption: 1, faderGain: 0 })
  })

  it('routes SuperSource only on models that support it', () => {
    const { store } = createStore()
    store.setPreview({ kind: 'super-source' }, 'ui')
    expect(store.getState().preview).toEqual({ kind: 'super-source' })
    const pro = new AtemStateStore(createDefaultConfig('atem-mini-pro'))
    expect(() => pro.setPreview({ kind: 'super-source' }, 'ui')).toThrow(AtemStateError)
    pro.dispose()
  })

  it('sets Preview without changing Program', () => {
    const { store } = createStore()

    store.setPreview(inputSource(4), 'ui')

    expect(store.getState().program).toEqual(inputSource(1))
    expect(store.getState().preview).toEqual(inputSource(4))
  })

  it('CUT immediately swaps Program and Preview', () => {
    const { store } = createStore()
    store.setPreview(inputSource(4))

    store.cut('ui')

    expect(store.getState().program).toEqual(inputSource(4))
    expect(store.getState().preview).toEqual(inputSource(1))
  })

  it('AUTO publishes transition progress and swaps only after its configured duration', async () => {
    const { store, scheduler } = createStore()
    store.setPreview(inputSource(4))

    const completion = store.auto('ui')
    expect(store.getState().transition.inTransition).toBe(true)
    expect(store.getState().transition.position).toBe(0)

    scheduler.advanceBy(256)
    expect(store.getState().transition.position).toBeGreaterThan(0.49)
    expect(store.getState().program).toEqual(inputSource(1))

    scheduler.advanceBy(244)
    await completion

    expect(store.getState().transition.inTransition).toBe(false)
    expect(store.getState().program).toEqual(inputSource(4))
    expect(store.getState().preview).toEqual(inputSource(1))
  })

  it('preserves the previous source workflow across consecutive AUTO operations', async () => {
    const { store, scheduler } = createStore()

    store.setProgram(inputSource(2), 'atem-protocol')
    store.setPreview(inputSource(3), 'atem-protocol')
    store.setPreview(mediaPlayerSource(1), 'atem-protocol')
    const firstAuto = store.auto('atem-protocol')
    scheduler.advanceBy(500)
    await firstAuto

    expect(store.getState().program).toEqual(mediaPlayerSource(1))
    expect(store.getState().preview).toEqual(inputSource(2))

    const secondAuto = store.auto('atem-protocol')
    scheduler.advanceBy(500)
    await secondAuto

    expect(store.getState().program).toEqual(inputSource(2))
    expect(store.getState().preview).toEqual(mediaPlayerSource(1))
  })

  it('updates a Media Player still and resolves an active Program monitor immediately', () => {
    const { store } = createStore()
    store.setProgram(mediaPlayerSource(1))
    store.updateMediaPlayerName(1, 'Lyrics', 'api')

    store.selectMediaPlayerStill(1, 2, 'atem-protocol')

    const state = store.getState()
    const surface = resolveSourceSurface(state, mediaPlayerSource(1))
    const slot2 = state.mediaPool.stills.find((still) => still.slot === 2)
    expect(store.getState().mediaPlayers[1]).toMatchObject({ name: 'Lyrics', slot: 2 })
    expect(surface.title).toBe('Lyrics')
    expect(surface.subtitle).toBe(`Slot 2: ${slot2?.name ?? 'Unknown'}`)
    expect(surface.text).toBe(slot2?.type === 'generated' ? slot2.text : slot2?.name)
  })

  it('creates only the supported Camera inputs for a Mini Pro sandbox', () => {
    const config = createDefaultConfig('atem-mini-pro')
    const store = new AtemStateStore(config)

    expect(config.inputs.map((input) => [input.longName, input.shortName])).toEqual([
      ['Camera 1', 'CAM1'],
      ['Camera 2', 'CAM2'],
      ['Camera 3', 'CAM3'],
      ['Camera 4', 'CAM4'],
    ])
    expect(config.mediaPool.stills.map((still) => still.slot)).toEqual([1])
    expect(availableSources(store.getState(), 1)).toEqual([
      inputSource(1),
      inputSource(2),
      inputSource(3),
      inputSource(4),
      mediaPlayerSource(1),
    ])
    expect(() => store.setPreview(inputSource(5))).toThrow('Input 5 is not available')
    store.dispose()
  })

  it('creates two default Media Pool items for two-player models', () => {
    const config = createDefaultConfig('atem-mini-extreme-iso')
    const store = new AtemStateStore(config)

    expect(config.mediaPool.stills.map((still) => still.slot)).toEqual([1, 2])

    store.dispose()
  })

  it('matches available input sources for each supported sandbox model', () => {
    const expectedModels = [
      ['atem-mini-extreme-iso-g2', 8, 2],
      ['atem-mini-extreme-iso', 8, 2],
      ['atem-mini-pro-iso', 4, 1],
      ['atem-mini-pro', 4, 1],
    ] as const

    for (const [profileId, inputCount, mediaPlayerCount] of expectedModels) {
      const config = createDefaultConfig(profileId)
      const store = new AtemStateStore(config)

      expect(config.inputs).toHaveLength(inputCount)
      expect(config.inputs.map((input) => input.id)).toEqual(
        Array.from({ length: inputCount }, (_, index) => index + 1),
      )
      expect(availableSources(store.getState(), mediaPlayerCount)).toHaveLength(
        inputCount + mediaPlayerCount + store.getState().superSources.length,
      )
      expect(() => store.setPreview(inputSource((inputCount + 1) as 5), 'ui')).toThrow(
        `Input ${inputCount + 1} is not available`,
      )

      store.dispose()
    }
  })

  it('rejects Media Player 2 operations on one-player Mini Pro models', () => {
    const store = new AtemStateStore(createDefaultConfig('atem-mini-pro'))

    expect(() => store.setPreview(mediaPlayerSource(2), 'ui')).toThrow(
      'Media Player 2 is not available',
    )
    expect(() => store.selectMediaPlayerStill(2, 2, 'api')).toThrow(
      'Media Player 2 is not available',
    )
    expect(() => store.updateMediaPlayerName(2, 'Walk-in', 'api')).toThrow(
      'Media Player 2 is not available',
    )

    store.dispose()
  })

  it('toggles supported upstream and downstream keyers', () => {
    const store = new AtemStateStore(createDefaultConfig('atem-mini-extreme-iso'))

    store.setUpstreamKey(1, true, 'api')
    store.setDownstreamKey(2, true, 'api')

    expect(store.getState().upstreamKeys[1]).toBe(true)
    expect(store.getState().downstreamKeys[2]!.onAir).toBe(true)

    store.dispose()
  })

  it('rejects unsupported keyer indexes on smaller models', () => {
    const store = new AtemStateStore(createDefaultConfig('atem-mini-pro'))

    expect(() => store.setUpstreamKey(2, true, 'api')).toThrow('Upstream Key 2 is not available')
    expect(() => store.setDownstreamKey(2, true, 'api')).toThrow(
      'Downstream Key 2 is not available',
    )

    store.dispose()
  })

  it('updates downstream key tie, rate, and auto state', () => {
    const store = new AtemStateStore(createDefaultConfig('atem-mini-extreme-iso'))

    store.setDownstreamKeyTie(1, true, 'api')
    store.setDownstreamKeyRate(1, 40, 'api')
    store.autoDownstreamKey(1, 'api')

    expect(store.getState().downstreamKeys[1]).toMatchObject({
      tie: true,
      rate: 40,
      onAir: true,
      isAuto: true,
    })

    store.dispose()
  })

  it('updates fade-to-black transition progress and macro runtime state', () => {
    const { store, scheduler } = createStore()
    const frameMs = frameDurationMs(createDefaultConfig().device.videoMode)

    store.setFadeToBlackRate(5, 'api')
    store.fadeToBlack('api')

    expect(store.getState().fadeToBlack).toMatchObject({
      rate: 5,
      isFullyBlack: false,
      inTransition: true,
      remainingFrames: 5,
    })

    scheduler.advanceBy(3 * frameMs)
    expect(store.getState().fadeToBlack.inTransition).toBe(true)
    expect(store.getState().fadeToBlack.remainingFrames).toBe(2)

    scheduler.advanceBy(2 * frameMs)
    expect(store.getState().fadeToBlack).toMatchObject({
      isFullyBlack: true,
      inTransition: false,
      remainingFrames: 0,
    })

    store.macroStartRecord(12, 'Test', '', 'api')
    store.macroInsertUserWait('api')
    store.macroStopRecord('api')
    store.macroRun(12, 'api')
    store.macroInsertUserWait('api')
    expect(store.getState().macro.macroPlayer).toMatchObject({
      isRunning: true,
      isWaiting: true,
      macroIndex: 12,
    })

    store.macroContinue('api')
    store.setMacroLoop(true, 'api')
    expect(store.getState().macro.macroPlayer).toMatchObject({
      isRunning: true,
      isWaiting: false,
      loop: true,
    })

    store.macroStop('api')
    expect(store.getState().macro.macroPlayer.isRunning).toBe(false)

    store.dispose()
  })

  it('records and replays routing actions with a user wait', () => {
    const { store, scheduler } = createStore()
    const frameMs = frameDurationMs(createDefaultConfig().device.videoMode)
    store.macroStartRecord(0, 'Routing', '', 'api')
    store.setPreview(inputSource(3), 'api')
    store.macroInsertUserWait('api')
    store.cut('api')
    store.macroStopRecord('api')
    store.setProgram(inputSource(1), 'api')
    store.setPreview(inputSource(2), 'api')
    store.macroRun(0, 'api')
    scheduler.advanceBy(2 * frameMs)
    expect(store.getState().preview).toEqual(inputSource(3))
    expect(store.getState().macro.macroPlayer.isWaiting).toBe(true)
    store.macroContinue('api')
    scheduler.advanceBy(2 * frameMs)
    expect(store.getState().program).toEqual(inputSource(3))
    expect(store.getState().macro.macroPlayer.isRunning).toBe(false)
    store.dispose()
  })

  it('rejects missing and unsupported macros and invalid lifecycle operations', () => {
    const { store } = createStore()
    expect(() => store.macroRun(9, 'api')).toThrow('Macro does not exist')
    expect(() => store.macroContinue('api')).toThrow('No macro is waiting')
    store.macroStartRecord(1, 'Unsupported', '', 'api')
    expect(() => store.macroRun(1, 'api')).toThrow('Stop recording')
    store.setFadeToBlackRate(10, 'api')
    store.macroStopRecord('api')
    expect(store.getState().macro.macros[1]?.hasUnsupportedOps).toBe(true)
    expect(() => store.macroRun(1, 'api')).toThrow('unsupported operations')
    store.dispose()
  })

  it('replays keyer controls and waits for an AUTO transition to finish', async () => {
    const { store, scheduler } = createStore()
    const frameMs = frameDurationMs(createDefaultConfig().device.videoMode)
    store.macroStartRecord(1, 'Transition', '', 'api')
    store.setTransitionRate(2, 'api')
    store.setPreview(inputSource(3), 'api')
    const recordedAuto = store.auto('api')
    scheduler.advanceBy(2 * frameMs)
    await recordedAuto
    store.setUpstreamKey(1, true, 'api')
    store.setUpstreamKeyLuma(1, { clip: 250, invert: true }, 'api')
    store.setDownstreamKey(1, true, 'api')
    store.macroStopRecord('api')
    store.setProgram(inputSource(1), 'api')
    store.setPreview(inputSource(2), 'api')
    store.setUpstreamKey(1, false, 'api')
    store.setUpstreamKeyLuma(1, { clip: 0, invert: false }, 'api')
    store.setDownstreamKey(1, false, 'api')
    store.macroRun(1, 'api')
    scheduler.advanceBy(5 * frameMs)
    await Promise.resolve()
    scheduler.advanceBy(4 * frameMs)
    expect(store.getState().program).toEqual(inputSource(3))
    expect(store.getState().upstreamKeys[1]).toBe(true)
    expect(store.getState().upstreamKeyLuma[1]).toMatchObject({ clip: 250, invert: true })
    expect(store.getState().downstreamKeys[1]?.onAir).toBe(true)
    expect(store.getState().macro.macroPlayer.isRunning).toBe(false)
    store.dispose()
  })

  it('honors timed pauses and stops before pending operations', () => {
    const { store, scheduler } = createStore()
    const frameMs = frameDurationMs(createDefaultConfig().device.videoMode)
    store.macroStartRecord(1, 'Pause', '', 'api')
    store.macroAddPause(5, 'api')
    store.setProgram(inputSource(3), 'api')
    store.macroStopRecord('api')
    store.setProgram(inputSource(1), 'api')
    store.macroRun(1, 'api')
    scheduler.advanceBy(5 * frameMs)
    expect(store.getState().program).toEqual(inputSource(1))
    store.macroStop('api')
    scheduler.advanceBy(10 * frameMs)
    expect(store.getState().program).toEqual(inputSource(1))
    store.macroRun(1, 'api')
    scheduler.advanceBy(7 * frameMs)
    expect(store.getState().program).toEqual(inputSource(3))
    store.dispose()
  })

  it('reports playback failures without throwing from the timer', () => {
    const { store, scheduler } = createStore()
    const frameMs = frameDurationMs(createDefaultConfig().device.videoMode)
    store.macroStartRecord(1, 'Cut', '', 'api')
    store.cut('api')
    store.macroStopRecord('api')
    void store.auto('api')
    store.macroRun(1, 'api')
    expect(() => scheduler.advanceBy(frameMs)).not.toThrow()
    expect(store.getState().macro.macroPlayer.isRunning).toBe(false)
    expect(store.getState().macro.lastError).toBeTruthy()
    store.dispose()
  })

  it('does not capture background timer updates during recording', () => {
    const { store, scheduler } = createStore()
    store.setRecordingStatus(true, 'api')
    store.setStreamingStatus(true, 'api')
    store.fadeToBlack('api')
    store.macroStartRecord(1, 'Routing', '', 'api')
    scheduler.advanceBy(1200)
    store.setProgram(inputSource(3), 'api')
    store.macroStopRecord('api')
    expect(store.getState().macro.macros[1]).toMatchObject({
      hasUnsupportedOps: false,
      operations: [{ type: 'set-program', source: inputSource(3) }],
    })
    store.dispose()
  })

  it('updates SuperSource properties, border, and boxes on supported profiles', () => {
    const store = new AtemStateStore(createDefaultConfig('atem-mini-extreme-iso'))

    store.setSuperSourceProperties(0, { artFillSource: 3, artCutSource: 4, artGain: 120 }, 'api')
    store.setSuperSourceBorder(
      0,
      { borderEnabled: true, borderHue: 90, borderOuterWidth: 250 },
      'api',
    )
    store.setSuperSourceBox(0, 0, { enabled: true, source: 2, x: 100, y: -100, size: 650 }, 'api')

    expect(store.getState().superSources[0]?.properties).toMatchObject({
      artFillSource: 3,
      artCutSource: 4,
      artGain: 120,
    })
    expect(store.getState().superSources[0]?.border).toMatchObject({
      borderEnabled: true,
      borderHue: 90,
      borderOuterWidth: 250,
    })
    expect(store.getState().superSources[0]?.boxes[0]).toMatchObject({
      enabled: true,
      source: 2,
      x: 100,
      y: -100,
      size: 650,
    })

    store.dispose()
  })

  it('toggles recording and streaming runtime state', () => {
    const { store, scheduler } = createStore()

    store.setRecordingStatus(true, 'api')
    store.setStreamingStatus(true, 'api')

    expect(store.getState().recording.status.state).not.toBe(0)
    expect(store.getState().streaming.status.state).toBe(2)

    store.setRecordingStatus(false, 'api')
    store.setStreamingStatus(false, 'api')

    expect(store.getState().streaming.status.state).toBe(32)
    scheduler.advanceBy(350)

    expect(store.getState().recording.status.state).toBe(0)
    expect(store.getState().streaming.status.state).toBe(1)

    store.dispose()
  })

  it('increments recording and streaming durations while active and resets them on stop', () => {
    const { store, scheduler } = createStore()

    store.setRecordingStatus(true, 'api')
    store.setStreamingStatus(true, 'api')
    scheduler.advanceBy(3500)

    expect(store.getState().recording.duration).toMatchObject({
      hours: 0,
      minutes: 0,
      seconds: 3,
      frames: 0,
    })
    expect(store.getState().streaming.duration).toMatchObject({
      hours: 0,
      minutes: 0,
      seconds: 3,
      frames: 0,
    })

    store.setRecordingStatus(false, 'api')
    store.setStreamingStatus(false, 'api')
    expect(store.getState().recording.duration).toMatchObject({
      hours: 0,
      minutes: 0,
      seconds: 0,
      frames: 0,
    })
    expect(store.getState().streaming.duration).toMatchObject({
      hours: 0,
      minutes: 0,
      seconds: 0,
      frames: 0,
    })
    scheduler.advanceBy(2000)

    expect(store.getState().recording.duration).toMatchObject({ seconds: 0 })
    expect(store.getState().streaming.duration).toMatchObject({ seconds: 0 })

    store.dispose()
  })

  it('updates upstream key type, fill, and cut sources', () => {
    const store = new AtemStateStore(createDefaultConfig('atem-mini-extreme-iso'))

    store.setUpstreamKeyType(1, 2, 'api')
    store.setUpstreamKeyFillSource(1, 3010, 'api')
    store.setUpstreamKeyCutSource(1, 2, 'api')

    expect(store.getState().upstreamKeyProperties[1]).toMatchObject({
      mixEffectKeyType: 2,
      fillSource: 3010,
      cutSource: 2,
    })

    store.dispose()
  })

  it('decrements recording remaining time and transitions to media-full when disk is exhausted', () => {
    const { store, scheduler } = createStore()

    const diskId = store.getState().recording.properties.workingSet1DiskId
    ;(
      store as unknown as {
        state: { recording: { disks: Record<number, { recordingTimeAvailable: number }> } }
      }
    ).state.recording.disks[diskId]!.recordingTimeAvailable = 2
    store.setRecordingStatus(true, 'api')
    scheduler.advanceBy(1000)
    expect(store.getState().recording.status.recordingTimeAvailable).toBe(1)
    expect(store.getState().recording.duration?.seconds).toBe(1)

    scheduler.advanceBy(1000)
    expect(store.getState().recording.status.state).toBe(0)
    expect(store.getState().recording.status.error).toBe(4)
    expect(store.getState().recording.duration?.seconds).toBe(0)

    store.dispose()
  })

  it('switches recording disk to the next available mounted disk', () => {
    const { store } = createStore()

    expect(store.getState().recording.properties.workingSet1DiskId).toBe(1)
    store.switchRecordingDisk('api')
    expect(store.getState().recording.properties.workingSet1DiskId).toBe(2)

    store.dispose()
  })

  it('validates streaming service before transitioning into connecting/streaming', () => {
    const { store, scheduler } = createStore()

    store.setStreamingService({ url: '', key: '' }, 'api')
    store.setStreamingStatus(true, 'api')
    expect(store.getState().streaming.status).toMatchObject({ state: 1, error: 16 })

    store.setStreamingService({ url: 'rtmp://sandbox.local/live', key: 'abc123' }, 'api')
    store.setStreamingStatus(true, 'api')
    expect(store.getState().streaming.status).toMatchObject({ state: 2, error: 0 })

    scheduler.advanceBy(500)
    expect(store.getState().streaming.status).toMatchObject({ state: 4, error: 0 })

    store.dispose()
  })

  it('tracks streaming stats while streaming and allows ISO record-all-inputs toggling', () => {
    const { store, scheduler } = createStore()

    store.setRecordingIso(false, 'api')
    expect(store.getState().recording).toMatchObject({
      recordAllInputs: false,
      properties: { recordInAllCameras: false },
    })

    store.setStreamingStatus(true, 'api')
    scheduler.advanceBy(1500)
    const firstStats = store.getState().streaming.stats
    scheduler.advanceBy(1000)
    const secondStats = store.getState().streaming.stats

    expect(firstStats).toBeDefined()
    expect(secondStats).toBeDefined()
    expect(secondStats?.cacheUsed).not.toBe(firstStats?.cacheUsed)

    store.dispose()
  })

  it('routes sources to supported auxiliary buses', () => {
    const store = new AtemStateStore(createDefaultConfig('atem-mini-extreme-iso'))

    store.setAuxSource(2, mediaPlayerSource(1), 'api')

    expect(store.getState().auxiliaries[2]).toEqual(mediaPlayerSource(1))

    store.dispose()
  })

  it('updates multiviewer, clock/time, and settings surfaces', () => {
    const { store } = createStore()

    store.setVideoModeCode(12, 'api')
    store.setMediaPoolSettings([100, 200, 300, 400], 500, 'api')
    store.saveStartupState('api')
    store.setTimeMode(1, 'api')
    store.setTime({ hours: 1, minutes: 2, seconds: 3, frames: 4, dropFrame: false }, 'api')
    store.setDisplayClockState(2, 'api')
    store.setDisplayClockProperties(
      { enabled: true, opacity: 200, positionX: 10, positionY: -10 },
      'api',
    )
    store.setMultiviewerProperties(4, true, 'api')
    store.setMultiviewerWindowSource(3, 3010, true, true, 'api')

    expect(store.getState().settings).toMatchObject({
      videoModeCode: 12,
      startupStateSaved: true,
      timeMode: 1,
      mediaPool: { maxFrames: [100, 200, 300, 400], unassignedFrames: 500 },
    })
    expect(store.getState().displayClock.properties).toMatchObject({
      enabled: true,
      opacity: 200,
      positionX: 10,
      positionY: -10,
      clockState: 2,
    })
    expect(store.getState().multiviewer.properties).toMatchObject({
      layout: 4,
      programPreviewSwapped: true,
    })
    expect(store.getState().multiviewer.windows[3]).toMatchObject({ source: 3010 })

    store.clearStartupState('api')
    expect(store.getState().settings.startupStateSaved).toBe(false)

    store.dispose()
  })

  it('updates classic audio, fairlight audio, and camera control state', () => {
    const { store } = createStore()

    store.setClassicAudioMaster({ gain: 4000, balance: -100, followFadeToBlack: true }, 'api')
    store.setFairlightMaster(
      {
        bandCount: 6,
        equalizerEnabled: true,
        equalizerGain: 100,
        makeUpGain: 200,
        faderGain: 300,
        followFadeToBlack: true,
      },
      'api',
    )
    store.setCameraControl(
      {
        source: 2,
        category: 3,
        parameter: 4,
        type: 1,
        numberData: [12, 34],
      },
      'api',
    )

    expect(store.getState().classicAudio.master).toMatchObject({
      gain: 4000,
      balance: -100,
      followFadeToBlack: true,
    })
    expect(store.getState().fairlightAudio.master).toMatchObject({
      bandCount: 6,
      equalizerEnabled: true,
      equalizerGain: 100,
      makeUpGain: 200,
      faderGain: 300,
      followFadeToBlack: true,
    })
    expect(store.getState().cameraControl).toMatchObject({
      source: 2,
      category: 3,
      parameter: 4,
      type: 1,
      numberData: [12, 34],
    })

    store.dispose()
  })

  it('rejects routing changes while AUTO is active', () => {
    const { store } = createStore()
    void store.auto()

    expect(() => store.cut()).toThrow(AtemStateError)
    expect(() => store.setPreview(inputSource(3))).toThrow('AUTO is in progress')
  })

  it('adds a generated Media Pool still and keeps slots sorted', () => {
    const { store } = createStore()

    store.upsertMediaPoolStill(
      {
        slot: 5,
        type: 'generated',
        name: 'Countdown',
        background: '#111111',
        foreground: '#EEEEEE',
        text: 'STARTING IN 05:00',
      },
      'api',
    )

    const stills = store.getState().mediaPool.stills
    expect(stills.map((still) => still.slot)).toEqual([1, 2, 5])
    expect(stills.find((still) => still.slot === 5)).toMatchObject({
      name: 'Countdown',
      text: 'STARTING IN 05:00',
    })
  })

  it('rejects adding a new still when 20 entries already exist', () => {
    const config = createDefaultConfig()
    config.mediaPool.stills = Array.from({ length: 20 }, (_, index) => ({
      slot: index === 19 ? 19 : index + 1,
      type: 'generated' as const,
      name: `Still ${index + 1}`,
      background: '#111111',
      foreground: '#FFFFFF',
      text: `TEXT ${index + 1}`,
    }))
    const store = new AtemStateStore(config)

    expect(() =>
      store.upsertMediaPoolStill(
        {
          slot: 20,
          type: 'generated',
          name: 'Overflow',
          background: '#111111',
          foreground: '#FFFFFF',
          text: 'SHOULD FAIL',
        },
        'api',
      ),
    ).toThrow('Media Pool is full')
    expect(() =>
      store.upsertMediaPoolStill(
        {
          slot: 19,
          type: 'generated',
          name: 'Replace Slot 19',
          background: '#111111',
          foreground: '#FFFFFF',
          text: 'REPLACED',
        },
        'api',
      ),
    ).not.toThrow()
  })

  it('deletes a Media Pool still that is not assigned to a player', () => {
    const { store } = createStore()

    store.upsertMediaPoolStill(
      {
        slot: 3,
        type: 'generated',
        name: 'Temporary',
        background: '#111111',
        foreground: '#FFFFFF',
        text: 'TEMP',
      },
      'api',
    )

    store.deleteMediaPoolStill(3, 'api')

    expect(store.getState().mediaPool.stills.map((still) => still.slot)).toEqual([1, 2])
  })

  it('rejects deleting a Media Pool still assigned to a Media Player', () => {
    const { store } = createStore()

    store.upsertMediaPoolStill(
      {
        slot: 3,
        type: 'generated',
        name: 'Assigned',
        background: '#111111',
        foreground: '#FFFFFF',
        text: 'ASSIGNED',
      },
      'api',
    )
    store.selectMediaPlayerStill(1, 3, 'api')

    expect(() => store.deleteMediaPoolStill(3, 'api')).toThrow('assigned to Media Player 1')
  })

  it('rejects deleting default Media Pool stills', () => {
    const { store } = createStore()

    expect(() => store.deleteMediaPoolStill(1, 'api')).toThrow(
      'Cannot delete default Media Pool items in slots 1 and 2.',
    )
    expect(() => store.deleteMediaPoolStill(2, 'api')).toThrow(
      'Cannot delete default Media Pool items in slots 1 and 2.',
    )
  })
})
