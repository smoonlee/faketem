import { createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, relative, resolve } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { z } from 'zod'
import {
  ATEM_DEVICE_PROFILES,
  MACRO_COUNT,
  atemDeviceProfileIdSchema,
  atemSandboxConfigSchema,
  createDefaultConfig,
  getAtemDeviceProfile,
  sourceRefToAtemId,
  inputConfigSchema,
  mediaPlayerNameSchema,
  transitionTypeSchema,
  type AtemSandboxConfig,
  type AtemDeviceProfileId,
  type InputId,
  type MediaPlayerId,
  type SourceRef,
} from '@atem-sandbox/shared'
import {
  AtemStateError,
  AtemStateStore,
  type AtemState,
  type StateChange,
} from '@atem-sandbox/atem-state'
import {
  AtemProtocolServer,
  type AtemProtocolControl,
  type AtemProtocolStatus,
} from '@atem-sandbox/atem-protocol'
import type { ConfigRepository } from './config-repository.js'
import type { Logger } from './logger.js'

const sourceRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('input'), inputId: z.number().int().min(1).max(8) }),
  z.object({ kind: z.literal('media-player'), player: z.union([z.literal(1), z.literal(2)]) }),
  z.object({ kind: z.literal('super-source') }),
])

function parsedSourceToSourceRef(source: z.infer<typeof sourceRefSchema>): SourceRef {
  if (source.kind === 'input') {
    return { kind: 'input', inputId: source.inputId as InputId }
  }
  return source
}

const controlCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set-preview'), source: sourceRefSchema }),
  z.object({ type: z.literal('set-program'), source: sourceRefSchema }),
  z.object({ type: z.literal('set-recording-status'), enabled: z.boolean() }),
  z.object({ type: z.literal('set-recording-iso'), recordAllInputs: z.boolean() }),
  z.object({ type: z.literal('switch-recording-disk') }),
  z.object({ type: z.literal('set-streaming-status'), enabled: z.boolean() }),
  z.object({
    type: z.literal('set-streaming-service'),
    serviceName: z.string().trim().min(1).max(64).optional(),
    url: z.string().trim().max(512).optional(),
    key: z.string().trim().max(512).optional(),
    bitrates: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
  }),
  z.object({
    type: z.literal('set-streaming-audio-bitrates'),
    lowBitrate: z.number().int().min(32_000),
    highBitrate: z.number().int().min(32_000),
  }),
  z.object({ type: z.literal('set-video-mode-code'), mode: z.number().int().min(0).max(255) }),
  z.object({
    type: z.literal('set-media-pool-settings'),
    maxFrames: z.tuple([
      z.number().int().min(0).max(65535),
      z.number().int().min(0).max(65535),
      z.number().int().min(0).max(65535),
      z.number().int().min(0).max(65535),
    ]),
    unassignedFrames: z.number().int().min(0).max(65535),
  }),
  z.object({ type: z.literal('save-startup-state') }),
  z.object({ type: z.literal('clear-startup-state') }),
  z.object({ type: z.literal('set-time-mode'), mode: z.number().int().min(0).max(255) }),
  z.object({
    type: z.literal('set-time'),
    hours: z.number().int().min(0).max(23),
    minutes: z.number().int().min(0).max(59),
    seconds: z.number().int().min(0).max(59),
    frames: z.number().int().min(0).max(59),
    dropFrame: z.boolean(),
  }),
  z.object({ type: z.literal('set-display-clock-state'), state: z.number().int().min(0).max(255) }),
  z.object({
    type: z.literal('set-display-clock-properties'),
    properties: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('set-multiviewer-properties'),
    layout: z.number().int().min(0).max(255),
    programPreviewSwapped: z.boolean(),
  }),
  z.object({
    type: z.literal('set-multiviewer-window-source'),
    windowIndex: z.number().int().min(0).max(15),
    source: z.number().int().min(0).max(65535),
    supportsVuMeter: z.boolean().default(true),
    supportsSafeArea: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('set-classic-audio-master'),
    master: z.record(z.string(), z.unknown()),
  }),
  z.object({ type: z.literal('set-fairlight-master'), master: z.record(z.string(), z.unknown()) }),
  z.object({
    type: z.literal('set-fairlight-source'),
    id: z.number().int(),
    sourceId: z.string(),
    properties: z.object({
      mixOption: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional(),
      faderGain: z.number().int().min(-10000).max(1000).optional(),
    }),
  }),
  z.object({ type: z.literal('set-camera-control'), control: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('set-fade-to-black-rate'), rate: z.number().int().min(1).max(250) }),
  z.object({ type: z.literal('fade-to-black') }),
  z.object({
    type: z.literal('macro-run'),
    index: z
      .number()
      .int()
      .min(0)
      .max(MACRO_COUNT - 1),
  }),
  z.object({ type: z.literal('macro-stop') }),
  z.object({
    type: z.literal('macro-start-record'),
    index: z
      .number()
      .int()
      .min(0)
      .max(MACRO_COUNT - 1),
    name: z.string().max(255),
    description: z.string().max(1024),
  }),
  z.object({ type: z.literal('macro-stop-record') }),
  z.object({ type: z.literal('macro-insert-user-wait') }),
  z.object({
    type: z.literal('macro-delete'),
    index: z
      .number()
      .int()
      .min(0)
      .max(MACRO_COUNT - 1),
  }),
  z.object({ type: z.literal('macro-add-pause'), frames: z.number().int().min(0).max(65535) }),
  z.object({ type: z.literal('set-macro-loop'), loop: z.boolean() }),
  z.object({ type: z.literal('macro-continue') }),
  z.object({
    type: z.literal('set-super-source-properties'),
    ssrcId: z.number().int().min(0),
    props: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('set-super-source-border'),
    ssrcId: z.number().int().min(0),
    props: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('set-super-source-box'),
    ssrcId: z.number().int().min(0),
    boxId: z.number().int().min(0).max(3),
    props: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('set-aux-source'),
    bus: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    source: sourceRefSchema,
  }),
  z.object({ type: z.literal('cut') }),
  z.object({ type: z.literal('auto') }),
  z.object({
    type: z.literal('set-upstream-key'),
    index: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    enabled: z.boolean(),
  }),
  z.object({
    type: z.literal('set-upstream-key-type'),
    index: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    mixEffectKeyType: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  }),
  z.object({
    type: z.literal('set-upstream-key-fill-source'),
    index: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    fillSource: z.number().int(),
  }),
  z.object({
    type: z.literal('set-upstream-key-cut-source'),
    index: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    cutSource: z.number().int(),
  }),
  z.object({
    type: z.literal('set-downstream-key'),
    index: z.union([z.literal(1), z.literal(2)]),
    enabled: z.boolean(),
  }),
  z.object({
    type: z.literal('set-downstream-key-tie'),
    index: z.union([z.literal(1), z.literal(2)]),
    enabled: z.boolean(),
  }),
  z.object({
    type: z.literal('set-downstream-key-rate'),
    index: z.union([z.literal(1), z.literal(2)]),
    rate: z.number().int().min(1).max(250),
  }),
  z.object({
    type: z.literal('auto-downstream-key'),
    index: z.union([z.literal(1), z.literal(2)]),
    isTowardsOnAir: z.boolean().optional(),
  }),
  z.object({ type: z.literal('set-transition-type'), transitionType: transitionTypeSchema }),
  z.object({
    type: z.literal('set-transition-rate'),
    rateFrames: z.number().int().min(1).max(250),
  }),
  z.object({
    type: z.literal('select-media-player-still'),
    player: z.union([z.literal(1), z.literal(2)]),
    slot: z.number().int().min(1).max(20),
  }),
])

