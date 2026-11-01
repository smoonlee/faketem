import { z } from 'zod'

export const INPUT_IDS = [1, 2, 3, 4, 5, 6, 7, 8] as const
export type InputId = (typeof INPUT_IDS)[number]

export const MEDIA_PLAYER_IDS = [1, 2] as const
export type MediaPlayerId = (typeof MEDIA_PLAYER_IDS)[number]

export const MACRO_COUNT = 100

/**
 * ATEM source identifiers used at the wire boundary. The core represents sources
 * semantically; the protocol adapter will convert through these functions.
 */
export const ATEM_VIDEO_SOURCE = {
  mediaPlayer1: 3010,
  mediaPlayer2: 3020,
  superSource: 6000,
} as const

export type SourceRef =
  | { kind: 'input'; inputId: InputId }
  | { kind: 'media-player'; player: MediaPlayerId }
  | { kind: 'super-source' }

export function inputSource(inputId: InputId): SourceRef {
  return { kind: 'input', inputId }
}

export function mediaPlayerSource(player: MediaPlayerId): SourceRef {
  return { kind: 'media-player', player }
}

export function sourceRefToAtemId(source: SourceRef): number {
  if (source.kind === 'input') {
    return source.inputId
  }
  if (source.kind === 'super-source') return ATEM_VIDEO_SOURCE.superSource

  return source.player === 1 ? ATEM_VIDEO_SOURCE.mediaPlayer1 : ATEM_VIDEO_SOURCE.mediaPlayer2
}

export function atemIdToSourceRef(sourceId: number): SourceRef | undefined {
  if (sourceId === ATEM_VIDEO_SOURCE.superSource) return { kind: 'super-source' }
  if (INPUT_IDS.includes(sourceId as InputId)) {
    return inputSource(sourceId as InputId)
  }

  if (sourceId === ATEM_VIDEO_SOURCE.mediaPlayer1) {
    return mediaPlayerSource(1)
  }

  if (sourceId === ATEM_VIDEO_SOURCE.mediaPlayer2) {
    return mediaPlayerSource(2)
  }

  return undefined
}

export function isSupportedAtemSourceId(sourceId: number): boolean {
  return atemIdToSourceRef(sourceId) !== undefined
}

export function sourceKey(source: SourceRef): string {
  return source.kind === 'input'
    ? `input:${source.inputId}`
    : source.kind === 'media-player'
      ? `media-player:${source.player}`
      : 'super-source'
}

export function sourcesMatch(left: SourceRef, right: SourceRef): boolean {
  return sourceKey(left) === sourceKey(right)
}

function isSourceAvailableOnProfile(
  source: SourceRef,
  profile: AtemDeviceIdentityProfile,
  inputIds: ReadonlySet<number>,
): { ok: true } | { ok: false; message: string } {
  if (source.kind === 'input') {
    if (!inputIds.has(source.inputId)) {
      return {
        ok: false,
        message: `input ${source.inputId} is not available on ${profile.label}`,
      }
    }
    return { ok: true }
  }

  if (source.kind === 'super-source') {
    return profile.effects.superSource > 0
      ? { ok: true }
      : { ok: false, message: `SuperSource is not available on ${profile.label}` }
  }
  if (source.player > profile.topology.mediaPlayers) {
    return {
      ok: false,
      message: `Media Player ${source.player} is not available on ${profile.label}`,
    }
  }

  return { ok: true }
}

export const VIDEO_MODES = {
  '1080p50': { frameRate: 50 },
  '1080p25': { frameRate: 25 },
  '720p50': { frameRate: 50 },
} as const

export type VideoMode = keyof typeof VIDEO_MODES

export function frameDurationMs(videoMode: VideoMode): number {
  return 1_000 / VIDEO_MODES[videoMode].frameRate
}

/** Switcher profiles exposed by the Mini-focused sandbox selector. */
export const ATEM_DEVICE_PROFILE_IDS = [
  'atem-mini-extreme-iso-g2',
  'atem-mini-extreme-iso',
  'atem-mini-pro-iso',
  'atem-mini-pro',
] as const

