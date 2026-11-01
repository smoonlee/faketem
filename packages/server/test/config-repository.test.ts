import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultConfig } from '@atem-sandbox/shared'
import { ConfigRepository, ConfigValidationError } from '../src/config-repository.js'

const temporaryDirectories: string[] = []

async function temporaryConfigPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'atem-sandbox-config-'))
  temporaryDirectories.push(directory)
  return join(directory, 'config.json')
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('ConfigRepository', () => {
  it('creates a validated portable default config when one is missing', async () => {
    const configPath = await temporaryConfigPath()
    const repository = new ConfigRepository(configPath)

    const config = await repository.loadOrCreate()

    expect(config.server.atemPort).toBe(9910)
    expect(config.inputs).toHaveLength(8)
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(config)
  })

  it('reports invalid configuration without overwriting the original file', async () => {
    const configPath = await temporaryConfigPath()
    const invalidConfig = '{"version":1,"inputs":[]}'
    await writeFile(configPath, invalidConfig, 'utf8')
    const repository = new ConfigRepository(configPath)

    await expect(repository.loadOrCreate()).rejects.toBeInstanceOf(ConfigValidationError)
    await expect(repository.loadOrCreate()).rejects.toThrow('server')
    expect(await readFile(configPath, 'utf8')).toBe(invalidConfig)
  })

  it('serializes valid updates back to the active profile', async () => {
    const configPath = await temporaryConfigPath()
    const repository = new ConfigRepository(configPath)
    await repository.loadOrCreate()

    const updated = await repository.update((config) => ({
      ...config,
      transition: { ...config.transition, rateFrames: 12 },
    }))

    expect(updated.transition.rateFrames).toBe(12)
    expect(JSON.parse(await readFile(configPath, 'utf8')).transition.rateFrames).toBe(12)
  })

  it('replaces an entire validated profile without changing the active file for invalid input', async () => {
    const configPath = await temporaryConfigPath()
    const repository = new ConfigRepository(configPath)
    const original = await repository.loadOrCreate()

    await expect(repository.replace({ version: 1 })).rejects.toBeInstanceOf(ConfigValidationError)
    expect(repository.get()).toEqual(original)
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(original)

    const replacement = {
      ...original,
      device: { ...original.device, name: 'Imported Sandbox' },
      transition: { ...original.transition, rateFrames: 12 },
    }
    await expect(repository.replace(replacement)).resolves.toEqual(replacement)
    expect(repository.get()).toEqual(replacement)
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(replacement)
  })

  it('migrates a removed device profile ID to the default Mini profile when loading', async () => {
    const configPath = await temporaryConfigPath()
    const legacyConfig = JSON.parse(JSON.stringify(createDefaultConfig())) as {
      device: { model: string; modelId?: string }
    }
    legacyConfig.device.model = 'ATEM SDI Extreme ISO'
    legacyConfig.device.modelId = 'atem-sdi-extreme-iso'
    await writeFile(configPath, JSON.stringify(legacyConfig), 'utf8')

    const config = await new ConfigRepository(configPath).loadOrCreate()

    expect(config.device).toMatchObject({
      model: 'ATEM Mini Extreme ISO (Gen 1)',
      modelId: 'atem-mini-extreme-iso',
    })
  })

  it('uses the default profile ID for an unrecognized legacy model', async () => {
    const configPath = await temporaryConfigPath()
    const legacyConfig = JSON.parse(JSON.stringify(createDefaultConfig())) as {
      device: { model: string; modelId?: string }
    }
    legacyConfig.device.model = 'A legacy model that is not in the v1 catalog'
    delete legacyConfig.device.modelId
    await writeFile(configPath, JSON.stringify(legacyConfig), 'utf8')

    const config = await new ConfigRepository(configPath).loadOrCreate()

    expect(config.device).toMatchObject({
      model: 'ATEM Mini Extreme ISO (Gen 1)',
      modelId: 'atem-mini-extreme-iso',
    })
  })

  it('migrates a removed Mini Extreme profile to Mini Extreme ISO (Gen 1)', async () => {
    const configPath = await temporaryConfigPath()
    const legacyConfig = JSON.parse(JSON.stringify(createDefaultConfig())) as {
      device: { model: string; modelId?: string }
    }
    legacyConfig.device.model = 'ATEM Mini Extreme'
    legacyConfig.device.modelId = 'atem-mini-extreme'
    await writeFile(configPath, JSON.stringify(legacyConfig), 'utf8')

    const config = await new ConfigRepository(configPath).loadOrCreate()

    expect(config.device).toMatchObject({
      model: 'ATEM Mini Extreme ISO (Gen 1)',
      modelId: 'atem-mini-extreme-iso',
    })
  })

  it('loads a legacy eight-input Mini Pro profile as a four-input sandbox', async () => {
    const configPath = await temporaryConfigPath()
    const legacyConfig = createDefaultConfig('atem-mini-pro')
    legacyConfig.inputs = createDefaultConfig().inputs
    legacyConfig.initialState = { program: 5, preview: 6 }
    await writeFile(configPath, JSON.stringify(legacyConfig), 'utf8')

    const config = await new ConfigRepository(configPath).loadOrCreate()

    expect(config.inputs).toHaveLength(4)
    expect(config.inputs.map((input) => input.id)).toEqual([1, 2, 3, 4])
    expect(config.initialState).toEqual({ program: 1, preview: 2 })
    // Startup compatibility does not overwrite a user's old portable file.
    expect(JSON.parse(await readFile(configPath, 'utf8')).inputs).toHaveLength(8)
  })

  it('remaps legacy Media Player 2 source references on one-player Mini Pro profiles', async () => {
    const configPath = await temporaryConfigPath()
    const legacyConfig = createDefaultConfig('atem-mini-pro')
    legacyConfig.initialState = { program: 3020, preview: 3020 }
    legacyConfig.auxiliaries[2] = 3020
    legacyConfig.keyers.upstreamSettings[1].fillSource = 3020
    legacyConfig.keyers.upstreamSettings[1].cutSource = 3020
    await writeFile(configPath, JSON.stringify(legacyConfig), 'utf8')

    const config = await new ConfigRepository(configPath).loadOrCreate()

    expect(config.initialState).toEqual({ program: 3010, preview: 3010 })
    expect(config.auxiliaries[2]).toBe(3010)
    expect(config.keyers.upstreamSettings[1]).toMatchObject({
      fillSource: 3010,
      cutSource: 3010,
    })
  })

  it('rejects profile updates that reference unavailable Media Player 2 sources', async () => {
    const configPath = await temporaryConfigPath()
    const repository = new ConfigRepository(configPath)
    await repository.loadOrCreate()

    await expect(
      repository.replace({
        ...createDefaultConfig('atem-mini-pro'),
        initialState: { program: 3020, preview: 1 },
      }),
    ).rejects.toThrow('Media Player 2 is not available on ATEM Mini Pro')
  })

  it('adds default labels when loading a legacy Media Player configuration', async () => {
    const configPath = await temporaryConfigPath()
    const legacyConfig = JSON.parse(JSON.stringify(createDefaultConfig())) as {
      mediaPlayers: { 1: { name?: string }; 2: { name?: string } }
    }
    delete legacyConfig.mediaPlayers[1].name
    delete legacyConfig.mediaPlayers[2].name
    await writeFile(configPath, JSON.stringify(legacyConfig), 'utf8')

    const config = await new ConfigRepository(configPath).loadOrCreate()

    expect(config.mediaPlayers).toMatchObject({
      1: { name: 'Media Player 1' },
      2: { name: 'Media Player 2' },
    })
  })

  it('migrates legacy keyer settings to the structured keyer format', async () => {
    const configPath = await temporaryConfigPath()
    const legacyConfig = JSON.parse(JSON.stringify(createDefaultConfig())) as {
      keyers: {
        upstream: { 1: boolean; 2: boolean; 3: boolean; 4: boolean }
        downstream: { 1: boolean; 2: boolean }
        upstreamSettings?: unknown
      }
    }
    delete legacyConfig.keyers.upstreamSettings
    legacyConfig.keyers.upstream[1] = true
    legacyConfig.keyers.downstream[1] = true
    legacyConfig.keyers.downstream[2] = false

    await writeFile(configPath, JSON.stringify(legacyConfig), 'utf8')

    const config = await new ConfigRepository(configPath).loadOrCreate()

    expect(config.keyers.upstream).toMatchObject({ 1: true, 2: false, 3: false, 4: false })
    expect(config.keyers.upstreamSettings[1]).toMatchObject({
      mixEffectKeyType: 0,
      flyEnabled: false,
      fillSource: 1,
      cutSource: 2,
    })
    expect(config.keyers.downstream[1]).toMatchObject({ onAir: true, tie: false, rate: 25 })
    expect(config.keyers.downstream[2]).toMatchObject({ onAir: false, tie: false, rate: 25 })
  })

  it('migrates old default Media Pool and Media Player labels in existing configs', async () => {
    const configPath = await temporaryConfigPath()
    const legacyConfig = JSON.parse(JSON.stringify(createDefaultConfig())) as {
      mediaPlayers: { 1: { name: string }; 2: { name: string } }
      mediaPool: {
        stills: Array<{
          slot: number
          type: 'generated' | 'image'
          name: string
          text?: string
        }>
      }
    }

    legacyConfig.mediaPlayers[1].name = 'Media Player 1'
    legacyConfig.mediaPlayers[2].name = 'Media Player 2'
    if (legacyConfig.mediaPool.stills[0]?.type === 'generated') {
      legacyConfig.mediaPool.stills[0].name = 'Welcome'
      legacyConfig.mediaPool.stills[0].text = 'WELCOME'
    }
    if (legacyConfig.mediaPool.stills[1]?.type === 'generated') {
      legacyConfig.mediaPool.stills[1].name = 'Holding Slide'
      legacyConfig.mediaPool.stills[1].text = 'SERVICE STARTING SOON'
    }

    await writeFile(configPath, JSON.stringify(legacyConfig), 'utf8')

    const config = await new ConfigRepository(configPath).loadOrCreate()

    expect(config.mediaPlayers).toMatchObject({
      1: { name: 'Media Player 1' },
      2: { name: 'Media Player 2' },
    })
    expect(config.mediaPool.stills[0]).toMatchObject({
      slot: 1,
      name: 'Media Player #1',
      text: 'Media Player #1',
    })
    expect(config.mediaPool.stills[1]).toMatchObject({
      slot: 2,
      name: 'Media Player #2',
      text: 'Media Player #2',
    })
  })

  it('allows a later update to recover after a transient write failure', async () => {
    const configPath = await temporaryConfigPath()
    const repository = new ConfigRepository(configPath)
    await repository.loadOrCreate()

    const internals = repository as unknown as {
      writeConfig(config: Awaited<ReturnType<typeof repository.loadOrCreate>>): Promise<void>
    }
    const writeConfig = internals.writeConfig.bind(repository)
    let shouldFail = true
    internals.writeConfig = async (config) => {
      if (shouldFail) {
        shouldFail = false
        throw new Error('temporary removable-drive failure')
      }
      await writeConfig(config)
    }

    await expect(
      repository.update((config) => ({
        ...config,
        transition: { ...config.transition, rateFrames: 12 },
      })),
    ).rejects.toThrow('temporary removable-drive failure')

    await repository.update((config) => ({
      ...config,
      transition: { ...config.transition, rateFrames: 18 },
    }))
    await repository.flush()

    expect(JSON.parse(await readFile(configPath, 'utf8')).transition.rateFrames).toBe(18)
  })
})