const inputUpdateSchema = inputConfigSchema
  .omit({ id: true })
  .partial()
  .refine((update) => Object.keys(update).length > 0, 'provide at least one input field')

const deviceProfileUpdateSchema = z.object({
  modelId: atemDeviceProfileIdSchema,
})

const deviceSettingsUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    videoMode: z.enum(['1080p50', '1080p25', '720p50']).optional(),
  })
  .refine((update) => Object.keys(update).length > 0, 'provide at least one device setting')

const mediaPlayerUpdateSchema = z.object({
  name: mediaPlayerNameSchema,
})

const mediaPoolStillCreateSchema = z.object({
  name: z.string().trim().min(1).max(64),
  text: z.string().trim().min(1).max(160),
  background: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'must be a six-digit hex colour')
    .optional(),
  foreground: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'must be a six-digit hex colour')
    .optional(),
})

const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

const LOCAL_WEB_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

function isAllowedBrowserOrigin(origin: string | undefined): boolean {
  if (origin === undefined) {
    return true
  }

  try {
    const parsedOrigin = new URL(origin)
    return (
      (parsedOrigin.protocol === 'http:' || parsedOrigin.protocol === 'https:') &&
      LOCAL_WEB_HOSTS.has(parsedOrigin.hostname)
    )
  } catch {
    return false
  }
}

export interface RuntimeStatus {
  startedAt: string
  host: string
  webPort: number
  atemPort: number
  connectedClients: number
  atemClients: number
  atemProtocol: AtemProtocolStatus
  deviceName: string
  deviceProfileId: AtemDeviceProfileId
  deviceModel: string
  videoMode: AtemSandboxConfig['device']['videoMode']
  deviceProfiles: ReadonlyArray<{ id: AtemDeviceProfileId; label: string }>
}

export interface SandboxRuntimeOptions {
  config: AtemSandboxConfig
  configRepository: ConfigRepository
  logger: Logger
  portableRoot: string
  webHost?: string | undefined
  webPort?: number | undefined
  atemHost?: string | undefined
  webDistDirectory?: string | undefined
}

export class SandboxRuntime {
  public readonly store: AtemStateStore
  private readonly httpServer = createServer((request, response) => {
    void this.handleRequest(request, response)
  })
  private readonly webSocketServer = new WebSocketServer({ noServer: true })
  private readonly startedAt = new Date().toISOString()
  private readonly webDistDirectory: string
  private readonly mediaDirectory: string
  private readonly atemProtocol: AtemProtocolServer
  private device: AtemSandboxConfig['device']
  private unsubscribe: (() => void) | undefined

  public constructor(private readonly options: SandboxRuntimeOptions) {
    this.store = new AtemStateStore(options.config)
    this.device = { ...options.config.device }
    this.webDistDirectory =
      options.webDistDirectory ?? join(options.portableRoot, 'apps', 'web', 'dist')
    this.mediaDirectory = join(options.portableRoot, 'media')
    this.atemProtocol = new AtemProtocolServer({
      host: options.atemHost ?? options.config.server.host,
      port: options.config.server.atemPort,
      device: this.getProtocolDeviceProfile(),
      control: this.createProtocolControl(),
      logger: options.logger,
      onClientCountChanged: () => this.broadcastSnapshot(),
    })
    this.configureWebSocketServer()
  }

  public async start(): Promise<void> {
    this.unsubscribe = this.store.subscribe((change) => this.handleStateChange(change))
    try {
      await this.atemProtocol.start()
      await new Promise<void>((resolveStart, rejectStart) => {
        this.httpServer.once('error', rejectStart)
        this.httpServer.listen(
          this.options.webPort ?? this.options.config.server.webPort,
          this.options.webHost ?? '127.0.0.1',
          () => {
            this.httpServer.off('error', rejectStart)
            resolveStart()
          },
        )
      })
    } catch (error) {
      this.unsubscribe?.()
      this.unsubscribe = undefined
      await this.atemProtocol.stop()
      throw error
    }
    this.options.logger.info(
      `Web server started at http://${this.options.webHost ?? '127.0.0.1'}:${this.getStatus().webPort}`,
    )
    this.options.logger.info(
      `ATEM UDP server listening at ${this.options.atemHost ?? this.options.config.server.host}:${this.options.config.server.atemPort}.`,
    )
  }