export type AtemDeviceProfileId = (typeof ATEM_DEVICE_PROFILE_IDS)[number]

const LEGACY_ATEM_DEVICE_PROFILE_IDS = [
  'atem-sdi-extreme-iso',
  'atem-television-studio-hd8',
  'atem-television-studio-hd8-iso',
  'atem-television-studio-4k8',
] as const

type LegacyAtemDeviceProfileId = (typeof LEGACY_ATEM_DEVICE_PROFILE_IDS)[number]

export interface AtemDeviceIdentityProfile {
  id: AtemDeviceProfileId
  label: string
  /** Numeric model byte in the public ATEM protocol. */
  protocolModel: number
  /** External-port type reported by `InPr`: SDI=1, HDMI=2. */
  inputPortType: 1 | 2
  /** Physical camera inputs modelled by this sandbox profile. */
  inputCount: 4 | 8
  /** Whether this model should expose Media Player and Media Pool controls in the UI. */
  supportsMediaPlayers: boolean
  effects: {
    advancedChromaKeyers: 1 | 4
    linearLumaKeyers: 2 | 4
    dves: 1 | 2
    /** Public W-APS-44 extract did not clearly expose this line item for G2. */
    patternGenerators?: 1 | 5
    colorGenerators: 2
    superSource: 0 | 1
    transitionKeyer: 'dve-only'
    /** Public docs describe overall compositing depth for some models. */
    totalLayers?: 5 | 9
  }
  topology: {
    mixEffects: 1
    sources: 4 | 8
    downstreamKeyers: 1 | 2
    auxiliaries: 1 | 2 | 4
    mediaPlayers: 1 | 2
    mediaPoolStills: 20
    upstreamKeyersPerMixEffect: 1 | 4
  }
}

function createV1Topology(
  sources: 4 | 8,
  mediaPlayers: 1 | 2,
  downstreamKeyers: 1 | 2,
  upstreamKeyersPerMixEffect: 1 | 4,
  auxiliaries: 1 | 2 | 4,
): AtemDeviceIdentityProfile['topology'] {
  return {
    mixEffects: 1,
    sources,
    downstreamKeyers,
    auxiliaries,
    mediaPlayers,
    mediaPoolStills: 20,
    upstreamKeyersPerMixEffect,
  }
}

export const ATEM_DEVICE_PROFILES: readonly AtemDeviceIdentityProfile[] = [
  {
    id: 'atem-mini-extreme-iso-g2',
    label: 'ATEM Mini Extreme ISO G2',
    protocolModel: 33,
    inputPortType: 2,
    // The G2 exposes a ninth Thunderbolt/video source. The sandbox models its
    // eight HDMI camera inputs until that distinct source type is implemented.
    inputCount: 8,
    supportsMediaPlayers: true,
    effects: {
      advancedChromaKeyers: 4,
      linearLumaKeyers: 4,
      dves: 2,
      colorGenerators: 2,
      superSource: 1,
      transitionKeyer: 'dve-only',
    },
    topology: createV1Topology(8, 2, 2, 4, 4),
  },
  {
    id: 'atem-mini-extreme-iso',
    label: 'ATEM Mini Extreme ISO (Gen 1)',
    protocolModel: 17,
    inputPortType: 2,
    inputCount: 8,
    supportsMediaPlayers: true,
    effects: {
      advancedChromaKeyers: 4,
      linearLumaKeyers: 4,
      dves: 2,
      patternGenerators: 5,
      colorGenerators: 2,
      superSource: 1,
      transitionKeyer: 'dve-only',
      totalLayers: 9,
    },
    topology: createV1Topology(8, 2, 2, 4, 2),
  },
  {
    id: 'atem-mini-pro-iso',
    label: 'ATEM Mini Pro ISO',
    protocolModel: 15,
    inputPortType: 2,
    inputCount: 4,
    supportsMediaPlayers: true,
    effects: {
      advancedChromaKeyers: 1,
      linearLumaKeyers: 2,
      dves: 1,
      patternGenerators: 1,
      colorGenerators: 2,
      superSource: 0,
      transitionKeyer: 'dve-only',
      totalLayers: 5,
    },
    topology: createV1Topology(4, 1, 1, 1, 1),
  },
  {
    id: 'atem-mini-pro',
    label: 'ATEM Mini Pro',
    protocolModel: 14,
    inputPortType: 2,
    inputCount: 4,
    supportsMediaPlayers: true,
    effects: {
      advancedChromaKeyers: 1,
      linearLumaKeyers: 2,
      dves: 1,
      patternGenerators: 1,
      colorGenerators: 2,
      superSource: 0,
      transitionKeyer: 'dve-only',
      totalLayers: 5,
    },
    topology: createV1Topology(4, 1, 1, 1, 1),
  },
]

