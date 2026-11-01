import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  atemSandboxConfigSchema,
  createDefaultConfig,
  formatConfigIssues,
  type AtemSandboxConfig,
} from '@atem-sandbox/shared'

export class ConfigValidationError extends Error {
  public constructor(
    public readonly configPath: string,
    message: string,
  ) {
    super(message)
    this.name = 'ConfigValidationError'
  }
}

export class ConfigRepository {
  private config: AtemSandboxConfig | undefined
  private writeQueue: Promise<void> = Promise.resolve()

  public constructor(public readonly configPath: string) {}

  public async loadOrCreate(): Promise<AtemSandboxConfig> {
    try {
      await access(this.configPath)
    } catch {
      const defaultConfig = createDefaultConfig()
      await this.writeConfig(defaultConfig)
      this.config = defaultConfig
      return structuredClone(defaultConfig)
    }

    let rawConfig: unknown
    try {
      rawConfig = JSON.parse(await readFile(this.configPath, 'utf8')) as unknown
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new ConfigValidationError(this.configPath, `Unable to read JSON: ${detail}`)
    }

    const parsed = atemSandboxConfigSchema.safeParse(
      normalizeLegacyDefaultMediaLabels(
        normalizeLegacySingleMediaPlayerSources(
          normalizeLegacyFourInputProfile(normalizeLegacyMiniExtremeProfile(rawConfig)),
        ),
      ),
    )
    if (!parsed.success) {
      throw new ConfigValidationError(this.configPath, formatConfigIssues(parsed.error.issues))
    }

    this.config = parsed.data
    return structuredClone(parsed.data)
  }

  public get(): AtemSandboxConfig {
    if (this.config === undefined) {
      throw new Error('Configuration has not been loaded.')
    }
    return structuredClone(this.config)
  }

  public async update(
    mutate: (current: AtemSandboxConfig) => AtemSandboxConfig,
  ): Promise<AtemSandboxConfig> {
    const next = mutate(this.get())
    const parsed = atemSandboxConfigSchema.safeParse(next)
    if (!parsed.success) {
      throw new ConfigValidationError(this.configPath, formatConfigIssues(parsed.error.issues))
    }

    this.config = parsed.data
    // A failed removable-drive write must not permanently poison future
    // persisted controls. The caller still sees this update's failure, while a
    // later update is allowed to retry from the current in-memory profile.
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() => this.writeConfig(parsed.data))
    await this.writeQueue
    return structuredClone(parsed.data)
  }

  /**
   * Replaces the complete portable sandbox profile after validating it against
   * the same schema used at startup. This is used by the sandbox import API so
   * an invalid upload can never partially change the active configuration.
   */
  public async replace(config: unknown): Promise<AtemSandboxConfig> {
    const parsed = atemSandboxConfigSchema.safeParse(config)
    if (!parsed.success) {
      throw new ConfigValidationError(this.configPath, formatConfigIssues(parsed.error.issues))
    }

    this.config = parsed.data
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() => this.writeConfig(parsed.data))
    await this.writeQueue
    return structuredClone(parsed.data)
  }

  /** Waits for queued atomic writes before a host shuts down. */
  public async flush(): Promise<void> {
    await this.writeQueue
  }

  private async writeConfig(config: AtemSandboxConfig): Promise<void> {
    const directory = dirname(this.configPath)
    await mkdir(directory, { recursive: true })
    const temporaryPath = resolve(
      directory,
      `.${this.configPath.split(/[\\/]/).at(-1) ?? 'config.json'}.${process.pid}.tmp`,
    )
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, this.configPath)
  }
}

/**
 * Earlier releases treated Mini Pro identities as an eight-input v1 surface.
 * Keep those saved local profiles startable after profiles became topology-aware;
 * imports remain strict so a new profile cannot silently lose input settings.
 */
function normalizeLegacyFourInputProfile(rawConfig: unknown): unknown {
  if (!isRecord(rawConfig) || !isRecord(rawConfig.device) || !Array.isArray(rawConfig.inputs)) {
    return rawConfig
  }

  const modelId = rawConfig.device.modelId
  const model = rawConfig.device.model
  const isFourInputMiniPro =
    modelId === 'atem-mini-pro' ||
    modelId === 'atem-mini-pro-iso' ||
    model === 'ATEM Mini Pro' ||
    model === 'ATEM Mini Pro ISO'
  if (!isFourInputMiniPro || rawConfig.inputs.length !== 8) {
    return rawConfig
  }

  const initialState = isRecord(rawConfig.initialState) ? rawConfig.initialState : undefined
  const hasUnavailableInitialInput =
    typeof initialState?.program === 'number' && initialState.program > 4
      ? true
      : typeof initialState?.preview === 'number' && initialState.preview > 4

  return {
    ...rawConfig,
    inputs: rawConfig.inputs.slice(0, 4),
    ...(hasUnavailableInitialInput ? { initialState: { program: 1, preview: 2 } } : {}),
  }
}

/**
 * The non-ISO Mini Extreme profile was removed from the selectable catalog.
 * Preserve startup compatibility for existing local configs by remapping that
 * profile to the retained Mini Extreme ISO (Gen 1) identity.
 */