  public async stop(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    await this.atemProtocol.stop()
    try {
      await this.options.configRepository.flush()
    } catch (error) {
      this.options.logger.error(
        'Pending configuration changes could not be flushed on shutdown.',
        error,
      )
    }
    this.store.dispose()
    this.webSocketServer.clients.forEach((client) => client.close())
    await new Promise<void>((resolveStop, rejectStop) => {
      this.httpServer.close((error) => (error === undefined ? resolveStop() : rejectStop(error)))
    })
  }

  public getStatus(): RuntimeStatus {
    const address = this.httpServer.address()
    return {
      startedAt: this.startedAt,
      host: this.options.atemHost ?? this.options.config.server.host,
      webPort:
        address !== null && typeof address !== 'string'
          ? address.port
          : (this.options.webPort ?? this.options.config.server.webPort),
      atemPort: this.atemProtocol.getPort() ?? this.options.config.server.atemPort,
      connectedClients: this.webSocketServer.clients.size,
      atemClients: this.atemProtocol.getClientCount(),
      atemProtocol: this.atemProtocol.getStatus(),
      deviceName: this.device.name,
      deviceProfileId: this.device.modelId,
      deviceModel: this.device.model,
      videoMode: this.device.videoMode,
      deviceProfiles: ATEM_DEVICE_PROFILES.map(({ id, label }) => ({ id, label })),
    }
  }

  private configureWebSocketServer(): void {
    this.httpServer.on('upgrade', (request, socket, head) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (path !== '/ws' || !isAllowedBrowserOrigin(request.headers.origin)) {
        socket.destroy()
        return
      }
      this.webSocketServer.handleUpgrade(request, socket, head, (client) => {
        this.webSocketServer.emit('connection', client, request)
      })
    })