export const DEFAULT_ATEM_DEVICE_PROFILE_ID: AtemDeviceProfileId = 'atem-mini-extreme-iso'

export const atemDeviceProfileIdSchema = z.enum(ATEM_DEVICE_PROFILE_IDS)
const persistedAtemDeviceProfileIdSchema = z.enum([
  ...ATEM_DEVICE_PROFILE_IDS,
  ...LEGACY_ATEM_DEVICE_PROFILE_IDS,
])

export function getAtemDeviceProfile(id: AtemDeviceProfileId): AtemDeviceIdentityProfile {
  const profile = ATEM_DEVICE_PROFILES.find((candidate) => candidate.id === id)
  if (profile === undefined) {
    throw new Error(`Unknown ATEM device profile: ${id}`)
  }
  return profile
}

export function resolveAtemDeviceProfile(
  profileId: AtemDeviceProfileId | LegacyAtemDeviceProfileId | undefined,
  legacyModel: string,
): AtemDeviceIdentityProfile {
  if (profileId !== undefined) {
    if (ATEM_DEVICE_PROFILE_IDS.includes(profileId as AtemDeviceProfileId)) {
      return getAtemDeviceProfile(profileId as AtemDeviceProfileId)
    }
    return getAtemDeviceProfile(DEFAULT_ATEM_DEVICE_PROFILE_ID)
  }

  const normalizedLegacyModel = legacyModel.trim().toLocaleLowerCase()
  return (
    ATEM_DEVICE_PROFILES.find(
      (candidate) => candidate.label.toLocaleLowerCase() === normalizedLegacyModel,
    ) ??
    (normalizedLegacyModel === 'atem mini extreme iso'
      ? getAtemDeviceProfile(DEFAULT_ATEM_DEVICE_PROFILE_ID)
      : undefined) ??
    getAtemDeviceProfile(DEFAULT_ATEM_DEVICE_PROFILE_ID)
  )
}

export const transitionTypeSchema = z.enum(['mix', 'dip', 'wipe'])
export type TransitionType = z.infer<typeof transitionTypeSchema>

const hexColourSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a six-digit hex colour')
const relativeMediaPathSchema = z
  .string()
  .min(1)
  .refine(
    (fileName) =>
      !fileName.startsWith('/') &&
      !fileName.startsWith('\\') &&
      !fileName.split(/[\\/]/).includes('..'),
    'must be a safe path relative to media/',
  )

export const inputConfigSchema = z.object({
  id: z.number().int().min(1).max(8),
  longName: z.string().trim().min(1).max(64),
  shortName: z.string().trim().min(1).max(12),
  background: hexColourSchema,
  foreground: hexColourSchema,
})
export type AtemInputConfig = z.infer<typeof inputConfigSchema>

const generatedStillSchema = z.object({
  slot: z.number().int().min(1).max(20),
  type: z.literal('generated'),
  name: z.string().trim().min(1).max(64),
  background: hexColourSchema,
  foreground: hexColourSchema,
  text: z.string().trim().min(1).max(160),
})

const imageStillSchema = z.object({
  slot: z.number().int().min(1).max(20),
  type: z.literal('image'),
  name: z.string().trim().min(1).max(64),
  file: relativeMediaPathSchema.refine(
    (fileName) => /\.(png|jpe?g|webp)$/i.test(fileName),
    'must point to a PNG, JPEG, or WebP file',
  ),
})

