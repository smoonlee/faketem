import { createServer, Server } from 'node:net'
import { Atem } from 'atem-connection'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { createDefaultConfig } from '@atem-sandbox/shared'
import { AtemStateStore } from '@atem-sandbox/atem-state'
import { ConfigRepository } from '../src/config-repository.js'
import { createLogger, type Logger } from '../src/logger.js'
import { createSandboxRuntime, type SandboxRuntime } from '../src/runtime.js'

const logger: Logger = {
  debugEnabled: true,
  getRecentEntries: () => [
    { timestamp: '2026-11-01T12:00:00.000Z', level: 'info', message: 'Runtime test log.' },
  ],
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

let runtime: SandboxRuntime | undefined
const temporaryDirectories: string[] = []

afterEach(async () => {
  await runtime?.stop()
  runtime = undefined
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('SandboxRuntime', () => {
  it('reports the actual port when the web listener uses an ephemeral port', async () => {
    const config = createDefaultConfig()
    config.server.atemPort = 0
    runtime = createSandboxRuntime({
      config,
      configRepository: new ConfigRepository(await temporaryConfigPath()),
      logger,
      portableRoot: process.cwd(),
      webPort: 0,
    })
    await runtime.start()
    const port = runtime.getStatus().webPort
    expect(port).toBeGreaterThan(0)
    expect((await fetch(`http://127.0.0.1:${port}/api/v1/health`)).ok).toBe(true)
  })

  it('supports separate web assets and explicit container listener hosts', async () => {
    const config = createDefaultConfig()
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
    const configPath = await temporaryConfigPath()
    const root = join(configPath, '..')
    const webDistDirectory = join(root, 'web-assets')
    await mkdir(webDistDirectory)
    await writeFile(join(webDistDirectory, 'index.html'), '<html>packaged app</html>')
    const listen = vi.spyOn(Server.prototype, 'listen')
    try {
      runtime = createSandboxRuntime({
        config,
        configRepository: new ConfigRepository(configPath),
        logger,
        portableRoot: root,
        webHost: '0.0.0.0',
        atemHost: '0.0.0.0',
        webDistDirectory,
      })
      await runtime.start()
      expect(listen).toHaveBeenCalledWith(webPort, '0.0.0.0', expect.any(Function))
      expect(runtime.getStatus().host).toBe('0.0.0.0')
      const response = await fetch(`http://127.0.0.1:${webPort}/`)
      expect(await response.text()).toContain('packaged app')
    } finally {
      listen.mockRestore()
    }
  })

  it('serves live in-memory logs without creating log files', async () => {
    const config = createDefaultConfig()
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
    const configPath = await temporaryConfigPath()
    const root = join(configPath, '..')
    const liveLogger = createLogger({ debug: false })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      runtime = createSandboxRuntime({
        config,
        configRepository: new ConfigRepository(configPath),
        logger: liveLogger,
        portableRoot: root,
      })
      await runtime.start()
      liveLogger.debug('Hidden debug entry')
      const before = await fetch(`http://127.0.0.1:${webPort}/api/v1/logs`)
      const beforeSnapshot = (await before.json()) as { entries: { message: string }[] }
      expect(
        beforeSnapshot.entries.some((entry) => entry.message === 'Program changed to CAM3.'),
      ).toBe(false)

      const control = await fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'set-program', source: { kind: 'input', inputId: 3 } }),
      })
      expect(control.ok).toBe(true)

      const response = await fetch(`http://127.0.0.1:${webPort}/api/v1/logs`)
      const snapshot = (await response.json()) as {
        entries: { level: string; message: string }[]
        debugEnabled: boolean
      }
      expect(snapshot.debugEnabled).toBe(false)
      expect(snapshot.entries).toContainEqual(
        expect.objectContaining({ message: 'Program changed to CAM3.' }),
      )
      expect(snapshot.entries.some((entry) => entry.message === 'Hidden debug entry')).toBe(false)
      expect(output).toHaveBeenCalledWith(expect.stringContaining('INFO Program changed to CAM3.'))
      expect(await readdir(root)).toEqual([])
    } finally {
      output.mockRestore()
    }
  })

  it('serves the console page from the built web application', async () => {
    const config = createDefaultConfig()
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
    const configPath = await temporaryConfigPath()
    const root = join(configPath, '..')
    const dist = join(root, 'apps', 'web', 'dist')
    await mkdir(dist, { recursive: true })
    await writeFile(join(dist, 'index.html'), '<html>console app</html>')
    runtime = createSandboxRuntime({
      config,
      configRepository: new ConfigRepository(configPath),
      logger,
      portableRoot: root,
    })
    await runtime.start()

    const response = await fetch(`http://127.0.0.1:${webPort}/console`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('console app')
  })

  it('serves recent logs and the verbose logging state', async () => {
    const config = createDefaultConfig()
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
    runtime = createSandboxRuntime({
      config,
      configRepository: new ConfigRepository(await temporaryConfigPath()),
      logger,
      portableRoot: process.cwd(),
    })
    await runtime.start()

    const response = await fetch(`http://127.0.0.1:${webPort}/api/v1/logs`)
    expect(response.ok).toBe(true)
    await expect(response.json()).resolves.toMatchObject({
      entries: [{ level: 'info', message: 'Runtime test log.' }],
      debugEnabled: true,
    })
  })

  it('accepts microphone and SuperSource controls and rejects invalid microphone values', async () => {
    const config = createDefaultConfig()
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
    runtime = createSandboxRuntime({
      config,
      configRepository: new ConfigRepository(await temporaryConfigPath()),
      logger,
      portableRoot: process.cwd(),
    })
    await runtime.start()
    const control = (command: unknown) =>
      fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      })

    expect(
      (
        await control({
          type: 'set-fairlight-source',
          id: 1301,
          sourceId: '-65280',
          properties: { mixOption: 4, faderGain: -1200 },
        })
      ).status,
    ).toBe(200)
    expect(runtime.store.getState().fairlightAudio.inputs[1301]).toMatchObject({
      mixOption: 4,
      faderGain: -1200,
    })
    expect(
      (
        await control({
          type: 'set-fairlight-source',
          id: 1301,
          sourceId: '-65280',
          properties: { faderGain: 1001 },
        })
      ).status,
    ).toBe(400)
    expect(runtime.store.getState().fairlightAudio.inputs[1301]?.faderGain).toBe(-1200)
    expect((await control({ type: 'set-preview', source: { kind: 'super-source' } })).status).toBe(
      200,
    )
    expect(runtime.store.getState().preview).toEqual({ kind: 'super-source' })
  })

  it('starts the HTTP and ATEM UDP listeners together', async () => {
    const config = createDefaultConfig()
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }

    runtime = createSandboxRuntime({
      config,
      configRepository: new ConfigRepository(
        join(tmpdir(), `atem-sandbox-runtime-${Date.now()}.json`),
      ),
      logger,
      portableRoot: process.cwd(),
    })
    await runtime.start()

    const status = runtime.getStatus()
    expect(status.atemProtocol).toBe('listening')
    expect(status.atemPort).toBeGreaterThan(0)
    expect(status.atemClients).toBe(0)

    const health = await fetch(`http://127.0.0.1:${webPort}/api/v1/health`)
    expect(health.ok).toBe(true)
    await expect(health.json()).resolves.toEqual({ ok: true, protocol: 'listening' })
  })

  it('rejects browser control requests from non-local origins', async () => {
    const config = createDefaultConfig()
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
    runtime = createSandboxRuntime({
      config,
      configRepository: new ConfigRepository(await temporaryConfigPath()),
      logger,
      portableRoot: process.cwd(),
    })
    await runtime.start()

    const response = await fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://attacker.example',
      },
      body: JSON.stringify({ type: 'set-preview', source: { kind: 'input', inputId: 1 } }),
    })

    expect(response.status).toBe(403)
    expect(runtime.store.getState().preview).toEqual({ kind: 'input', inputId: 2 })

    const localResponse = await fetch(`http://127.0.0.1:${webPort}/api/v1/state`, {
      headers: { origin: 'http://localhost:5173' },
    })
    expect(localResponse.status).toBe(200)
  })

  it('rejects WebSocket connections from non-local origins', async () => {
    const config = createDefaultConfig()
    const webPort = await getFreeTcpPort()
    config.server = { host: '0.0.0.0', webPort, atemPort: 0 }
    runtime = createSandboxRuntime({
      config,
      configRepository: new ConfigRepository(await temporaryConfigPath()),
      logger,
      portableRoot: process.cwd(),
    })
    await runtime.start()

    const socket = new WebSocket(`ws://127.0.0.1:${webPort}/ws`, {
      origin: 'https://attacker.example',
    })
    await new Promise<void>((resolve, reject) => {
      socket.once('error', () => resolve())
      socket.once('open', () => {
        socket.close()
        reject(new Error('Expected the remote-origin WebSocket upgrade to be rejected.'))
      })
    })
  })

  it('updates device settings without resetting live routing', async () => {
    const config = createDefaultConfig()
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
    const configRepository = new ConfigRepository(await temporaryConfigPath())
    await configRepository.loadOrCreate()
    runtime = createSandboxRuntime({
      config,
      configRepository,
      logger,
      portableRoot: process.cwd(),
    })
    await runtime.start()

    const routeResponse = await fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'set-preview', source: { kind: 'input', inputId: 3 } }),
    })
    expect(routeResponse.status).toBe(200)

    const response = await fetch(`http://127.0.0.1:${webPort}/api/v1/device-settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Rehearsal Switcher', videoMode: '1080p25' }),
    })
    expect(response.status).toBe(200)
    const result = (await response.json()) as {
      state: { preview: { kind: string; inputId: number }; settings: { videoModeCode: number } }
      status: { deviceName: string; videoMode: string }
    }
    expect(result.state.preview).toEqual({ kind: 'input', inputId: 3 })
    expect(result.state.settings.videoModeCode).toBe(10)
    expect(result.status).toMatchObject({ deviceName: 'Rehearsal Switcher', videoMode: '1080p25' })

    await configRepository.flush()
    expect(configRepository.get().device).toMatchObject({
      name: 'Rehearsal Switcher',
      videoMode: '1080p25',
    })
  })

  it('updates and persists Media Player names', async () => {
    const config = createDefaultConfig()
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
    const configRepository = new ConfigRepository(await temporaryConfigPath())
    await configRepository.loadOrCreate()
    runtime = createSandboxRuntime({
      config,
      configRepository,
      logger,
      portableRoot: process.cwd(),
    })
    await runtime.start()

    const response = await fetch(`http://127.0.0.1:${webPort}/api/v1/media-players/1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Presentation' }),
    })
    expect(response.status).toBe(200)
    expect(runtime.store.getState().mediaPlayers[1].name).toBe('Presentation')
    await configRepository.flush()
    expect(configRepository.get().mediaPlayers[1].name).toBe('Presentation')
  })

  it('resets the sandbox for a supported device profile and leaves it unchanged after an invalid request', async () => {
    const config = createDefaultConfig()
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
    const configRepository = new ConfigRepository(await temporaryConfigPath())
    await configRepository.loadOrCreate()

    runtime = createSandboxRuntime({
      config,
      configRepository,
      logger,
      portableRoot: process.cwd(),
    })
    await runtime.start()

    const update = await fetch(`http://127.0.0.1:${webPort}/api/v1/device-profile`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'atem-mini-pro-iso' }),
    })
    expect(update.status).toBe(200)
    const updated = (await update.json()) as {
      status: {
        deviceProfileId: string
        deviceModel: string
        deviceProfiles: Array<{ id: string; label: string }>
      }
      state: {
        inputs: Array<{ id: number; longName: string; shortName: string }>
        program: { kind: string; inputId: number }
        preview: { kind: string; inputId: number }
      }
    }
    expect(updated.status).toMatchObject({
      deviceProfileId: 'atem-mini-pro-iso',
      deviceModel: 'ATEM Mini Pro ISO',
    })
    expect(updated.status.deviceProfiles).toContainEqual({
      id: 'atem-mini-pro-iso',
      label: 'ATEM Mini Pro ISO',
    })
    expect(updated.status.deviceProfiles.map((profile) => profile.id)).toEqual([
      'atem-mini-extreme-iso-g2',
      'atem-mini-extreme-iso',
      'atem-mini-pro-iso',
      'atem-mini-pro',
    ])
    expect(updated.state.inputs).toHaveLength(4)
    expect(updated.state.inputs.map(({ longName, shortName }) => [longName, shortName])).toEqual([
      ['Camera 1', 'CAM1'],
      ['Camera 2', 'CAM2'],
      ['Camera 3', 'CAM3'],
      ['Camera 4', 'CAM4'],
    ])
    expect(updated.state.program).toEqual({ kind: 'input', inputId: 1 })
    expect(updated.state.preview).toEqual({ kind: 'input', inputId: 2 })
    expect(runtime.getStatus()).toMatchObject({
      deviceProfileId: 'atem-mini-pro-iso',
      deviceModel: 'ATEM Mini Pro ISO',
    })
    expect(runtime.store.getState().inputs).toHaveLength(4)

    await configRepository.flush()
    const persistedConfig = JSON.parse(await readFile(configRepository.configPath, 'utf8')) as {
      device: { model: string; modelId: string }
      inputs: Array<{ id: number; longName: string; shortName: string }>
    }
    expect(persistedConfig.device).toEqual({
      ...persistedConfig.device,
      model: 'ATEM Mini Pro ISO',
      modelId: 'atem-mini-pro-iso',
    })
    expect(persistedConfig.inputs).toHaveLength(4)
    expect(persistedConfig.inputs.map(({ longName, shortName }) => [longName, shortName])).toEqual([
      ['Camera 1', 'CAM1'],
      ['Camera 2', 'CAM2'],
      ['Camera 3', 'CAM3'],
      ['Camera 4', 'CAM4'],
    ])
    const persistedText = await readFile(configRepository.configPath, 'utf8')

    const invalid = await fetch(`http://127.0.0.1:${webPort}/api/v1/device-profile`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'not-an-atem-profile' }),
    })
    expect(invalid.status).toBe(400)
    expect(runtime.getStatus().deviceProfileId).toBe('atem-mini-pro-iso')
    await configRepository.flush()
    await expect(readFile(configRepository.configPath, 'utf8')).resolves.toBe(persistedText)
  })

  it('exports and imports a complete validated sandbox profile', async () => {
    const config = createDefaultConfig()
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
    const configRepository = new ConfigRepository(await temporaryConfigPath())
    await configRepository.loadOrCreate()

    runtime = createSandboxRuntime({
      config,
      configRepository,
      logger,
      portableRoot: process.cwd(),
    })
    await runtime.start()

    const exportedResponse = await fetch(`http://127.0.0.1:${webPort}/api/v1/sandbox/export`)
    expect(exportedResponse.status).toBe(200)
    expect(exportedResponse.headers.get('content-type')).toContain('application/json')
    expect(exportedResponse.headers.get('content-disposition')).toBe(
      'attachment; filename="atem-sandbox.json"',
    )
    const imported = (await exportedResponse.json()) as ReturnType<typeof createDefaultConfig>

    imported.server.webPort += 1
    imported.device.name = 'Imported Sandbox'
    imported.transition.rateFrames = 12
    imported.initialState = { program: 2, preview: 1 }
    const firstInput = imported.inputs[0]
    if (firstInput === undefined) {
      throw new Error('Default profile must include Input 1.')
    }
    imported.inputs[0] = {
      ...firstInput,
      longName: 'Imported Camera',
      shortName: 'IMP1',
    }
    imported.mediaPlayers[1] = { ...imported.mediaPlayers[1], name: 'Playback' }
    const firstStill = imported.mediaPool.stills[0]
    if (firstStill?.type !== 'generated') {
      throw new Error('Default profile must include a generated first still.')
    }
    imported.mediaPool.stills[0] = {
      ...firstStill,
      name: 'Imported Still',
      text: 'IMPORTED',
    }

    const importResponse = await fetch(`http://127.0.0.1:${webPort}/api/v1/sandbox/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(imported),
    })
    expect(importResponse.status).toBe(200)
    const importResult = (await importResponse.json()) as {
      restartRequired: boolean
      status: { webPort: number }
      state: {
        program: { kind: string; inputId: number }
        preview: { kind: string; inputId: number }
        transition: { rateFrames: number }
        inputs: Array<{ id: number; longName: string; shortName: string }>
        mediaPlayers: Record<1 | 2, { name: string }>
        mediaPool: { stills: Array<{ slot: number; name: string; text?: string }> }
      }
    }
    expect(importResult.restartRequired).toBe(true)
    expect(importResult.status.webPort).toBe(webPort)
    expect(importResult.state.program).toEqual({ kind: 'input', inputId: 2 })
    expect(importResult.state.preview).toEqual({ kind: 'input', inputId: 1 })
    expect(importResult.state.transition.rateFrames).toBe(12)
    expect(importResult.state.inputs.find((input) => input.id === 1)).toMatchObject({
      longName: 'Imported Camera',
      shortName: 'IMP1',
    })
    expect(importResult.state.mediaPlayers[1].name).toBe('Playback')
    expect(importResult.state.mediaPool.stills.find((still) => still.slot === 1)).toMatchObject({
      name: 'Imported Still',
      text: 'IMPORTED',
    })
    expect(runtime.store.getState()).toMatchObject({
      program: { kind: 'input', inputId: 2 },
      preview: { kind: 'input', inputId: 1 },
      transition: { rateFrames: 12 },
      mediaPlayers: { 1: { name: 'Playback' } },
    })
    expect(runtime.getStatus()).toMatchObject({ deviceName: 'Imported Sandbox', webPort })

    await configRepository.flush()
    expect(configRepository.get()).toEqual(imported)

    const invalid = await fetch(`http://127.0.0.1:${webPort}/api/v1/sandbox/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1 }),
    })
    expect(invalid.status).toBe(400)
    expect(runtime.store.getState().mediaPlayers[1].name).toBe('Playback')
    expect(configRepository.get()).toEqual(imported)

    const exportedAfterImport = await fetch(`http://127.0.0.1:${webPort}/api/v1/sandbox/export`)
    await expect(exportedAfterImport.json()).resolves.toEqual(imported)
  })

  it('persists an editable Media Player label and rejects invalid labels', async () => {
    const config = createDefaultConfig()
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
    const configRepository = new ConfigRepository(await temporaryConfigPath())
    await configRepository.loadOrCreate()

    runtime = createSandboxRuntime({
      config,
      configRepository,
      logger,
      portableRoot: process.cwd(),
    })
    await runtime.start()

    const update = await fetch(`http://127.0.0.1:${webPort}/api/v1/media-players/1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Lyrics' }),
    })
    expect(update.status).toBe(200)
    const updated = (await update.json()) as {
      state: { mediaPlayers: Record<1 | 2, { name: string }> }
    }
    expect(updated.state.mediaPlayers[1].name).toBe('Lyrics')
    expect(runtime.store.getState().mediaPlayers[1].name).toBe('Lyrics')

    await configRepository.flush()
    const persistedConfig = JSON.parse(await readFile(configRepository.configPath, 'utf8')) as {
      mediaPlayers: Record<1 | 2, { name: string }>
    }
    expect(persistedConfig.mediaPlayers[1].name).toBe('Lyrics')

    const invalid = await fetch(`http://127.0.0.1:${webPort}/api/v1/media-players/1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    })
    expect(invalid.status).toBe(400)
    expect(runtime.store.getState().mediaPlayers[1].name).toBe('Lyrics')

    const missing = await fetch(`http://127.0.0.1:${webPort}/api/v1/media-players/3`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Unused' }),
    })
    expect(missing.status).toBe(404)
  })

  it('creates a custom generated Media Pool still and persists it', async () => {
    const config = createDefaultConfig()
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
    const configRepository = new ConfigRepository(await temporaryConfigPath())
    await configRepository.loadOrCreate()

    runtime = createSandboxRuntime({
      config,
      configRepository,
      logger,
      portableRoot: process.cwd(),
    })
    await runtime.start()

    const create = await fetch(`http://127.0.0.1:${webPort}/api/v1/media-pool/stills`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Lyrics Lower Third',
        text: 'VERSE 1',
        background: '#123456',
        foreground: '#ABCDEF',
      }),
    })

    expect(create.status).toBe(200)
    const created = (await create.json()) as {
      state: {
        mediaPool: {
          stills: Array<{
            slot: number
            type: 'generated' | 'image'
            name: string
            text?: string
            background?: string
            foreground?: string
          }>
        }
      }
    }

    const createdStill = created.state.mediaPool.stills.find((still) => still.slot === 3)
    expect(createdStill).toMatchObject({
      type: 'generated',
      name: 'Lyrics Lower Third',
      text: 'VERSE 1',
      background: '#123456',
      foreground: '#ABCDEF',
    })

    await configRepository.flush()
    const persistedConfig = JSON.parse(await readFile(configRepository.configPath, 'utf8')) as {
      mediaPool: {
        stills: Array<{
          slot: number
          name: string
          text?: string
        }>
      }
    }
    expect(persistedConfig.mediaPool.stills.find((still) => still.slot === 3)).toMatchObject({
      name: 'Lyrics Lower Third',
      text: 'VERSE 1',
    })

    const remove = await fetch(`http://127.0.0.1:${webPort}/api/v1/media-pool/stills/3`, {
      method: 'DELETE',
    })
    expect(remove.status).toBe(200)
    const removed = (await remove.json()) as {
      state: {
        mediaPool: {
          stills: Array<{ slot: number }>
        }
      }
    }
    expect(removed.state.mediaPool.stills.some((still) => still.slot === 3)).toBe(false)

    const unassignDefaultSlot1 = await fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'select-media-player-still',
        player: 1,
        slot: 2,
      }),
    })
    expect(unassignDefaultSlot1.status).toBe(200)

    const defaultDelete = await fetch(`http://127.0.0.1:${webPort}/api/v1/media-pool/stills/1`, {
      method: 'DELETE',
    })
    expect(defaultDelete.status).toBe(409)
    const defaultDeleteResponse = (await defaultDelete.json()) as { error: string }
    expect(defaultDeleteResponse.error).toContain('default Media Pool items')
  })

  it('resets sandbox configuration to defaults with confirmation endpoint semantics', async () => {
    const config = createDefaultConfig()
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
    const configRepository = new ConfigRepository(await temporaryConfigPath())
    await configRepository.loadOrCreate()

    runtime = createSandboxRuntime({
      config,
      configRepository,
      logger,
      portableRoot: process.cwd(),
    })
    await runtime.start()

    const customizedImport = createDefaultConfig()
    customizedImport.server = { host: '127.0.0.1', webPort: webPort + 1, atemPort: 12345 }
    customizedImport.inputs[0] = {
      ...customizedImport.inputs[0]!,
      longName: 'Custom Camera',
      shortName: 'CUST1',
    }
    customizedImport.mediaPool.stills.push({
      slot: 3,
      type: 'generated',
      name: 'Custom Lower Third',
      background: '#123456',
      foreground: '#FFFFFF',
      text: 'HELLO',
    })

    const importResponse = await fetch(`http://127.0.0.1:${webPort}/api/v1/sandbox/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(customizedImport),
    })
    expect(importResponse.status).toBe(200)

    const resetResponse = await fetch(`http://127.0.0.1:${webPort}/api/v1/sandbox/reset-default`, {
      method: 'POST',
    })
    expect(resetResponse.status).toBe(200)
    const reset = (await resetResponse.json()) as {
      status: { webPort: number; atemPort: number }
      state: {
        inputs: Array<{ id: number; longName: string; shortName: string }>
        mediaPool: { stills: Array<{ slot: number; name: string }> }
      }
    }

    expect(reset.status.webPort).toBe(webPort)
    expect(reset.status.atemPort).toBeGreaterThan(0)
    expect(reset.state.inputs.find((input) => input.id === 1)).toMatchObject({
      longName: 'Camera 1',
      shortName: 'CAM1',
    })
    expect(reset.state.mediaPool.stills.map((still) => still.slot)).toEqual([1, 2])
    expect(reset.state.mediaPool.stills.find((still) => still.slot === 1)?.name).toBe(
      'Media Player #1',
    )
  })

  it('persists upstream and downstream keyer state changes', async () => {
    const config = createDefaultConfig('atem-mini-extreme-iso')
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
    const configRepository = new ConfigRepository(await temporaryConfigPath())
    await configRepository.loadOrCreate()

    runtime = createSandboxRuntime({
      config,
      configRepository,
      logger,
      portableRoot: process.cwd(),
    })
    await runtime.start()

    const usk = await fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'set-upstream-key', index: 1, enabled: true }),
    })
    expect(usk.status).toBe(200)

    const dsk = await fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'set-downstream-key', index: 2, enabled: true }),
    })
    expect(dsk.status).toBe(200)

    expect(runtime.store.getState().upstreamKeys[1]).toBe(true)
    expect(runtime.store.getState().downstreamKeys[2]!.onAir).toBe(true)

    await configRepository.flush()
    const persistedConfig = JSON.parse(await readFile(configRepository.configPath, 'utf8')) as {
      keyers: {
        upstream: Record<1 | 2 | 3 | 4, boolean>
        downstream: Record<1 | 2, { onAir: boolean; tie: boolean; rate: number }>
      }
    }
    expect(persistedConfig.keyers.upstream[1]).toBe(true)
    expect(persistedConfig.keyers.downstream[2].onAir).toBe(true)
  })

  it('persists luma settings received over ATEM and restores them on startup', async () => {
    const config = createDefaultConfig()
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
    const configRepository = new ConfigRepository(await temporaryConfigPath())
    await configRepository.loadOrCreate()
    runtime = createSandboxRuntime({
      config,
      configRepository,
      logger,
      portableRoot: process.cwd(),
    })
    await runtime.start()

    const client = new Atem()
    try {
      const connected = new Promise<void>((resolve) => client.once('connected', resolve))
      await client.connect('127.0.0.1', runtime.getStatus().atemPort)
      await connected
      await client.setUpstreamKeyerLumaSettings({ clip: 250, gain: 600, invert: true }, 0, 0)
      await waitForCondition(() => runtime!.store.getState().upstreamKeyLuma[1]?.gain === 600)
      await configRepository.flush()
      const reloaded = await new ConfigRepository(configRepository.configPath).loadOrCreate()
      expect(reloaded.keyers.upstreamLuma?.[1]).toEqual({
        preMultiplied: false,
        clip: 250,
        gain: 600,
        invert: true,
      })
      const restored = new AtemStateStore(reloaded)
      expect(restored.getState().upstreamKeyLuma[1]).toEqual(reloaded.keyers.upstreamLuma?.[1])
      restored.dispose()
    } finally {
      await client.destroy()
    }
  })

  it('persists macros recorded over ATEM and restores them on startup', async () => {
    const config = createDefaultConfig()
    config.server = { host: '127.0.0.1', webPort: await getFreeTcpPort(), atemPort: 0 }
    const repository = new ConfigRepository(await temporaryConfigPath())
    await repository.loadOrCreate()
    runtime = createSandboxRuntime({
      config,
      configRepository: repository,
      logger,
      portableRoot: process.cwd(),
    })
    await runtime.start()
    const client = new Atem()
    try {
      const connected = new Promise<void>((resolve) => client.once('connected', resolve))
      await client.connect('127.0.0.1', runtime.getStatus().atemPort)
      await connected
      await client.macroStartRecord(2, 'Saved', 'Routing')
      await waitForCondition(() => runtime!.store.getState().macro.macroRecorder.isRecording)
      await client.changeProgramInput(3)
      await waitForCondition(
        () =>
          runtime!.store.getState().program.kind === 'input' &&
          (runtime!.store.getState().program as { inputId: number }).inputId === 3,
      )
      await client.macroStopRecord()
      await waitForCondition(() => !runtime!.store.getState().macro.macroRecorder.isRecording)
      await repository.flush()
      const reloaded = await new ConfigRepository(repository.configPath).loadOrCreate()
      expect(reloaded.macros?.[2]).toMatchObject({
        name: 'Saved',
        operations: [{ type: 'set-program', source: { kind: 'input', inputId: 3 } }],
      })
      const exported = await fetch(
        `http://127.0.0.1:${config.server.webPort}/api/v1/sandbox/export`,
      )
      const exportedConfig = (await exported.json()) as typeof reloaded
      expect(exportedConfig.macros?.[2]).toEqual(reloaded.macros?.[2])
      const restored = new AtemStateStore(reloaded)
      restored.macroRun(2, 'api')
      await waitForCondition(() => !restored.getState().macro.macroPlayer.isRunning)
      expect(restored.getState().program).toEqual({ kind: 'input', inputId: 3 })
      restored.dispose()
    } finally {
      await client.destroy()
    }
  })

  it('updates recording and streaming state for every supported profile through the control API', async () => {
    const profiles = [
      'atem-mini-extreme-iso-g2',
      'atem-mini-extreme-iso',
      'atem-mini-pro-iso',
      'atem-mini-pro',
    ] as const

    for (const profile of profiles) {
      const config = createDefaultConfig(profile)
      const webPort = await getFreeTcpPort()
      config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
      const configRepository = new ConfigRepository(await temporaryConfigPath())
      await configRepository.loadOrCreate()

      runtime = createSandboxRuntime({
        config,
        configRepository,
        logger,
        portableRoot: process.cwd(),
      })
      await runtime.start()

      const recordOn = await fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'set-recording-status', enabled: true }),
      })
      expect(recordOn.status).toBe(200)
      expect(runtime.store.getState().recording.status.state).not.toBe(0)

      const streamOn = await fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'set-streaming-status', enabled: true }),
      })
      expect(streamOn.status).toBe(200)
      expect(runtime.store.getState().streaming.status.state).not.toBe(1)

      const recordOff = await fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'set-recording-status', enabled: false }),
      })
      expect(recordOff.status).toBe(200)
      expect(runtime.store.getState().recording.status.state).toBe(0)

      const streamOff = await fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'set-streaming-status', enabled: false }),
      })
      expect(streamOff.status).toBe(200)
      await waitForCondition(() => runtime?.store.getState().streaming.status.state === 1)

      await runtime.stop()
      runtime = undefined
    }
  })

  it('persists downstream key tie, rate, and auto commands', async () => {
    const config = createDefaultConfig('atem-mini-extreme-iso')
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
    const configRepository = new ConfigRepository(await temporaryConfigPath())
    await configRepository.loadOrCreate()

    runtime = createSandboxRuntime({
      config,
      configRepository,
      logger,
      portableRoot: process.cwd(),
    })
    await runtime.start()

    await fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'set-downstream-key-tie', index: 1, enabled: true }),
    })
    await fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'set-downstream-key-rate', index: 1, rate: 42 }),
    })
    await fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'auto-downstream-key', index: 1 }),
    })

    expect(runtime.store.getState().downstreamKeys[1]).toMatchObject({
      tie: true,
      rate: 42,
      onAir: true,
      isAuto: true,
    })

    await configRepository.flush()
    const persistedConfig = JSON.parse(await readFile(configRepository.configPath, 'utf8')) as {
      keyers: {
        downstream: Record<1 | 2, { onAir: boolean; tie: boolean; rate: number }>
      }
    }
    expect(persistedConfig.keyers.downstream[1]).toEqual({ onAir: true, tie: true, rate: 42 })
  })

  it('persists upstream key type, fill, and cut commands', async () => {
    const config = createDefaultConfig('atem-mini-extreme-iso')
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
    const configRepository = new ConfigRepository(await temporaryConfigPath())
    await configRepository.loadOrCreate()

    runtime = createSandboxRuntime({
      config,
      configRepository,
      logger,
      portableRoot: process.cwd(),
    })
    await runtime.start()

    await fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'set-upstream-key-type', index: 1, mixEffectKeyType: 2 }),
    })
    await fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'set-upstream-key-fill-source', index: 1, fillSource: 3010 }),
    })
    await fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'set-upstream-key-cut-source', index: 1, cutSource: 2 }),
    })

    expect(runtime.store.getState().upstreamKeyProperties[1]).toMatchObject({
      mixEffectKeyType: 2,
      fillSource: 3010,
      cutSource: 2,
    })

    await configRepository.flush()
    const persistedConfig = JSON.parse(await readFile(configRepository.configPath, 'utf8')) as {
      keyers: {
        upstreamSettings: Record<
          1 | 2 | 3 | 4,
          { mixEffectKeyType: number; flyEnabled: boolean; fillSource: number; cutSource: number }
        >
      }
    }
    expect(persistedConfig.keyers.upstreamSettings[1]).toEqual({
      mixEffectKeyType: 2,
      flyEnabled: false,
      fillSource: 3010,
      cutSource: 2,
    })
  })

  it('persists the fade-to-black rate across a runtime restart', async () => {
    const config = createDefaultConfig()
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
    const configRepository = new ConfigRepository(await temporaryConfigPath())
    await configRepository.loadOrCreate()

    runtime = createSandboxRuntime({
      config,
      configRepository,
      logger,
      portableRoot: process.cwd(),
    })
    await runtime.start()

    const response = await fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'set-fade-to-black-rate', rate: 42 }),
    })
    expect(response.status).toBe(200)
    expect(runtime.store.getState().fadeToBlack.rate).toBe(42)

    const mediaPoolResponse = await fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'set-media-pool-settings',
        maxFrames: [100, 125, 150, 175],
        unassignedFrames: 450,
      }),
    })
    expect(mediaPoolResponse.status).toBe(200)
    expect(runtime.store.getState().settings.mediaPool).toEqual({
      maxFrames: [100, 125, 150, 175],
      unassignedFrames: 450,
    })

    await configRepository.flush()
    const persistedConfig = JSON.parse(await readFile(configRepository.configPath, 'utf8')) as {
      transition: { fadeToBlackRate?: number }
      mediaPool: { settings?: { maxFrames: number[]; unassignedFrames: number } }
    }
    expect(persistedConfig.transition.fadeToBlackRate).toBe(42)
    expect(persistedConfig.mediaPool.settings).toEqual({
      maxFrames: [100, 125, 150, 175],
      unassignedFrames: 450,
    })

    await runtime.stop()
    runtime = undefined
    const reloadedRepository = new ConfigRepository(configRepository.configPath)
    const reloadedConfig = await reloadedRepository.loadOrCreate()
    const reloadedStore = new AtemStateStore(reloadedConfig)
    expect(reloadedStore.getState().fadeToBlack.rate).toBe(42)
    expect(reloadedStore.getState().settings.mediaPool).toEqual({
      maxFrames: [100, 125, 150, 175],
      unassignedFrames: 450,
    })
    reloadedStore.dispose()
  })

  it('persists auxiliary routing changes', async () => {
    const config = createDefaultConfig('atem-mini-extreme-iso')
    const webPort = await getFreeTcpPort()
    config.server = { host: '127.0.0.1', webPort, atemPort: 0 }
    const configRepository = new ConfigRepository(await temporaryConfigPath())
    await configRepository.loadOrCreate()

    runtime = createSandboxRuntime({
      config,
      configRepository,
      logger,
      portableRoot: process.cwd(),
    })
    await runtime.start()

    const response = await fetch(`http://127.0.0.1:${webPort}/api/v1/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'set-aux-source',
        bus: 2,
        source: { kind: 'media-player', player: 1 },
      }),
    })
    expect(response.status).toBe(200)
    expect(runtime.store.getState().auxiliaries[2]).toEqual({ kind: 'media-player', player: 1 })

    await configRepository.flush()
    const persistedConfig = JSON.parse(await readFile(configRepository.configPath, 'utf8')) as {
      auxiliaries: Record<1 | 2 | 3 | 4, number>
    }
    expect(persistedConfig.auxiliaries[2]).toBe(3010)
  })
})

async function temporaryConfigPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'atem-sandbox-runtime-'))
  temporaryDirectories.push(directory)
  return join(directory, 'config.json')
}

async function getFreeTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('Could not determine a free TCP port.')))
        return
      }
      server.close((error) => {
        if (error === undefined) {
          resolve(address.port)
        } else {
          reject(error)
        }
      })
    })
  })
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1_500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for expected runtime state.')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