    this.webSocketServer.on('connection', (client) => {
      this.options.logger.info('Web UI client connected.')
      this.sendSnapshot(client)
      this.broadcastSnapshot()
      client.on('close', () => {
        this.options.logger.info('Web UI client disconnected.')
        this.broadcastSnapshot()
      })
    })
  }

  private handleStateChange(change: StateChange): void {
    const state = change.state
    const action = change.action
    if (
      action.origin === 'system' &&
      state.macro.macroPlayer.isRunning &&
      action.macroOperation !== undefined &&
      action.macroOperation.type !== 'auto'
    ) {
      this.persistProtocolSettings(state)
    }
    switch (action.type) {
      case 'set-program':
        this.options.logger.info(`Program changed to ${this.describeSource(state.program)}.`)
        break
      case 'set-preview':
        this.options.logger.info(`Preview changed to ${this.describeSource(state.preview)}.`)
        break
      case 'cut':
        this.options.logger.info('CUT completed.')
        break
      case 'auto-start':
        this.options.logger.info('AUTO started.')
        break
      case 'auto-complete':
        this.options.logger.info('AUTO completed.')
        break
      case 'select-media-player-still':
        this.options.logger.info('Media Player still changed.')
        break
      case 'update-media-player':
        this.options.logger.info('Media Player label changed.')
        break
      default:
        this.options.logger.debug(`State action: ${action.type} (${action.origin}).`)
    }
    this.broadcastSnapshot()
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!isAllowedBrowserOrigin(request.headers.origin)) {
      this.sendJson(response, 403, { error: 'Browser requests must originate from localhost.' })
      return
    }

    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (url.pathname === '/api/v1/logs' && request.method === 'GET') {
        this.sendJson(response, 200, {
          entries: this.options.logger.getRecentEntries().slice(-500),
          debugEnabled: this.options.logger.debugEnabled,
        })
        return
      }
      if (url.pathname === '/api/v1/health' && request.method === 'GET') {
        this.sendJson(response, 200, { ok: true, protocol: this.atemProtocol.getStatus() })
        return
      }
      if (url.pathname === '/api/v1/state' && request.method === 'GET') {
        this.sendJson(response, 200, { state: this.store.getState() })
        return
      }
      if (url.pathname === '/api/v1/status' && request.method === 'GET') {
        this.sendJson(response, 200, { status: this.getStatus() })
        return
      }
      if (url.pathname === '/api/v1/sandbox/export' && request.method === 'GET') {
        this.handleSandboxExportRequest(response)
        return
      }
      if (url.pathname === '/api/v1/sandbox/import' && request.method === 'POST') {
        await this.handleSandboxImportRequest(request, response)
        return
      }
      if (url.pathname === '/api/v1/sandbox/reset-default' && request.method === 'POST') {
        await this.handleSandboxResetDefaultRequest(response)
        return
      }
      if (url.pathname === '/api/v1/control' && request.method === 'POST') {
        await this.handleControlRequest(request, response)
        return
      }
      if (url.pathname === '/api/v1/device-profile' && request.method === 'PATCH') {
        await this.handleDeviceProfileUpdateRequest(request, response)
        return
      }
      if (url.pathname === '/api/v1/device-settings' && request.method === 'PATCH') {
        await this.handleDeviceSettingsUpdateRequest(request, response)
        return
      }
      if (url.pathname.startsWith('/api/v1/media-players/') && request.method === 'PATCH') {
        await this.handleMediaPlayerUpdateRequest(url.pathname, request, response)
        return
      }
      if (url.pathname === '/api/v1/media-pool/stills' && request.method === 'POST') {
        await this.handleMediaPoolStillCreateRequest(request, response)
        return
      }
      if (url.pathname.startsWith('/api/v1/media-pool/stills/') && request.method === 'DELETE') {
        await this.handleMediaPoolStillDeleteRequest(url.pathname, response)
        return
      }
      if (url.pathname.startsWith('/api/v1/inputs/') && request.method === 'PATCH') {
        await this.handleInputUpdateRequest(url.pathname, request, response)
        return
      }
      if (url.pathname.startsWith('/media/') && request.method === 'GET') {
        await this.serveFile(
          response,
          this.mediaDirectory,
          decodeURIComponent(url.pathname.slice('/media/'.length)),
        )
        return
      }

      await this.serveWebApplication(url.pathname, response)
    } catch (error) {
      this.handleHttpError(response, error)
    }
  }

  private async handleControlRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const command = controlCommandSchema.parse(await this.readJsonBody(request))
    let state: AtemState
    let shouldPersist = false

    switch (command.type) {
      case 'set-recording-status':
        state = this.store.setRecordingStatus(command.enabled, 'api')
        break
      case 'set-recording-iso':
        state = this.store.setRecordingIso(command.recordAllInputs, 'api')
        break
      case 'switch-recording-disk':
        state = this.store.switchRecordingDisk('api')
        break
      case 'set-streaming-status':
        state = this.store.setStreamingStatus(command.enabled, 'api')
        break
      case 'set-streaming-service':
        state = this.store.setStreamingService(
          {
            ...(command.serviceName !== undefined ? { serviceName: command.serviceName } : {}),
            ...(command.url !== undefined ? { url: command.url } : {}),
            ...(command.key !== undefined ? { key: command.key } : {}),
            ...(command.bitrates !== undefined ? { bitrates: command.bitrates } : {}),
          },
          'api',
        )
        break
      case 'set-streaming-audio-bitrates':
        state = this.store.setStreamingAudioBitrates(command.lowBitrate, command.highBitrate, 'api')
        break
      case 'set-video-mode-code':
        state = this.store.setVideoModeCode(command.mode, 'api')
        break
      case 'set-media-pool-settings':
        state = this.store.setMediaPoolSettings(command.maxFrames, command.unassignedFrames, 'api')
        shouldPersist = true
        break
      case 'save-startup-state':
        state = this.store.saveStartupState('api')
        break
      case 'clear-startup-state':
        state = this.store.clearStartupState('api')
        break
      case 'set-time-mode':
        state = this.store.setTimeMode(command.mode, 'api')
        break
      case 'set-time':
        state = this.store.setTime(
          {
            hours: command.hours,
            minutes: command.minutes,
            seconds: command.seconds,
            frames: command.frames,
            dropFrame: command.dropFrame,
          },
          'api',
        )
        break
      case 'set-display-clock-state':
        state = this.store.setDisplayClockState(command.state, 'api')
        break
      case 'set-display-clock-properties':
        state = this.store.setDisplayClockProperties(command.properties as never, 'api')
        break
      case 'set-multiviewer-properties':
        state = this.store.setMultiviewerProperties(
          command.layout,
          command.programPreviewSwapped,
          'api',
        )
        break
      case 'set-multiviewer-window-source':
        state = this.store.setMultiviewerWindowSource(
          command.windowIndex,
          command.source,
          command.supportsVuMeter,
          command.supportsSafeArea,
          'api',
        )
        break
      case 'set-classic-audio-master':
        state = this.store.setClassicAudioMaster(command.master as never, 'api')
        break
      case 'set-fairlight-master':
        state = this.store.setFairlightMaster(command.master as never, 'api')
        break
      case 'set-fairlight-source':
        state = this.store.setFairlightSource(
          command.id,
          command.sourceId,
          {
            ...(command.properties.mixOption !== undefined
              ? { mixOption: command.properties.mixOption }
              : {}),
            ...(command.properties.faderGain !== undefined
              ? { faderGain: command.properties.faderGain }
              : {}),
          },
          'api',
        )
        break
      case 'set-camera-control':
        state = this.store.setCameraControl(command.control as never, 'api')
        break
      case 'set-fade-to-black-rate':
        state = this.store.setFadeToBlackRate(command.rate, 'api')
        shouldPersist = true
        break
      case 'fade-to-black':
        state = this.store.fadeToBlack('api')
        break
      case 'macro-run':
        state = this.store.macroRun(command.index, 'api')
        break
      case 'macro-stop':
        state = this.store.macroStop('api')
        break
      case 'macro-start-record':
        state = this.store.macroStartRecord(command.index, command.name, command.description, 'api')
        break
      case 'macro-stop-record':
        state = this.store.macroStopRecord('api')
        shouldPersist = true
        break
      case 'macro-insert-user-wait':
        state = this.store.macroInsertUserWait('api')
        break
      case 'macro-delete':
        state = this.store.macroDelete(command.index, 'api')
        shouldPersist = true
        break
      case 'macro-add-pause':
        state = this.store.macroAddPause(command.frames, 'api')
        break
      case 'set-macro-loop':
        state = this.store.setMacroLoop(command.loop, 'api')
        break
      case 'macro-continue':
        state = this.store.macroContinue('api')
        break
      case 'set-super-source-properties':
        state = this.store.setSuperSourceProperties(command.ssrcId, command.props as never, 'api')
        break
      case 'set-super-source-border':
        state = this.store.setSuperSourceBorder(command.ssrcId, command.props as never, 'api')
        break
      case 'set-super-source-box':
        state = this.store.setSuperSourceBox(
          command.ssrcId,
          command.boxId,
          command.props as never,
          'api',
        )
        break
      case 'set-preview':
        state = this.store.setPreview(parsedSourceToSourceRef(command.source), 'api')
        break
      case 'set-program':
        state = this.store.setProgram(parsedSourceToSourceRef(command.source), 'api')
        break
      case 'set-aux-source':
        state = this.store.setAuxSource(command.bus, parsedSourceToSourceRef(command.source), 'api')
        shouldPersist = true
        break
      case 'cut':
        state = this.store.cut('api')
        break
      case 'auto':
        state = await this.store.auto('api')
        break
      case 'set-upstream-key':
        state = this.store.setUpstreamKey(command.index, command.enabled, 'api')
        shouldPersist = true
        break
      case 'set-upstream-key-type':
        state = this.store.setUpstreamKeyType(command.index, command.mixEffectKeyType, 'api')
        shouldPersist = true
        break
      case 'set-upstream-key-fill-source':
        state = this.store.setUpstreamKeyFillSource(command.index, command.fillSource, 'api')
        shouldPersist = true
        break
      case 'set-upstream-key-cut-source':
        state = this.store.setUpstreamKeyCutSource(command.index, command.cutSource, 'api')
        shouldPersist = true
        break
      case 'set-downstream-key':
        state = this.store.setDownstreamKey(command.index, command.enabled, 'api')
        shouldPersist = true
        break
      case 'set-downstream-key-tie':
        state = this.store.setDownstreamKeyTie(command.index, command.enabled, 'api')
        shouldPersist = true
        break
      case 'set-downstream-key-rate':
        state = this.store.setDownstreamKeyRate(command.index, command.rate, 'api')
        shouldPersist = true
        break
      case 'auto-downstream-key':
        state = this.store.autoDownstreamKey(command.index, 'api', command.isTowardsOnAir)
        shouldPersist = true
        break
      case 'set-transition-type':
        state = this.store.setTransitionType(command.transitionType, 'api')
        shouldPersist = true
        break
      case 'set-transition-rate':
        state = this.store.setTransitionRate(command.rateFrames, 'api')
        shouldPersist = true
        break
      case 'select-media-player-still':
        state = this.store.selectMediaPlayerStill(command.player, command.slot, 'api')
        shouldPersist = true
        break
    }

    if (shouldPersist) {
      await this.persistSettings(state)
    }
    this.sendJson(response, 200, { state })
  }

  private async handleInputUpdateRequest(
    path: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const inputIdText = path.slice('/api/v1/inputs/'.length)
    const inputId = Number(inputIdText)
    if (!Number.isInteger(inputId) || inputId < 1 || inputId > 8) {
      this.sendJson(response, 404, { error: 'Input not found.' })
      return
    }

    const update = inputUpdateSchema.parse(await this.readJsonBody(request))
    const currentInput = this.store.getState().inputs.find((input) => input.id === inputId)
    if (currentInput === undefined) {
      this.sendJson(response, 404, { error: 'Input not found.' })
      return
    }
    const state = this.store.updateInput(
      inputId as InputId,
      {
        longName: update.longName ?? currentInput.longName,
        shortName: update.shortName ?? currentInput.shortName,
        background: update.background ?? currentInput.background,
        foreground: update.foreground ?? currentInput.foreground,
      },
      'api',
    )
    await this.persistSettings(state)
    this.sendJson(response, 200, { state })
  }

  private async handleMediaPlayerUpdateRequest(
    path: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const playerText = path.slice('/api/v1/media-players/'.length)
    const player = Number(playerText)
    if (player !== 1 && player !== 2) {
      this.sendJson(response, 404, { error: 'Media Player not found.' })
      return
    }

    const update = mediaPlayerUpdateSchema.parse(await this.readJsonBody(request))
    const state = this.store.updateMediaPlayerName(player as MediaPlayerId, update.name, 'api')
    await this.persistSettings(state)
    this.sendJson(response, 200, { state })
  }

  private async handleDeviceProfileUpdateRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const update = deviceProfileUpdateSchema.parse(await this.readJsonBody(request))
    const profile = getAtemDeviceProfile(update.modelId)
    if (this.store.getState().transition.inTransition) {
      throw new AtemStateError(
        'transition-in-progress',
        'Cannot change the sandbox model while an AUTO transition is in progress.',
      )
    }
    const currentConfig = this.options.configRepository.get()
    const defaults = createDefaultConfig(profile.id)
    const config = await this.options.configRepository.replace({
      ...defaults,
      // The local service must remain reachable while its sandbox surface is
      // reset for the newly selected model.
      server: { ...currentConfig.server },
    })

    this.device = { ...config.device }
    this.atemProtocol.setDeviceProfile(this.getProtocolDeviceProfile())
    this.atemProtocol.clearSessions()
    const state = this.store.replaceConfiguration(config, 'api')
    this.options.logger.info(`Sandbox reset for ${profile.label}.`)
    this.sendJson(response, 200, { state, status: this.getStatus() })
  }

  private async handleDeviceSettingsUpdateRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const update = deviceSettingsUpdateSchema.parse(await this.readJsonBody(request))
    const currentConfig = this.options.configRepository.get()
    const device = {
      ...currentConfig.device,
      ...(update.name !== undefined ? { name: update.name } : {}),
      ...(update.videoMode !== undefined ? { videoMode: update.videoMode } : {}),
    }
    const identityChanged =
      device.name !== this.device.name || device.videoMode !== this.device.videoMode

    if (
      device.videoMode !== this.device.videoMode &&
      this.store.getState().transition.inTransition
    ) {
      throw new AtemStateError(
        'transition-in-progress',
        'Cannot change video mode while an AUTO transition is in progress.',
      )
    }

    const config = await this.options.configRepository.update((current) => ({
      ...current,
      device,
    }))
    this.device = { ...config.device }
    this.atemProtocol.setDeviceProfile(this.getProtocolDeviceProfile())
    if (identityChanged) {
      this.atemProtocol.clearSessions()
    }
    const state = this.store.updateDeviceSettings(config.device, 'api')
    this.options.logger.info('Virtual ATEM device settings updated.')
    this.sendJson(response, 200, { state, status: this.getStatus() })
  }

  private async handleMediaPoolStillCreateRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const create = mediaPoolStillCreateSchema.parse(await this.readJsonBody(request))
    const usedSlots = new Set(this.store.getState().mediaPool.stills.map((still) => still.slot))
    const availableSlot = Array.from({ length: 20 }, (_, index) => index + 1).find(
      (slot) => !usedSlots.has(slot),
    )

    if (availableSlot === undefined) {
      throw new AtemStateError('invalid-media-slot', 'Media Pool is full (20/20 slots in use).')
    }

    const state = this.store.upsertMediaPoolStill(
      {
        slot: availableSlot,
        type: 'generated',
        name: create.name,
        text: create.text,
        background: create.background?.toUpperCase() ?? '#1E3A8A',
        foreground: create.foreground?.toUpperCase() ?? '#FFFFFF',
      },
      'api',
    )

    await this.persistSettings(state)
    this.sendJson(response, 200, { state })
  }

  private async handleMediaPoolStillDeleteRequest(
    path: string,
    response: ServerResponse,
  ): Promise<void> {
    const slotText = path.slice('/api/v1/media-pool/stills/'.length)
    const slot = Number(slotText)
    if (!Number.isInteger(slot) || slot < 1 || slot > 20) {
      this.sendJson(response, 404, { error: 'Media Pool slot not found.' })
      return
    }

    const state = this.store.deleteMediaPoolStill(slot, 'api')
    await this.persistSettings(state)
    this.sendJson(response, 200, { state })
  }

  private handleSandboxExportRequest(response: ServerResponse): void {
    const json = `${JSON.stringify(this.options.configRepository.get(), null, 2)}\n`
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="atem-sandbox.json"',
      'content-length': Buffer.byteLength(json),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    response.end(json)
  }

  private async handleSandboxImportRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    // Parse before persisting or changing the live store. The Zod schema also
    // normalizes compatible legacy fields (for example a missing MP label).
    const importedConfig = atemSandboxConfigSchema.parse(await this.readJsonBody(request))
    const activeServer = this.options.config.server
    const restartRequired =
      importedConfig.server.host !== activeServer.host ||
      importedConfig.server.webPort !== activeServer.webPort ||
      importedConfig.server.atemPort !== activeServer.atemPort

    // Replacing an active AUTO transition would leave its timer targeting the
    // old configuration, so fail before committing the imported profile.
    if (this.store.getState().transition.inTransition) {
      throw new AtemStateError(
        'transition-in-progress',
        'Cannot import a sandbox while an AUTO transition is in progress.',
      )
    }

    const requiresAtemReconnect =
      importedConfig.device.modelId !== this.device.modelId ||
      importedConfig.device.videoMode !== this.device.videoMode
    const config = await this.options.configRepository.replace(importedConfig)
    this.device = { ...config.device }
    this.atemProtocol.setDeviceProfile(this.getProtocolDeviceProfile())
    if (requiresAtemReconnect) {
      this.atemProtocol.clearSessions()
    }
    const state = this.store.replaceConfiguration(config, 'api')
    this.options.logger.info('Sandbox configuration imported.')
    this.sendJson(response, 200, {
      state,
      status: this.getStatus(),
      restartRequired,
    })
  }

  private async handleSandboxResetDefaultRequest(response: ServerResponse): Promise<void> {
    if (this.store.getState().transition.inTransition) {
      throw new AtemStateError(
        'transition-in-progress',
        'Cannot reset sandbox defaults while an AUTO transition is in progress.',
      )
    }

    const currentConfig = this.options.configRepository.get()
    const defaults = createDefaultConfig(this.device.modelId)
    const nextConfig = {
      ...defaults,
      server: { ...currentConfig.server },
    }

    const requiresAtemReconnect =
      nextConfig.device.modelId !== this.device.modelId ||
      nextConfig.device.videoMode !== this.device.videoMode

    const config = await this.options.configRepository.replace(nextConfig)
    this.device = { ...config.device }
    this.atemProtocol.setDeviceProfile(this.getProtocolDeviceProfile())
    if (requiresAtemReconnect) {
      this.atemProtocol.clearSessions()
    }
    const state = this.store.replaceConfiguration(config, 'api')
    this.options.logger.info(`Sandbox reset to defaults for ${config.device.model}.`)
    this.sendJson(response, 200, {
      state,
      status: this.getStatus(),
    })
  }

  private async persistSettings(state: AtemState): Promise<void> {
    await this.options.configRepository.update((config) => ({
      ...config,
      ...(!state.macro.macroRecorder.isRecording
        ? { macros: structuredClone(state.macro.macros) }
        : {}),
      transition: {
        type: state.transition.type,
        rateFrames: state.transition.rateFrames,
        fadeToBlackRate: state.fadeToBlack.rate,
      },
      inputs: state.inputs.map((input) => ({ ...input })),
      auxiliaries: {
        1: sourceRefToPersistedId(state.auxiliaries[1]),
        2: sourceRefToPersistedId(state.auxiliaries[2]),
        3: sourceRefToPersistedId(state.auxiliaries[3]),
        4: sourceRefToPersistedId(state.auxiliaries[4]),
      },
      mediaPlayers: {
        1: { ...state.mediaPlayers[1] },
        2: { ...state.mediaPlayers[2] },
      },
      keyers: {
        upstream: { ...state.upstreamKeys } as AtemSandboxConfig['keyers']['upstream'],
        upstreamLuma: {
          1: { ...state.upstreamKeyLuma[1]! },
          2: { ...state.upstreamKeyLuma[2]! },
          3: { ...state.upstreamKeyLuma[3]! },
          4: { ...state.upstreamKeyLuma[4]! },
        },
        upstreamSettings: {
          1: { ...state.upstreamKeyProperties[1]! },
          2: { ...state.upstreamKeyProperties[2]! },
          3: { ...state.upstreamKeyProperties[3]! },
          4: { ...state.upstreamKeyProperties[4]! },
        },
        downstream: {
          1: {
            onAir: state.downstreamKeys[1]!.onAir,
            tie: state.downstreamKeys[1]!.tie,
            rate: state.downstreamKeys[1]!.rate,
          },
          2: {
            onAir: state.downstreamKeys[2]!.onAir,
            tie: state.downstreamKeys[2]!.tie,
            rate: state.downstreamKeys[2]!.rate,
          },
        },
      },
      mediaPool: {
        stills: structuredClone(state.mediaPool.stills),
        settings: {
          maxFrames: structuredClone(state.settings.mediaPool.maxFrames),
          unassignedFrames: state.settings.mediaPool.unassignedFrames,
        },
      },
    }))
  }

  private createProtocolControl(): AtemProtocolControl {
    return {
      getState: () => this.store.getState(),
      subscribe: (listener) => this.store.subscribe(listener),
      setRecordingStatus: (recording) => {
        this.store.setRecordingStatus(recording, 'atem-protocol')
      },
      setRecordingIso: (recordAllInputs) => {
        this.store.setRecordingIso(recordAllInputs, 'atem-protocol')
      },
      switchRecordingDisk: () => {
        this.store.switchRecordingDisk('atem-protocol')
      },
      setStreamingStatus: (streaming) => {
        this.store.setStreamingStatus(streaming, 'atem-protocol')
      },
      setStreamingService: (service) => {
        this.store.setStreamingService(service, 'atem-protocol')
      },
      setStreamingAudioBitrates: (lowBitrate, highBitrate) => {
        this.store.setStreamingAudioBitrates(lowBitrate, highBitrate, 'atem-protocol')
      },
      setVideoModeCode: (mode) => {
        this.store.setVideoModeCode(mode, 'atem-protocol')
      },
      setMediaPoolSettings: (maxFrames) => {
        const state = this.store.setMediaPoolSettings(
          maxFrames,
          this.store.getState().settings.mediaPool.unassignedFrames,
          'atem-protocol',
        )
        this.persistProtocolSettings(state)
      },
      saveStartupState: () => {
        this.store.saveStartupState('atem-protocol')
      },
      clearStartupState: () => {
        this.store.clearStartupState('atem-protocol')
      },
      setTimeMode: (mode) => {
        this.store.setTimeMode(mode, 'atem-protocol')
      },
      setTime: (time) => {
        this.store.setTime(time, 'atem-protocol')
      },
      setDisplayClockState: (state) => {
        this.store.setDisplayClockState(state, 'atem-protocol')
      },
      setDisplayClockProperties: (properties) => {
        this.store.setDisplayClockProperties(properties as never, 'atem-protocol')
      },
      setMultiviewerProperties: (layout, programPreviewSwapped) => {
        this.store.setMultiviewerProperties(layout, programPreviewSwapped, 'atem-protocol')
      },
      setMultiviewerWindowSource: (windowIndex, source, supportsVuMeter, supportsSafeArea) => {
        this.store.setMultiviewerWindowSource(
          windowIndex,
          source,
          supportsVuMeter,
          supportsSafeArea,
          'atem-protocol',
        )
      },
      setClassicAudioMaster: (master) => {
        this.store.setClassicAudioMaster(master as never, 'atem-protocol')
      },
      setFairlightMaster: (master) => {
        this.store.setFairlightMaster(master as never, 'atem-protocol')
      },
      setFairlightSource: (id, sourceId, properties) => {
        this.store.setFairlightSource(id, sourceId, properties, 'atem-protocol')
      },
      setCameraControl: (control) => {
        this.store.setCameraControl(control as never, 'atem-protocol')
      },
      setFadeToBlackRate: (rate) => {
        const state = this.store.setFadeToBlackRate(rate, 'atem-protocol')
        this.persistProtocolSettings(state)
      },
      fadeToBlack: () => {
        this.store.fadeToBlack('atem-protocol')
      },
      macroRun: (index) => {
        this.store.macroRun(index, 'atem-protocol')
      },
      macroStop: () => {
        this.store.macroStop('atem-protocol')
      },
      macroStartRecord: (index, name, description) => {
        this.store.macroStartRecord(index, name, description, 'atem-protocol')
      },
      macroStopRecord: () => {
        const state = this.store.macroStopRecord('atem-protocol')
        this.persistProtocolSettings(state)
      },
      macroDelete: (index) => {
        this.persistProtocolSettings(this.store.macroDelete(index, 'atem-protocol'))
      },
      macroUpdateProperties: (index, properties) => {
        this.persistProtocolSettings(
          this.store.macroUpdateProperties(index, properties, 'atem-protocol'),
        )
      },
      macroAddPause: (frames) => {
        this.store.macroAddPause(frames, 'atem-protocol')
      },
      macroContinue: () => {
        this.store.macroContinue('atem-protocol')
      },
      macroInsertUserWait: () => {
        this.store.macroInsertUserWait('atem-protocol')
      },
      setMacroLoop: (loop) => {
        this.store.setMacroLoop(loop, 'atem-protocol')
      },
      setSuperSourceProperties: (ssrcId, props) => {
        this.store.setSuperSourceProperties(ssrcId, props as never, 'atem-protocol')
      },
      setSuperSourceBorder: (ssrcId, props) => {
        this.store.setSuperSourceBorder(ssrcId, props as never, 'atem-protocol')
      },
      setSuperSourceBox: (ssrcId, boxId, props) => {
        this.store.setSuperSourceBox(ssrcId, boxId, props as never, 'atem-protocol')
      },
      setProgram: (source) => {
        this.store.setProgram(source, 'atem-protocol')
      },
      setPreview: (source) => {
        this.store.setPreview(source, 'atem-protocol')
      },
      setAuxSource: (bus, source) => {
        const state = this.store.setAuxSource(bus, source, 'atem-protocol')
        this.persistProtocolSettings(state)
      },
      cut: () => {
        this.store.cut('atem-protocol')
      },
      startAuto: () => {
        void this.store.auto('atem-protocol').catch((error: unknown) => {
          this.options.logger.warn(
            `ATEM AUTO transition could not complete: ${error instanceof Error ? error.message : String(error)}`,
          )
        })
      },
      setTransitionType: (type) => {
        const state = this.store.setTransitionType(type, 'atem-protocol')
        this.persistProtocolSettings(state)
      },
      setTransitionRate: (rateFrames) => {
        const state = this.store.setTransitionRate(rateFrames, 'atem-protocol')
        this.persistProtocolSettings(state)
      },
      selectMediaPlayerStill: (player, slot) => {
        const state = this.store.selectMediaPlayerStill(player, slot, 'atem-protocol')
        this.persistProtocolSettings(state)
      },
      setUpstreamKey: (index, enabled) => {
        const state = this.store.setUpstreamKey(index, enabled, 'atem-protocol')
        this.persistProtocolSettings(state)
      },
      setUpstreamKeyLuma: (index, properties) => {
        const state = this.store.setUpstreamKeyLuma(index, properties, 'atem-protocol')
        this.persistProtocolSettings(state)
      },
      setUpstreamKeyType: (index, mixEffectKeyType) => {
        const state = this.store.setUpstreamKeyType(index, mixEffectKeyType, 'atem-protocol')
        this.persistProtocolSettings(state)
      },
      setUpstreamKeyFillSource: (index, fillSource) => {
        const state = this.store.setUpstreamKeyFillSource(index, fillSource, 'atem-protocol')
        this.persistProtocolSettings(state)
      },
      setUpstreamKeyCutSource: (index, cutSource) => {
        const state = this.store.setUpstreamKeyCutSource(index, cutSource, 'atem-protocol')
        this.persistProtocolSettings(state)
      },
      setDownstreamKey: (index, enabled) => {
        const state = this.store.setDownstreamKey(index, enabled, 'atem-protocol')
        this.persistProtocolSettings(state)
      },
      setDownstreamKeyTie: (index, enabled) => {
        const state = this.store.setDownstreamKeyTie(index, enabled, 'atem-protocol')
        this.persistProtocolSettings(state)
      },
      setDownstreamKeyRate: (index, rate) => {
        const state = this.store.setDownstreamKeyRate(index, rate, 'atem-protocol')
        this.persistProtocolSettings(state)
      },
      autoDownstreamKey: (index, isTowardsOnAir) => {
        const state = this.store.autoDownstreamKey(index, 'atem-protocol', isTowardsOnAir)
        this.persistProtocolSettings(state)
      },
    }
  }

  private persistProtocolSettings(state: AtemState): void {
    void this.persistSettings(state).catch((error: unknown) => {
      this.options.logger.error('Unable to persist an ATEM protocol setting change.', error)
    })
  }

  private getProtocolDeviceProfile(): {
    name: string
    profileId: AtemDeviceProfileId
    videoMode: AtemSandboxConfig['device']['videoMode']
  } {
    return {
      name: this.device.name,
      profileId: this.device.modelId,
      videoMode: this.device.videoMode,
    }
  }

  private async readJsonBody(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > 1_000_000) {
        throw new Error('Request body exceeds 1 MB.')
      }
      chunks.push(buffer)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new Error('Request body must be valid JSON.')
    }
  }

  private async serveWebApplication(path: string, response: ServerResponse): Promise<void> {
    const staticPath = path === '/' ? 'index.html' : path.slice(1)
    if (await this.fileExists(this.webDistDirectory)) {
      const candidate = this.resolveSafePath(this.webDistDirectory, staticPath)
      if (candidate !== undefined && (await this.fileExists(candidate))) {
        await this.streamFile(response, candidate)
        return
      }

      if (path === '/' || path === '/console' || path.startsWith('/output/')) {
        await this.streamFile(response, join(this.webDistDirectory, 'index.html'))
        return
      }
    }

    this.sendJson(response, 404, {
      error:
        'Web UI is not built. Run npm run dev (development) or npm run build (portable runtime).',
    })
  }

  private async serveFile(
    response: ServerResponse,
    root: string,
    relativePath: string,
  ): Promise<void> {
    const candidate = this.resolveSafePath(root, relativePath)
    if (candidate === undefined || !(await this.fileExists(candidate))) {
      this.sendJson(response, 404, { error: 'File not found.' })
      return
    }
    await this.streamFile(response, candidate)
  }

  private resolveSafePath(root: string, candidatePath: string): string | undefined {
    const candidate = resolve(root, candidatePath)
    const relativePath = relative(root, candidate)
    if (relativePath.startsWith('..') || relativePath === '' || relativePath.includes('..\\')) {
      return undefined
    }
    return candidate
  }

  private async streamFile(response: ServerResponse, path: string): Promise<void> {
    const fileStat = await stat(path)
    if (!fileStat.isFile()) {
      this.sendJson(response, 404, { error: 'File not found.' })
      return
    }
    response.writeHead(200, {
      'content-type': mimeTypes[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'content-length': fileStat.size,
      'cache-control': 'no-store',
    })
    createReadStream(path).pipe(response)
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  }

  private broadcastSnapshot(): void {
    this.webSocketServer.clients.forEach((client) => this.sendSnapshot(client))
  }

  private sendSnapshot(client: WebSocket): void {
    if (client.readyState !== WebSocket.OPEN) {
      return
    }
    client.send(
      JSON.stringify({
        type: 'snapshot',
        state: this.store.getState(),
        status: this.getStatus(),
      }),
    )
  }

  private sendJson(response: ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body)
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(json),
      'cache-control': 'no-store',
    })
    response.end(json)
  }

  private handleHttpError(response: ServerResponse, error: unknown): void {
    if (response.headersSent) {
      response.destroy()
      return
    }
    if (error instanceof AtemStateError) {
      this.sendJson(response, 409, { error: error.message, code: error.code })
      return
    }
    if (error instanceof z.ZodError) {
      this.sendJson(response, 400, { error: 'Invalid request.', issues: error.issues })
      return
    }
    const message = error instanceof Error ? error.message : 'Unexpected server error.'
    this.options.logger.error('HTTP request failed.', error)
    this.sendJson(response, 400, { error: message })
  }

  private describeSource(source: SourceRef): string {
    if (source.kind === 'input') {
      return (
        this.store.getState().inputs.find((input) => input.id === source.inputId)?.shortName ??
        `Input ${source.inputId}`
      )
    }
    return source.kind === 'media-player'
      ? this.store.getState().mediaPlayers[source.player].name
      : 'SuperSource'
  }
}

function sourceRefToPersistedId(source: SourceRef | undefined): number {
  if (source === undefined) {
    return 1
  }
  return sourceRefToAtemId(source)
}

export function createSandboxRuntime(options: SandboxRuntimeOptions): SandboxRuntime {
  return new SandboxRuntime(options)
}