export const mediaPoolStillSchema = z.discriminatedUnion('type', [
  generatedStillSchema,
  imageStillSchema,
])
export type MediaPoolStill = z.infer<typeof mediaPoolStillSchema>

/**
 * A Media Player is announced to ATEM clients through the 20-byte `InPr`
 * long-name field. Keeping names printable ASCII prevents the UI and wire
 * identity from diverging when a client reads that fixed-width field.
 */
export const mediaPlayerNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[\x20-\x7e]+$/, 'must contain printable ASCII characters')

function mediaPlayerConfigSchema(defaultName: string) {
  return z.object({
    name: mediaPlayerNameSchema.default(defaultName),
    type: z.literal('still'),
    slot: z.number().int().min(1).max(20),
  })
}

const upstreamKeySettingsSchema = z.object({
  mixEffectKeyType: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(0),
  flyEnabled: z.boolean().default(false),
  fillSource: z.number().int().default(1),
  cutSource: z.number().int().default(2),
})

const upstreamKeyLumaSchema = z.object({
  preMultiplied: z.boolean(),
  clip: z.number().int().min(0).max(65535),
  gain: z.number().int().min(0).max(65535),
  invert: z.boolean(),
})

const downstreamKeySettingsSchema = z.object({
  onAir: z.boolean().default(false),
  tie: z.boolean().default(false),
  rate: z.number().int().min(1).max(250).default(25),
})

const legacyOrCurrentDownstreamKeySettingsSchema = z
  .union([z.boolean(), downstreamKeySettingsSchema])
  .transform((value) =>
    typeof value === 'boolean' ? { onAir: value, tie: false, rate: 25 } : value,
  )

const keyStateConfigSchema = z.object({
  upstream: z.object({
    1: z.boolean().default(false),
    2: z.boolean().default(false),
    3: z.boolean().default(false),
    4: z.boolean().default(false),
  }),
  upstreamLuma: z
    .object({
      1: upstreamKeyLumaSchema,
      2: upstreamKeyLumaSchema,
      3: upstreamKeyLumaSchema,
      4: upstreamKeyLumaSchema,
    })
    .optional(),
  upstreamSettings: z
    .object({
      1: upstreamKeySettingsSchema,
      2: upstreamKeySettingsSchema,
      3: upstreamKeySettingsSchema,
      4: upstreamKeySettingsSchema,
    })
    .default({
      1: { mixEffectKeyType: 0, flyEnabled: false, fillSource: 1, cutSource: 2 },
      2: { mixEffectKeyType: 0, flyEnabled: false, fillSource: 1, cutSource: 2 },
      3: { mixEffectKeyType: 0, flyEnabled: false, fillSource: 1, cutSource: 2 },
      4: { mixEffectKeyType: 0, flyEnabled: false, fillSource: 1, cutSource: 2 },
    }),
  downstream: z.object({
    1: legacyOrCurrentDownstreamKeySettingsSchema.default({ onAir: false, tie: false, rate: 25 }),
    2: legacyOrCurrentDownstreamKeySettingsSchema.default({ onAir: false, tie: false, rate: 25 }),
  }),
})

const auxiliariesConfigSchema = z.object({
  1: z.number().int().default(1),
  2: z.number().int().default(1),
  3: z.number().int().default(1),
  4: z.number().int().default(1),
})

const macroSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('input'), inputId: z.literal(INPUT_IDS) }),
  z.object({ kind: z.literal('media-player'), player: z.literal(MEDIA_PLAYER_IDS) }),
  z.object({ kind: z.literal('super-source') }),
])

const macroOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set-program'), source: macroSourceSchema }),
  z.object({ type: z.literal('set-preview'), source: macroSourceSchema }),
  z.object({ type: z.literal('cut') }),
  z.object({ type: z.literal('wait') }),
  z.object({ type: z.literal('pause'), frames: z.number().int().min(0).max(65535) }),
  z.object({ type: z.literal('auto') }),
  z.object({ type: z.literal('set-transition-type'), transitionType: transitionTypeSchema }),
  z.object({
    type: z.literal('set-transition-rate'),
    rateFrames: z.number().int().min(1).max(250),
  }),
  z.object({
    type: z.literal('set-aux-source'),
    bus: z.literal([1, 2, 3, 4]),
    source: macroSourceSchema,
  }),
  z.object({
    type: z.literal('select-media-player-still'),
    player: z.literal(MEDIA_PLAYER_IDS),
    slot: z.number().int().min(1).max(20),
  }),
  z.object({
    type: z.literal('set-upstream-key'),
    index: z.literal([1, 2, 3, 4]),
    enabled: z.boolean(),
  }),
  z.object({
    type: z.literal('set-upstream-key-type'),
    index: z.literal([1, 2, 3, 4]),
    mixEffectKeyType: z.literal([0, 1, 2, 3]),
  }),
  z.object({
    type: z.literal('set-upstream-key-luma'),
    index: z.literal([1, 2, 3, 4]),
    properties: upstreamKeyLumaSchema.partial(),
  }),
  z.object({
    type: z.literal('set-upstream-key-fill-source'),
    index: z.literal([1, 2, 3, 4]),
    fillSource: z.number().int(),
  }),
  z.object({
    type: z.literal('set-upstream-key-cut-source'),
    index: z.literal([1, 2, 3, 4]),
    cutSource: z.number().int(),
  }),
  z.object({
    type: z.literal('set-downstream-key'),
    index: z.literal([1, 2]),
    enabled: z.boolean(),
  }),
  z.object({
    type: z.literal('set-downstream-key-tie'),
    index: z.literal([1, 2]),
    enabled: z.boolean(),
  }),
  z.object({
    type: z.literal('set-downstream-key-rate'),
    index: z.literal([1, 2]),
    rate: z.number().int().min(1).max(250),
  }),
])

const macrosConfigSchema = z.record(
  z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .refine((value) => Number(value) < MACRO_COUNT),
  z.object({
    name: z.string().refine((value) => new TextEncoder().encode(value).length <= 255),
    description: z.string().refine((value) => new TextEncoder().encode(value).length <= 1024),
    operations: z.array(macroOperationSchema).max(10000),
    hasUnsupportedOps: z.boolean(),
  }),
)

