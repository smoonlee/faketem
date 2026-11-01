import type { AtemState, StateChange, UpstreamKeyLumaState } from '@atem-sandbox/atem-state'
import type { MediaPlayerId, SourceRef, TransitionType } from '@atem-sandbox/shared'

/**
 * The small control seam required by the UDP adapter. The runtime owns this
 * facade so protocol-originated persistent settings are saved in exactly the
 * same way as settings changed through the HTTP API.
 */
export interface AtemProtocolControl {
  getState(): AtemState
  subscribe(listener: (change: StateChange) => void): () => void
  setRecordingStatus(recording: boolean): void
  setRecordingIso(recordAllInputs: boolean): void
  switchRecordingDisk(): void
  setStreamingStatus(streaming: boolean): void
  setStreamingService(service: {
    serviceName?: string
    url?: string
    key?: string
    bitrates?: [number, number]
  }): void
  setStreamingAudioBitrates(lowBitrate: number, highBitrate: number): void
  setVideoModeCode(mode: number): void
  setMediaPoolSettings(maxFrames: [number, number, number, number]): void
  saveStartupState(): void
  clearStartupState(): void
  setTimeMode(mode: number): void
  setTime(time: {
    hours: number
    minutes: number
    seconds: number
    frames: number
    dropFrame: boolean
  }): void
  setDisplayClockState(state: number): void
  setDisplayClockProperties(properties: {
    enabled?: boolean
    size?: number
    opacity?: number
    positionX?: number
    positionY?: number
    autoHide?: boolean
    startFrom?: { hours: number; minutes: number; seconds: number; frames: number }
    startFromFrames?: number
    clockMode?: number
  }): void
  setMultiviewerProperties(layout: number, programPreviewSwapped: boolean): void
  setMultiviewerWindowSource(
    windowIndex: number,
    source: number,
    supportsVuMeter: boolean,
    supportsSafeArea: boolean,
  ): void
  setClassicAudioMaster(master: {
    gain?: number
    balance?: number
    followFadeToBlack?: boolean
  }): void
  setFairlightMaster(master: {
    bandCount?: number
    equalizerEnabled?: boolean
    equalizerGain?: number
    makeUpGain?: number
    faderGain?: number
    followFadeToBlack?: boolean
  }): void
  setFairlightSource(
    id: number,
    sourceId: string,
    properties: { mixOption?: 1 | 2 | 4; faderGain?: number },
  ): void
  setCameraControl(control: {
    source?: number
    category?: number
    parameter?: number
    type?: number
    periodicFlushEnabled?: boolean
    numberData?: number[]
    bigintData?: bigint[]
    boolData?: boolean[]
    stringData?: string
  }): void
  setFadeToBlackRate(rate: number): void
  fadeToBlack(): void
  macroRun(index: number): void
  macroStop(): void
  macroStartRecord(index: number, name: string, description: string): void
  macroStopRecord(): void
  macroDelete(index: number): void
  macroUpdateProperties(index: number, properties: { name?: string; description?: string }): void
  macroAddPause(frames: number): void
  macroContinue(): void
  macroInsertUserWait(): void
  setMacroLoop(loop: boolean): void
  setSuperSourceProperties(ssrcId: number, props: Record<string, unknown>): void
  setSuperSourceBorder(ssrcId: number, props: Record<string, unknown>): void
  setSuperSourceBox(ssrcId: number, boxId: number, props: Record<string, unknown>): void
  setProgram(source: SourceRef): void
  setPreview(source: SourceRef): void
  setAuxSource(bus: 1 | 2 | 3 | 4, source: SourceRef): void
  cut(): void
  startAuto(): void
  setTransitionType(type: TransitionType): void
  setTransitionRate(rateFrames: number): void
  selectMediaPlayerStill(player: MediaPlayerId, slot: number): void
  setUpstreamKey(index: 1 | 2 | 3 | 4, enabled: boolean): void
  setUpstreamKeyLuma(index: 1 | 2 | 3 | 4, properties: Partial<UpstreamKeyLumaState>): void
  setUpstreamKeyType(index: 1 | 2 | 3 | 4, mixEffectKeyType: 0 | 1 | 2 | 3): void
  setUpstreamKeyFillSource(index: 1 | 2 | 3 | 4, fillSource: number): void
  setUpstreamKeyCutSource(index: 1 | 2 | 3 | 4, cutSource: number): void
  setDownstreamKey(index: 1 | 2, enabled: boolean): void
  setDownstreamKeyTie(index: 1 | 2, enabled: boolean): void
  setDownstreamKeyRate(index: 1 | 2, rate: number): void
  autoDownstreamKey(index: 1 | 2, isTowardsOnAir?: boolean): void
}