function normalizeLegacyMiniExtremeProfile(rawConfig: unknown): unknown {
  if (!isRecord(rawConfig) || !isRecord(rawConfig.device)) {
    return rawConfig
  }

  const modelId = rawConfig.device.modelId
  const model = rawConfig.device.model
  const isRemovedMiniExtreme =
    modelId === 'atem-mini-extreme' ||
    (typeof model === 'string' && model.trim().toLocaleLowerCase() === 'atem mini extreme')

  if (!isRemovedMiniExtreme) {
    return rawConfig
  }

  return {
    ...rawConfig,
    device: {
      ...rawConfig.device,
      model: 'ATEM Mini Extreme ISO (Gen 1)',
      modelId: 'atem-mini-extreme-iso',
    },
  }
}

function normalizeLegacyDefaultMediaLabels(rawConfig: unknown): unknown {
  if (!isRecord(rawConfig)) {
    return rawConfig
  }

  const next = { ...rawConfig }

  if (
    isRecord(next.mediaPlayers) &&
    isRecord(next.mediaPlayers[1]) &&
    isRecord(next.mediaPlayers[2])
  ) {
    const mediaPlayers = next.mediaPlayers as Record<string, unknown>
    const player1 = next.mediaPlayers[1]
    const player2 = next.mediaPlayers[2]
    if (player1.name === 'Media Player #1' || player1.name === 'Media Player 1') {
      next.mediaPlayers = {
        ...mediaPlayers,
        1: { ...player1, name: 'Media Player 1' },
      }
    }
    if (player2.name === 'Media Player #2' || player2.name === 'Media Player 2') {
      next.mediaPlayers = {
        ...(next.mediaPlayers as Record<string, unknown>),
        2: { ...player2, name: 'Media Player 2' },
      }
    }
  }

  if (isRecord(next.mediaPool) && Array.isArray(next.mediaPool.stills)) {
    next.mediaPool = {
      ...next.mediaPool,
      stills: next.mediaPool.stills.map((still) => {
        if (!isRecord(still) || still.type !== 'generated' || typeof still.slot !== 'number') {
          return still
        }

        if (
          still.slot === 1 &&
          ((still.name === 'Welcome' && still.text === 'WELCOME') ||
            (still.name === 'Media Player #1' && still.text === 'Media Player #1') ||
            (still.name === 'Media Player #1 With Text' &&
              still.text === 'Media Player #1 With Text'))
        ) {
          return {
            ...still,
            name: 'Media Player #1',
            text: 'Media Player #1',
          }
        }

        if (
          still.slot === 2 &&
          ((still.name === 'Holding Slide' && still.text === 'SERVICE STARTING SOON') ||
            (still.name === 'Media Player #2' && still.text === 'Media Player #2') ||
            (still.name === 'Media Player #2 with Text' &&
              still.text === 'Media Player #2 with Text'))
        ) {
          return {
            ...still,
            name: 'Media Player #2',
            text: 'Media Player #2',
          }
        }

        return still
      }),
    }
  }

  return next
}

/**
 * Older builds allowed Media Player 2 source IDs to be saved even on Mini Pro
 * profiles that only expose one media player. Remap those persisted references
 * to Media Player 1 for startup compatibility.
 */
function normalizeLegacySingleMediaPlayerSources(rawConfig: unknown): unknown {
  if (!isRecord(rawConfig) || !isRecord(rawConfig.device)) {
    return rawConfig
  }

  const modelId = rawConfig.device.modelId
  const model = rawConfig.device.model
  const isSingleMediaPlayerProfile =
    modelId === 'atem-mini-pro' ||
    modelId === 'atem-mini-pro-iso' ||
    model === 'ATEM Mini Pro' ||
    model === 'ATEM Mini Pro ISO'
  if (!isSingleMediaPlayerProfile) {
    return rawConfig
  }

  const next = { ...rawConfig }
  const remapSource = (sourceId: unknown): unknown => (sourceId === 3020 ? 3010 : sourceId)

  if (isRecord(next.initialState)) {
    next.initialState = {
      ...next.initialState,
      program: remapSource(next.initialState.program),
      preview: remapSource(next.initialState.preview),
    }
  }

  if (isRecord(next.auxiliaries)) {
    next.auxiliaries = {
      ...next.auxiliaries,
      1: remapSource(next.auxiliaries[1]),
      2: remapSource(next.auxiliaries[2]),
      3: remapSource(next.auxiliaries[3]),
      4: remapSource(next.auxiliaries[4]),
    }
  }

  if (isRecord(next.keyers) && isRecord(next.keyers.upstreamSettings)) {
    const upstreamSettings = next.keyers.upstreamSettings as Record<string, unknown>
    next.keyers = {
      ...next.keyers,
      upstreamSettings: Object.fromEntries(
        Object.entries(upstreamSettings).map(([key, value]) => {
          if (!isRecord(value)) {
            return [key, value]
          }
          return [
            key,
            {
              ...value,
              fillSource: remapSource(value.fillSource),
              cutSource: remapSource(value.cutSource),
            },
          ]
        }),
      ),
    }
  }

  return next
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface ParsedCliOptions {
  configArgument: string | undefined
  debug: boolean
  headless: boolean
}

export function parseCliOptions(argv: readonly string[]): ParsedCliOptions {
  let configArgument: string | undefined
  let debug = false
  let headless = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--config') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error('--config requires a file path.')
      }
      configArgument = value
      index += 1
    } else if (argument === '--debug') {
      debug = true
    } else if (argument === '--headless') {
      headless = true
    } else {
      throw new Error(`Unknown option: ${argument}`)
    }
  }

  return { configArgument, debug, headless }
}

export function resolvePortableConfigPath(
  portableRoot: string,
  configArgument: string | undefined,
): string {
  return configArgument === undefined
    ? resolve(portableRoot, 'config.json')
    : resolve(portableRoot, configArgument)
}