export const atemSandboxConfigSchema = z
  .object({
    version: z.literal(1),
    server: z.object({
      host: z.string().trim().min(1),
      atemPort: z.number().int().min(1).max(65_535),
      webPort: z.number().int().min(1).max(65_535),
    }),
    device: z
      .object({
        name: z.string().trim().min(1).max(64),
        /** Retained for readable portable profiles and legacy compatibility. */
        model: z.string().trim().min(1).max(64),
        modelId: persistedAtemDeviceProfileIdSchema.optional(),
        videoMode: z.enum(['1080p50', '1080p25', '720p50']),
      })
      .transform((device) => {
        const profile = resolveAtemDeviceProfile(device.modelId, device.model)
        return {
          ...device,
          model: profile.label,
          modelId: profile.id,
        }
      }),
    transition: z.object({
      type: transitionTypeSchema,
      rateFrames: z.number().int().min(1).max(250),
      fadeToBlackRate: z.number().int().min(1).max(250).default(50),
    }),
    initialState: z.object({
      program: z
        .number()
        .int()
        .refine(isSupportedAtemSourceId, 'must be an available sandbox source ID'),
      preview: z
        .number()
        .int()
        .refine(isSupportedAtemSourceId, 'must be an available sandbox source ID'),
    }),
    macros: macrosConfigSchema.optional(),
    inputs: z.array(inputConfigSchema).min(1).max(INPUT_IDS.length),
    mediaPool: z.object({
      stills: z.array(mediaPoolStillSchema).max(20),
      settings: z
        .object({
          maxFrames: z.tuple([
            z.number().int().min(0).max(65_535),
            z.number().int().min(0).max(65_535),
            z.number().int().min(0).max(65_535),
            z.number().int().min(0).max(65_535),
          ]),
          unassignedFrames: z.number().int().min(0).max(65_535),
        })
        .default({ maxFrames: [250, 250, 250, 250], unassignedFrames: 1000 }),
    }),
    mediaPlayers: z.object({
      1: mediaPlayerConfigSchema('Media Player 1'),
      2: mediaPlayerConfigSchema('Media Player 2'),
    }),
    auxiliaries: auxiliariesConfigSchema.default({ 1: 1, 2: 1, 3: 1, 4: 1 }),
    keyers: keyStateConfigSchema.default({
      upstream: { 1: false, 2: false, 3: false, 4: false },
      upstreamSettings: {
        1: { mixEffectKeyType: 0, flyEnabled: false, fillSource: 1, cutSource: 2 },
        2: { mixEffectKeyType: 0, flyEnabled: false, fillSource: 1, cutSource: 2 },
        3: { mixEffectKeyType: 0, flyEnabled: false, fillSource: 1, cutSource: 2 },
        4: { mixEffectKeyType: 0, flyEnabled: false, fillSource: 1, cutSource: 2 },
      },
      downstream: {
        1: { onAir: false, tie: false, rate: 25 },
        2: { onAir: false, tie: false, rate: 25 },
      },
    }),
  })
  .superRefine((config, context) => {
    const profile = getAtemDeviceProfile(config.device.modelId)
    if (config.inputs.length !== profile.inputCount) {
      context.addIssue({
        code: 'custom',
        path: ['inputs'],
        message: `${profile.label} requires exactly ${profile.inputCount} camera inputs`,
      })
    }

    const inputIds = new Set<number>()
    config.inputs.forEach((input, index) => {
      if (inputIds.has(input.id)) {
        context.addIssue({
          code: 'custom',
          path: ['inputs', index, 'id'],
          message: `input ID ${input.id} is duplicated`,
        })
      }
      inputIds.add(input.id)
    })

    for (const inputId of INPUT_IDS.slice(0, profile.inputCount)) {
      if (!inputIds.has(inputId)) {
        context.addIssue({
          code: 'custom',
          path: ['inputs'],
          message: `input ID ${inputId} is required`,
        })
      }
    }

    for (const inputId of inputIds) {
      if (inputId > profile.inputCount) {
        context.addIssue({
          code: 'custom',
          path: ['inputs'],
          message: `input ID ${inputId} is not available on ${profile.label}`,
        })
      }
    }

    for (const [key, sourceId] of Object.entries(config.initialState)) {
      const source = atemIdToSourceRef(sourceId)
      if (source === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['initialState', key],
          message: `source ID ${sourceId} is not available in this sandbox`,
        })
        continue
      }
      const availability = isSourceAvailableOnProfile(source, profile, inputIds)
      if (!availability.ok) {
        context.addIssue({
          code: 'custom',
          path: ['initialState', key],
          message: availability.message,
        })
      }
    }

    for (const [auxBus, sourceId] of Object.entries(config.auxiliaries)) {
      const source = atemIdToSourceRef(sourceId)
      if (source === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['auxiliaries', auxBus],
          message: `source ID ${sourceId} is not available in this sandbox`,
        })
        continue
      }
      const availability = isSourceAvailableOnProfile(source, profile, inputIds)
      if (!availability.ok) {
        context.addIssue({
          code: 'custom',
          path: ['auxiliaries', auxBus],
          message: availability.message,
        })
      }
    }

    for (const [keyerIndex, keyerSettings] of Object.entries(config.keyers.upstreamSettings)) {
      for (const [sourceRole, sourceId] of [
        ['fillSource', keyerSettings.fillSource],
        ['cutSource', keyerSettings.cutSource],
      ] as const) {
        const source = atemIdToSourceRef(sourceId)
        if (source === undefined) {
          context.addIssue({
            code: 'custom',
            path: ['keyers', 'upstreamSettings', keyerIndex, sourceRole],
            message: `source ID ${sourceId} is not available in this sandbox`,
          })
          continue
        }
        const availability = isSourceAvailableOnProfile(source, profile, inputIds)
        if (!availability.ok) {
          context.addIssue({
            code: 'custom',
            path: ['keyers', 'upstreamSettings', keyerIndex, sourceRole],
            message: availability.message,
          })
        }
      }
    }

    const stillSlots = new Set<number>()
    config.mediaPool.stills.forEach((still, index) => {
      if (stillSlots.has(still.slot)) {
        context.addIssue({
          code: 'custom',
          path: ['mediaPool', 'stills', index, 'slot'],
          message: `media pool slot ${still.slot} is duplicated`,
        })
      }
      stillSlots.add(still.slot)
    })

    const supportedMediaPlayers = MEDIA_PLAYER_IDS.slice(0, profile.topology.mediaPlayers)
    for (const player of supportedMediaPlayers) {
      if (!stillSlots.has(config.mediaPlayers[player].slot)) {
        context.addIssue({
          code: 'custom',
          path: ['mediaPlayers', String(player), 'slot'],
          message: `references missing media pool slot ${config.mediaPlayers[player].slot}`,
        })
      }
    }
  })

export type AtemSandboxConfig = z.infer<typeof atemSandboxConfigSchema>

export function formatConfigIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length === 0 ? 'config' : issue.path.join('.')
      return `${path}: ${issue.message}`
    })
    .join('\n')
}

const DEFAULT_INPUT_COLOURS = [
  '#B91C1C',
  '#15803D',
  '#1D4ED8',
  '#7E22CE',
  '#A16207',
  '#0F766E',
  '#BE123C',
  '#334155',
] as const

function createDefaultInputs(inputCount: 4 | 8): AtemInputConfig[] {
  return Array.from({ length: inputCount }, (_, index) => {
    const inputId = (index + 1) as InputId
    return {
      id: inputId,
      longName: `Camera ${inputId}`,
      shortName: `CAM${inputId}`,
      background: DEFAULT_INPUT_COLOURS[index]!,
      foreground: '#FFFFFF',
    }
  })
}

export function createDefaultConfig(
  profileId: AtemDeviceProfileId = DEFAULT_ATEM_DEVICE_PROFILE_ID,
): AtemSandboxConfig {
  const profile = getAtemDeviceProfile(profileId)
  const defaultMediaPoolStills = Array.from(
    { length: profile.topology.mediaPlayers },
    (_, index) => {
      const slot = index + 1
      const background = slot === 1 ? '#0047AB' : '#1F2937'
      return {
        slot,
        type: 'generated' as const,
        name: `Media Player #${slot}`,
        background,
        foreground: '#FFFFFF',
        text: `Media Player #${slot}`,
      }
    },
  )
  return {
    version: 1,
    server: {
      host: '127.0.0.1',
      atemPort: 9910,
      webPort: 3000,
    },
    device: {
      name: 'ATEM Sandbox',
      model: profile.label,
      modelId: profile.id,
      videoMode: '1080p50',
    },
    transition: {
      type: 'mix',
      rateFrames: 25,
      fadeToBlackRate: 50,
    },
    initialState: {
      program: 1,
      preview: 2,
    },
    inputs: createDefaultInputs(profile.inputCount),
    mediaPool: {
      stills: defaultMediaPoolStills,
      settings: {
        maxFrames: [250, 250, 250, 250],
        unassignedFrames: 1000,
      },
    },
    mediaPlayers: {
      1: { name: 'Media Player 1', type: 'still', slot: 1 },
      2: { name: 'Media Player 2', type: 'still', slot: 2 },
    },
    auxiliaries: { 1: 1, 2: 1, 3: 1, 4: 1 },
    keyers: {
      upstream: { 1: false, 2: false, 3: false, 4: false },
      upstreamSettings: {
        1: { mixEffectKeyType: 0, flyEnabled: false, fillSource: 1, cutSource: 2 },
        2: { mixEffectKeyType: 0, flyEnabled: false, fillSource: 1, cutSource: 2 },
        3: { mixEffectKeyType: 0, flyEnabled: false, fillSource: 1, cutSource: 2 },
        4: { mixEffectKeyType: 0, flyEnabled: false, fillSource: 1, cutSource: 2 },
      },
      downstream: {
        1: { onAir: false, tie: false, rate: 25 },
        2: { onAir: false, tie: false, rate: 25 },
      },
    },
  }
}

export const DEFAULT_CONFIG: AtemSandboxConfig = createDefaultConfig()
