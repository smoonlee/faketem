import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ATEM_RECORDING_STATUS_RECORDING,
  ATEM_STREAMING_STATUS_STREAMING,
  availableSources,
  isSelectedSource,
  resolveSourceSurface,
  sourceLabel,
  sourceStableKey,
  type AtemInput,
  type AtemState,
} from '@atem-sandbox/atem-state'
import {
  getAtemDeviceProfile,
  MACRO_COUNT,
  sourceRefToAtemId,
  type AtemDeviceProfileId,
  type MediaPlayerId,
  type SourceRef,
} from '@atem-sandbox/shared'
import {
  loadInitialSnapshot,
  exportSandboxConfiguration,
  importSandboxConfiguration,
  resetSandboxToDefaultConfiguration,
  sandboxWebSocketUrl,
  sendControl,
  updateInput,
  updateMediaPlayer,
  updateDeviceSettings,
  createMediaPoolStill,
  deleteMediaPoolStill,
  updateDeviceProfile,
  loadRecentLogs,
  type DeviceSettingsUpdate,
  type LogEntry,
  type LogSnapshot,
  type ControlCommand,
  type RuntimeStatus,
  type SnapshotMessage,
} from './api.js'
import { Monitor, SourceCanvas } from './monitor.js'

const MAX_INITIAL_SNAPSHOT_RETRIES = 6
const MAX_WEBSOCKET_RETRIES = 8
const RETRY_DELAY_MS = 250
const MAX_RETRY_DELAY_MS = 4_000

const BLACKMAGIC_PRODUCTS_URLS = {
  atemMiniTechSpecs: 'https://www.blackmagicdesign.com/products/atemmini/techspecs',
} as const

function retryDelay(retryNumber: number): number {
  return Math.min(RETRY_DELAY_MS * 2 ** retryNumber, MAX_RETRY_DELAY_MS)
}

function trapDialogTabKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab') {
    return
  }

  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  )
  const first = focusable[0]
  const last = focusable.at(-1)

  if (first === undefined || last === undefined) {
    event.preventDefault()
    event.currentTarget.focus()
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function sourceButtonLabel(state: AtemState, source: SourceRef): string {
  if (source.kind === 'input') {
    return (
      state.inputs.find((input) => input.id === source.inputId)?.shortName ?? `IN ${source.inputId}`
    )
  }
  return source.kind === 'media-player' ? state.mediaPlayers[source.player].name : 'SSRC'
}

function sourceTitle(state: AtemState, source: SourceRef): string {
  return resolveSourceSurface(state, source).title
}

function resolveHardwareProfileUrl(deviceProfileId: string): string {
  switch (deviceProfileId) {
    case 'atem-mini-extreme-iso-g2':
      return `${BLACKMAGIC_PRODUCTS_URLS.atemMiniTechSpecs}/W-APS-44`
    case 'atem-mini-extreme-iso':
      return BLACKMAGIC_PRODUCTS_URLS.atemMiniTechSpecs
    case 'atem-mini-pro-iso':
      return `${BLACKMAGIC_PRODUCTS_URLS.atemMiniTechSpecs}/W-APS-15`
    case 'atem-mini-pro':
      return `${BLACKMAGIC_PRODUCTS_URLS.atemMiniTechSpecs}/W-APS-14`
    default:
      return BLACKMAGIC_PRODUCTS_URLS.atemMiniTechSpecs
  }
}

type PickerOption = { id: string; label: string }

const VIDEO_MODE_OPTIONS: readonly PickerOption[] = [
  { id: '1080p50', label: '1080p50' },
  { id: '1080p25', label: '1080p25' },
  { id: '720p50', label: '720p50' },
]

function OptionPicker({
  options,
  value,
  ariaLabel,
  idPrefix,
  triggerRef,
  onSelect,
}: {
  options: readonly PickerOption[]
  value: string
  ariaLabel: string
  idPrefix: string
  triggerRef: React.RefObject<HTMLButtonElement | null>
  onSelect: (option: PickerOption) => void
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value),
  )

  useEffect(() => {
    setActiveIndex(selectedIndex)
  }, [selectedIndex])

  useEffect(() => {
    if (!isOpen) {
      return
    }
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    window.addEventListener('pointerdown', closeOnOutsidePointer, true)
    return () => window.removeEventListener('pointerdown', closeOnOutsidePointer, true)
  }, [isOpen])

  const chooseOption = (index: number): void => {
    const option = options[index]
    if (option !== undefined) {
      onSelect(option)
      setIsOpen(false)
      triggerRef.current?.focus()
    }
  }

  return (
    <div className={`option-picker ${isOpen ? 'is-open' : ''}`} ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="option-picker-trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={`${idPrefix}-options`}
        aria-activedescendant={
          isOpen ? `${idPrefix}-option-${options[activeIndex]?.id ?? value}` : undefined
        }
        onClick={() => {
          setActiveIndex(selectedIndex)
          setIsOpen((open) => !open)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (!isOpen) {
              setActiveIndex(selectedIndex)
              setIsOpen(true)
            } else {
              const direction = event.key === 'ArrowDown' ? 1 : -1
              setActiveIndex((index) =>
                Math.min(options.length - 1, Math.max(0, index + direction)),
              )
            }
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault()
            setIsOpen(true)
            setActiveIndex(event.key === 'Home' ? 0 : options.length - 1)
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (isOpen) {
              chooseOption(activeIndex)
            } else {
              setActiveIndex(selectedIndex)
              setIsOpen(true)
            }
          } else if (event.key === 'Escape' && isOpen) {
            event.preventDefault()
            setIsOpen(false)
          } else if (event.key === 'Tab') {
            setIsOpen(false)
          }
        }}
      >
        <span>{options[selectedIndex]?.label ?? value}</span>
        <span className="option-picker-chevron" aria-hidden="true" />
      </button>
      {isOpen && (
        <div
          id={`${idPrefix}-options`}
          className="option-picker-options"
          role="listbox"
          aria-label={`${ariaLabel} options`}
        >
          {options.map((option, index) => (
            <button
              key={option.id}
              id={`${idPrefix}-option-${option.id}`}
              type="button"
              role="option"
              aria-selected={option.id === value}
              tabIndex={-1}
              className={index === activeIndex ? 'active' : ''}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => chooseOption(index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function useSandbox(): {
  state: AtemState | undefined
  status: RuntimeStatus | undefined
  isConnected: boolean
  error: string | undefined
  notice: string | undefined
  clearError: () => void
  clearNotice: () => void
  runCommand: (command: ControlCommand) => Promise<void>
  saveInput: (inputId: number, update: Omit<AtemInput, 'id'>) => Promise<void>
  saveMediaPlayerName: (player: MediaPlayerId, name: string) => Promise<void>
  saveDeviceSettings: (update: DeviceSettingsUpdate) => Promise<void>
  createStill: (update: {
    name: string
    text: string
    background?: string
    foreground?: string
  }) => Promise<boolean>
  deleteStill: (slot: number) => Promise<void>
  saveDeviceProfile: (modelId: string) => Promise<void>
  exportConfiguration: () => Promise<void>
  importConfigurationFile: (file: File) => Promise<void>
  resetToDefaultConfiguration: () => Promise<void>
} {
  const [state, setState] = useState<AtemState>()
  const [status, setStatus] = useState<RuntimeStatus>()
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const applySnapshot = useCallback((snapshot: SnapshotMessage) => {
    setState(snapshot.state)
    setStatus(snapshot.status)
  }, [])

  useEffect(() => {
    let isActive = true
    let hasReceivedSnapshot = false
    let initialSnapshotRetries = 0
    let webSocketRetries = 0
    let activeWebSocket: WebSocket | undefined
    let startTimer: ReturnType<typeof setTimeout> | undefined
    let snapshotRetryTimer: ReturnType<typeof setTimeout> | undefined
    let webSocketRetryTimer: ReturnType<typeof setTimeout> | undefined

    const receiveSnapshot = (snapshot: SnapshotMessage): void => {
      if (!isActive) {
        return
      }
      hasReceivedSnapshot = true
      initialSnapshotRetries = 0
      if (snapshotRetryTimer !== undefined) {
        clearTimeout(snapshotRetryTimer)
        snapshotRetryTimer = undefined
      }
      applySnapshot(snapshot)
    }

    const loadSnapshot = (): void => {
      if (!isActive || hasReceivedSnapshot) {
        return
      }
      void loadInitialSnapshot()
        .then((snapshot) => {
          receiveSnapshot(snapshot)
        })
        .catch((cause: unknown) => {
          if (!isActive || hasReceivedSnapshot) {
            return
          }
          if (initialSnapshotRetries >= MAX_INITIAL_SNAPSHOT_RETRIES) {
            setError(cause instanceof Error ? cause.message : 'Unable to load sandbox state.')
            return
          }
          const delay = retryDelay(initialSnapshotRetries)
          initialSnapshotRetries += 1
          snapshotRetryTimer = setTimeout(() => {
            snapshotRetryTimer = undefined
            loadSnapshot()
          }, delay)
        })
    }

    const scheduleWebSocketReconnect = (): void => {
      if (!isActive || webSocketRetryTimer !== undefined) {
        return
      }
      if (webSocketRetries >= MAX_WEBSOCKET_RETRIES) {
        setError('Live state connection could not be restored. Refresh to try again.')
        return
      }
      const delay = retryDelay(webSocketRetries)
      webSocketRetries += 1
      webSocketRetryTimer = setTimeout(() => {
        webSocketRetryTimer = undefined
        connectWebSocket()
      }, delay)
    }

    const connectWebSocket = (): void => {
      if (!isActive) {
        return
      }

      let webSocket: WebSocket
      try {
        webSocket = new WebSocket(sandboxWebSocketUrl())
      } catch {
        setIsConnected(false)
        scheduleWebSocketReconnect()
        return
      }
      activeWebSocket = webSocket

      webSocket.addEventListener('open', () => {
        if (!isActive || activeWebSocket !== webSocket) {
          return
        }
        webSocketRetries = 0
        setIsConnected(true)
      })
      webSocket.addEventListener('close', () => {
        if (!isActive || activeWebSocket !== webSocket) {
          return
        }
        activeWebSocket = undefined
        setIsConnected(false)
        scheduleWebSocketReconnect()
      })
      webSocket.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data)) as SnapshotMessage
          if (message.type === 'snapshot' && isActive && activeWebSocket === webSocket) {
            receiveSnapshot(message)
          }
        } catch {
          if (isActive && activeWebSocket === webSocket) {
            setError('Received an invalid live-state message.')
          }
        }
      })
    }

    // React Strict Mode immediately cleans up its first effect setup. Deferring startup
    // by one task prevents that ephemeral connection from reaching Vite's proxy.
    startTimer = setTimeout(() => {
      startTimer = undefined
      loadSnapshot()
      connectWebSocket()
    }, 0)

    return () => {
      isActive = false
      if (startTimer !== undefined) {
        clearTimeout(startTimer)
      }
      if (snapshotRetryTimer !== undefined) {
        clearTimeout(snapshotRetryTimer)
      }
      if (webSocketRetryTimer !== undefined) {
        clearTimeout(webSocketRetryTimer)
      }
      activeWebSocket?.close()
    }
  }, [applySnapshot])

  const runCommand = useCallback(async (command: ControlCommand): Promise<void> => {
    try {
      setError(undefined)
      setState(await sendControl(command))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The control action failed.')
    }
  }, [])

  const saveInput = useCallback(
    async (inputId: number, update: Omit<AtemInput, 'id'>): Promise<void> => {
      try {
        setError(undefined)
        setState(await updateInput(inputId, update))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not save input settings.')
      }
    },
    [],
  )

  const saveMediaPlayerName = useCallback(
    async (player: MediaPlayerId, name: string): Promise<void> => {
      try {
        setError(undefined)
        setState(await updateMediaPlayer(player, { name }))
        setNotice(`Media Player ${player} name saved.`)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not save Media Player name.')
      }
    },
    [],
  )

  const saveDeviceSettings = useCallback(async (update: DeviceSettingsUpdate): Promise<void> => {
    try {
      setError(undefined)
      const result = await updateDeviceSettings(update)
      setState(result.state)
      setStatus(result.status)
      setNotice('Device settings saved.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save device settings.')
    }
  }, [])

  const createStill = useCallback(
    async (update: {
      name: string
      text: string
      background?: string
      foreground?: string
    }): Promise<boolean> => {
      try {
        setError(undefined)
        setState(await createMediaPoolStill(update))
        setNotice('Custom Media Pool item added.')
        return true
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not create Media Pool item.')
        return false
      }
    },
    [],
  )

  const deleteStill = useCallback(async (slot: number): Promise<void> => {
    try {
      setError(undefined)
      setState(await deleteMediaPoolStill(slot))
      setNotice(`Media Pool item ${String(slot).padStart(2, '0')} deleted.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete Media Pool item.')
    }
  }, [])

  const saveDeviceProfile = useCallback(async (modelId: string): Promise<void> => {
    try {
      setError(undefined)
      const result = await updateDeviceProfile({ modelId })
      setState(result.state)
      setStatus(result.status)
      setNotice(`New ${result.status.deviceModel} sandbox started.`)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not start the selected ATEM sandbox.',
      )
    }
  }, [])

  const exportConfiguration = useCallback(async (): Promise<void> => {
    try {
      setError(undefined)
      await exportSandboxConfiguration()
      setNotice('Sandbox configuration exported.')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not export the sandbox configuration.',
      )
    }
  }, [])

  const importConfigurationFile = useCallback(async (file: File): Promise<void> => {
    let config: unknown
    try {
      config = JSON.parse(await file.text()) as unknown
    } catch {
      setError(`“${file.name}” is not valid JSON.`)
      return
    }

    try {
      setError(undefined)
      const result = await importSandboxConfiguration(config)
      setState(result.state)
      setStatus(result.status)
      setNotice(
        result.restartRequired
          ? 'Sandbox configuration imported. Restart ATEM Sandbox to apply its listener settings.'
          : 'Sandbox configuration imported.',
      )
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not import the sandbox configuration.',
      )
    }
  }, [])

  const resetToDefaultConfiguration = useCallback(async (): Promise<void> => {
    try {
      setError(undefined)
      const result = await resetSandboxToDefaultConfiguration()
      setState(result.state)
      setStatus(result.status)
      setNotice('Sandbox reset to default configuration.')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not reset the sandbox configuration.',
      )
    }
  }, [])

  return {
    state,
    status,
    isConnected,
    error,
    notice,
    clearError: () => setError(undefined),
    clearNotice: () => setNotice(undefined),
    runCommand,
    saveInput,
    saveMediaPlayerName,
    saveDeviceSettings,
    createStill,
    deleteStill,
    saveDeviceProfile,
    exportConfiguration,
    importConfigurationFile,
    resetToDefaultConfiguration,
  }
}

function LoadingScreen({ message }: { message?: string | undefined }): React.JSX.Element {
  return <main className="loading-screen">{message ?? 'Connecting to ATEM Sandbox…'}</main>
}

function OutputPage({ role }: { role: 'program' | 'preview' }): React.JSX.Element {
  const { state, error } = useSandbox()
  if (state === undefined) {
    return <LoadingScreen message={error} />
  }
  return (
    <main className="output-page">
      <Monitor role={role} state={state} bare />
    </main>
  )
}

function InputEditor({
  input,
  onSave,
}: {
  input: AtemInput
  onSave: (inputId: number, update: Omit<AtemInput, 'id'>) => Promise<void>
}): React.JSX.Element {
  const [draft, setDraft] = useState<Omit<AtemInput, 'id'>>(() => ({
    longName: input.longName,
    shortName: input.shortName,
    background: input.background,
    foreground: input.foreground,
  }))

  useEffect(() => {
    setDraft({
      longName: input.longName,
      shortName: input.shortName,
      background: input.background,
      foreground: input.foreground,
    })
  }, [input])

  return (
    <form
      className="input-editor"
      onSubmit={(event) => {
        event.preventDefault()
        void onSave(input.id, draft)
      }}
    >
      <div className="section-heading">
        <div>
          <h2>Input appearance</h2>
          <p>Changes save to the active JSON configuration profile.</p>
        </div>
        <span className="input-editor-id">INPUT {input.id}</span>
      </div>
      <label>
        Long name
        <input
          value={draft.longName}
          maxLength={64}
          onChange={(event) => setDraft({ ...draft, longName: event.target.value })}
        />
      </label>
      <label>
        Short name
        <input
          value={draft.shortName}
          maxLength={12}
          onChange={(event) => setDraft({ ...draft, shortName: event.target.value })}
        />
      </label>
      <label>
        Background
        <span className="colour-field">
          <input
            type="color"
            value={draft.background}
            onChange={(event) =>
              setDraft({ ...draft, background: event.target.value.toUpperCase() })
            }
          />
          <input
            value={draft.background}
            pattern="#[0-9A-Fa-f]{6}"
            onChange={(event) => setDraft({ ...draft, background: event.target.value })}
          />
        </span>
      </label>
      <label>
        Foreground
        <span className="colour-field">
          <input
            type="color"
            value={draft.foreground}
            onChange={(event) =>
              setDraft({ ...draft, foreground: event.target.value.toUpperCase() })
            }
          />
          <input
            value={draft.foreground}
            pattern="#[0-9A-Fa-f]{6}"
            onChange={(event) => setDraft({ ...draft, foreground: event.target.value })}
          />
        </span>
      </label>
      <button className="save-button" type="submit">
        Save input
      </button>
    </form>
  )
}

function MediaPlayerNameEditor({
  player,
  name,
  onSave,
}: {
  player: MediaPlayerId
  name: string
  onSave: (player: MediaPlayerId, name: string) => Promise<void>
}): React.JSX.Element {
  const [draft, setDraft] = useState(name)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setDraft(name)
  }, [name])

  return (
    <form
      className="media-player-name-editor"
      onSubmit={(event) => {
        event.preventDefault()
        const nextName = draft.trim()
        if (nextName.length === 0 || nextName === name) {
          return
        }
        setIsSaving(true)
        void onSave(player, nextName).finally(() => setIsSaving(false))
      }}
    >
      <label>
        MP{player} name
        <input
          value={draft}
          maxLength={20}
          required
          aria-label={`Media Player ${player} name`}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <button
        type="submit"
        className="secondary-button"
        disabled={isSaving || draft.trim() === name}
      >
        {isSaving ? 'Saving…' : 'Save name'}
      </button>
    </form>
  )
}

function SandboxConfigurationControls({
  onExport,
  onImport,
  onRequestResetToDefault,
  resetTriggerRef,
}: {
  onExport: () => Promise<void>
  onImport: (file: File) => Promise<void>
  onRequestResetToDefault: () => void
  resetTriggerRef: React.RefObject<HTMLButtonElement | null>
}): React.JSX.Element {
  const fileInput = useRef<HTMLInputElement>(null)
  const [isBusy, setIsBusy] = useState(false)

  const exportConfiguration = async (): Promise<void> => {
    setIsBusy(true)
    try {
      await onExport()
    } finally {
      setIsBusy(false)
    }
  }

  const selectImportFile = (): void => {
    fileInput.current?.click()
  }

  const importConfiguration = async (file: File): Promise<void> => {
    setIsBusy(true)
    try {
      await onImport(file)
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <section className="sandbox-configuration">
      <div className="sandbox-configuration-meta">
        <div>
          <h2>Configuration</h2>
        </div>
      </div>
      <div className="sandbox-configuration-actions">
        <button
          ref={resetTriggerRef}
          type="button"
          className="secondary-button reset-button"
          disabled={isBusy}
          onClick={onRequestResetToDefault}
        >
          <span>RESET</span>
        </button>
        <button
          type="button"
          className="save-button"
          disabled={isBusy}
          onClick={() => void exportConfiguration()}
        >
          <span>EXPORT</span>
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={isBusy}
          onClick={selectImportFile}
        >
          <span>IMPORT</span>
        </button>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file !== undefined) {
              void importConfiguration(file)
            }
          }}
        />
      </div>
    </section>
  )
}

type SandboxVisualStatus = 'offline' | 'active'

function SandboxStatusPanel({
  recordStatus,
  streamStatus,
  recordDuration,
  streamDuration,
  onToggleRecord,
  onToggleStream,
}: {
  recordStatus: SandboxVisualStatus
  streamStatus: SandboxVisualStatus
  recordDuration: string
  streamDuration: string
  onToggleRecord: () => void
  onToggleStream: () => void
}): React.JSX.Element {
  return (
    <section className="control-card sandbox-status-panel">
      <div className="sandbox-status-grid">
        <article className="sandbox-status-tile">
          <div className="sandbox-status-meta">
            <h2>Recording</h2>
            <span
              className={`sandbox-status-indicator ${recordStatus === 'active' ? 'active' : 'offline record'}`}
              aria-live="polite"
            >
              <span className="sandbox-status-dot" aria-hidden="true" />
              <span>{recordStatus === 'active' ? 'Online' : 'Offline'}</span>
            </span>
            <span className="sandbox-status-duration">{recordDuration}</span>
          </div>
          <button
            type="button"
            className="secondary-button sandbox-status-toggle"
            aria-pressed={recordStatus === 'active'}
            aria-label={recordStatus === 'active' ? 'Stop recording' : 'Start recording'}
            onClick={onToggleRecord}
          >
            {recordStatus === 'active' ? 'Stop recording' : 'Start recording'}
          </button>
        </article>

        <article className="sandbox-status-tile">
          <div className="sandbox-status-meta">
            <h2>Streaming</h2>
            <span
              className={`sandbox-status-indicator ${streamStatus === 'active' ? 'active' : 'offline stream'}`}
              aria-live="polite"
            >
              <span className="sandbox-status-dot" aria-hidden="true" />
              <span>{streamStatus === 'active' ? 'Online' : 'Offline'}</span>
            </span>
            <span className="sandbox-status-duration">{streamDuration}</span>
          </div>
          <button
            type="button"
            className="secondary-button sandbox-status-toggle"
            aria-pressed={streamStatus === 'active'}
            aria-label={streamStatus === 'active' ? 'Stop streaming' : 'Start streaming'}
            onClick={onToggleStream}
          >
            {streamStatus === 'active' ? 'Stop streaming' : 'Start streaming'}
          </button>
        </article>
      </div>
    </section>
  )
}

function formatTimecode(
  timecode:
    | { hours: number; minutes: number; seconds: number; frames: number; isDropFrame: boolean }
    | undefined,
): string {
  if (timecode === undefined) {
    return '00:00:00'
  }
  return [timecode.hours, timecode.minutes, timecode.seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
}

function DownstreamKeyRateField({
  index,
  rate,
  onRunCommand,
}: {
  index: 1 | 2
  rate: number
  onRunCommand: (command: ControlCommand) => Promise<void>
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(rate))

  useEffect(() => {
    setDraft(String(rate))
  }, [rate])

  return (
    <label className="keyer-rate-field">
      Rate
      <input
        type="number"
        min="1"
        max="250"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const nextRate = Number(draft)
          if (Number.isInteger(nextRate) && nextRate >= 1 && nextRate <= 250) {
            void onRunCommand({ type: 'set-downstream-key-rate', index, rate: nextRate })
          } else {
            setDraft(String(rate))
          }
        }}
      />
    </label>
  )
}

function MediaPoolAllocationEditor({
  settings,
  onRunCommand,
}: {
  settings: AtemState['settings']['mediaPool']
  onRunCommand: (command: ControlCommand) => Promise<void>
}): React.JSX.Element {
  const [maxFrameDrafts, setMaxFrameDrafts] = useState<[string, string, string, string]>(
    () => settings.maxFrames.map(String) as [string, string, string, string],
  )
  const [unassignedFramesDraft, setUnassignedFramesDraft] = useState(
    String(settings.unassignedFrames),
  )
  const [isSaving, setIsSaving] = useState(false)
  const settingsKey = `${settings.maxFrames.join(':')}:${String(settings.unassignedFrames)}`

  useEffect(() => {
    setMaxFrameDrafts(settings.maxFrames.map(String) as [string, string, string, string])
    setUnassignedFramesDraft(String(settings.unassignedFrames))
  }, [settingsKey])

  return (
    <form
      className="media-pool-allocation"
      onSubmit={(event) => {
        event.preventDefault()
        const maxFrames = maxFrameDrafts.map(Number) as [number, number, number, number]
        const unassignedFrames = Number(unassignedFramesDraft)
        if (
          [...maxFrames, unassignedFrames].some(
            (value) => !Number.isInteger(value) || value < 0 || value > 65_535,
          )
        ) {
          return
        }
        setIsSaving(true)
        void onRunCommand({ type: 'set-media-pool-settings', maxFrames, unassignedFrames }).finally(
          () => setIsSaving(false),
        )
      }}
    >
      <h3>Frame allocation</h3>
      <div className="media-pool-allocation-fields">
        {maxFrameDrafts.map((value, index) => (
          <label key={`pool-allocation-${index}`}>
            Pool {index + 1}
            <input
              type="number"
              min="0"
              max="65535"
              step="1"
              required
              value={value}
              onChange={(event) => {
                const next = [...maxFrameDrafts] as [string, string, string, string]
                next[index] = event.target.value
                setMaxFrameDrafts(next)
              }}
            />
          </label>
        ))}
        <label>
          Unassigned
          <input
            type="number"
            min="0"
            max="65535"
            step="1"
            required
            value={unassignedFramesDraft}
            onChange={(event) => setUnassignedFramesDraft(event.target.value)}
          />
        </label>
      </div>
      <button type="submit" className="secondary-button" disabled={isSaving}>
        {isSaving ? 'Saving…' : 'Save allocation'}
      </button>
    </form>
  )
}

function KeyerControls({
  profileId,
  upstreamKeys,
  upstreamKeyProperties,
  downstreamKeys,
  selectableSources,
  onRunCommand,
}: {
  profileId: AtemDeviceProfileId
  upstreamKeys: Record<number, boolean>
  upstreamKeyProperties: Record<
    number,
    { mixEffectKeyType: 0 | 1 | 2 | 3; flyEnabled: boolean; fillSource: number; cutSource: number }
  >
  downstreamKeys: Record<number, { onAir: boolean; tie: boolean; rate: number }>
  selectableSources: readonly SourceRef[]
  onRunCommand: (command: ControlCommand) => Promise<void>
}): React.JSX.Element {
  const profile = getAtemDeviceProfile(profileId)
  const upstreamCount = profile.topology.upstreamKeyersPerMixEffect
  const downstreamCount = profile.topology.downstreamKeyers
  const keyTypeOptions: Array<{ value: 0 | 1 | 2 | 3; label: string }> = []
  if (profile.effects.linearLumaKeyers > 0) {
    keyTypeOptions.push({ value: 0, label: 'Luma' })
  }
  if (profile.effects.advancedChromaKeyers > 0) {
    keyTypeOptions.push({ value: 1, label: 'Chroma' })
  }
  if ((profile.effects.patternGenerators ?? 0) > 0) {
    keyTypeOptions.push({ value: 2, label: 'Pattern' })
  }
  if (profile.effects.dves > 0) {
    keyTypeOptions.push({ value: 3, label: 'DVE' })
  }

  return (
    <section className="control-card keyer-controls">
      <div className="keyer-grid">
        <div className="keyer-group">
          <h3>Upstream</h3>
          <div className="keyer-buttons">
            {Array.from({ length: upstreamCount }, (_, index) => {
              const keyIndex = (index + 1) as 1 | 2 | 3 | 4
              const enabled = upstreamKeys[keyIndex] === true
              const keyProps = upstreamKeyProperties[keyIndex] ?? {
                mixEffectKeyType: 0 as const,
                flyEnabled: false,
                fillSource: 1,
                cutSource: 2,
              }
              const fillSourceKnown = selectableSources.some(
                (source) => sourceRefToAtemId(source) === keyProps.fillSource,
              )
              const cutSourceKnown = selectableSources.some(
                (source) => sourceRefToAtemId(source) === keyProps.cutSource,
              )
              return (
                <div key={`usk-${keyIndex}`} className="keyer-dsk-card">
                  <button
                    type="button"
                    className={`keyer-toggle ${enabled ? 'enabled' : ''}`}
                    onClick={() =>
                      void onRunCommand({
                        type: 'set-upstream-key',
                        index: keyIndex,
                        enabled: !enabled,
                      })
                    }
                  >
                    USK {keyIndex} · {enabled ? 'ON' : 'OFF'}
                  </button>
                  <div className="keyer-dsk-actions">
                    <label className="keyer-rate-field">
                      Type
                      <select
                        value={keyProps.mixEffectKeyType}
                        onChange={(event) =>
                          void onRunCommand({
                            type: 'set-upstream-key-type',
                            index: keyIndex,
                            mixEffectKeyType: Number(event.target.value) as 0 | 1 | 2 | 3,
                          })
                        }
                      >
                        {keyTypeOptions.map((option) => (
                          <option key={`usk-type-${option.value}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="keyer-rate-field">
                      Fill
                      <select
                        value={keyProps.fillSource}
                        onChange={(event) =>
                          void onRunCommand({
                            type: 'set-upstream-key-fill-source',
                            index: keyIndex,
                            fillSource: Number(event.target.value),
                          })
                        }
                      >
                        {!fillSourceKnown && (
                          <option value={keyProps.fillSource}>
                            Unknown ({keyProps.fillSource})
                          </option>
                        )}
                        {selectableSources.map((source) => {
                          const sourceId = sourceRefToAtemId(source)
                          return (
                            <option key={`usk-fill-${keyIndex}-${sourceId}`} value={sourceId}>
                              {sourceLabel(source)}
                            </option>
                          )
                        })}
                      </select>
                    </label>
                    <label className="keyer-rate-field">
                      Cut
                      <select
                        value={keyProps.cutSource}
                        onChange={(event) =>
                          void onRunCommand({
                            type: 'set-upstream-key-cut-source',
                            index: keyIndex,
                            cutSource: Number(event.target.value),
                          })
                        }
                      >
                        {!cutSourceKnown && (
                          <option value={keyProps.cutSource}>Unknown ({keyProps.cutSource})</option>
                        )}
                        {selectableSources.map((source) => {
                          const sourceId = sourceRefToAtemId(source)
                          return (
                            <option key={`usk-cut-${keyIndex}-${sourceId}`} value={sourceId}>
                              {sourceLabel(source)}
                            </option>
                          )
                        })}
                      </select>
                    </label>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="keyer-group">
          <h3>Downstream</h3>
          <div className="keyer-buttons">
            {Array.from({ length: downstreamCount }, (_, index) => {
              const keyIndex = (index + 1) as 1 | 2
              const downstreamKey = downstreamKeys[keyIndex] ?? {
                onAir: false,
                tie: false,
                rate: 25,
              }
              const enabled = downstreamKey.onAir === true
              return (
                <div key={`dsk-${keyIndex}`} className="keyer-dsk-card">
                  <button
                    type="button"
                    className={`keyer-toggle ${enabled ? 'enabled' : ''}`}
                    onClick={() =>
                      void onRunCommand({
                        type: 'set-downstream-key',
                        index: keyIndex,
                        enabled: !enabled,
                      })
                    }
                  >
                    DSK {keyIndex} · {enabled ? 'ON' : 'OFF'}
                  </button>
                  <div className="keyer-dsk-actions">
                    <button
                      type="button"
                      className={`keyer-mini-toggle ${downstreamKey.tie ? 'enabled' : ''}`}
                      onClick={() =>
                        void onRunCommand({
                          type: 'set-downstream-key-tie',
                          index: keyIndex,
                          enabled: !downstreamKey.tie,
                        })
                      }
                    >
                      TIE {downstreamKey.tie ? 'ON' : 'OFF'}
                    </button>
                    <button
                      type="button"
                      className="keyer-mini-toggle"
                      onClick={() =>
                        void onRunCommand({ type: 'auto-downstream-key', index: keyIndex })
                      }
                    >
                      AUTO
                    </button>
                    <DownstreamKeyRateField
                      index={keyIndex}
                      rate={downstreamKey.rate}
                      onRunCommand={onRunCommand}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

function AuxiliaryControls({
  profileId,
  auxiliaries,
  selectableSources,
  onRunCommand,
}: {
  profileId: AtemDeviceProfileId
  auxiliaries: Record<number, SourceRef>
  selectableSources: readonly SourceRef[]
  onRunCommand: (command: ControlCommand) => Promise<void>
}): React.JSX.Element {
  const profile = getAtemDeviceProfile(profileId)
  const auxiliaryCount = profile.topology.auxiliaries

  return (
    <section className="control-card auxiliary-controls">
      <div className="aux-grid">
        {Array.from({ length: auxiliaryCount }, (_, index) => {
          const bus = (index + 1) as 1 | 2 | 3 | 4
          const selected = auxiliaries[bus] ?? selectableSources[0]!
          const selectedValue = sourceStableKey(selected)
          return (
            <label key={`aux-${bus}`} className="aux-field">
              <span>AUX {bus}</span>
              <select
                value={selectedValue}
                onChange={(event) => {
                  const nextSource = selectableSources.find((candidate) => {
                    const value = sourceStableKey(candidate)
                    return value === event.target.value
                  })
                  if (nextSource !== undefined) {
                    void onRunCommand({ type: 'set-aux-source', bus, source: nextSource })
                  }
                }}
              >
                {selectableSources.map((source) => {
                  const value = sourceStableKey(source)
                  return (
                    <option key={`aux-source-${value}`} value={value}>
                      {sourceLabel(source)}
                    </option>
                  )
                })}
              </select>
            </label>
          )
        })}
      </div>
    </section>
  )
}

function NumericControl({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return (
    <label className="super-field">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step="1"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = Number(draft)
          if (draft.trim() !== '' && Number.isInteger(next) && next >= min && next <= max)
            onChange(next)
          else setDraft(String(value))
        }}
      />
    </label>
  )
}

function SuperSourceControls({
  state,
  selectableSources,
  onRunCommand,
}: {
  state: AtemState['superSources'][number]
  selectableSources: readonly SourceRef[]
  onRunCommand: (command: ControlCommand) => Promise<void>
}): React.JSX.Element {
  const sourceOptions = [
    { id: 0, label: 'Black' },
    ...selectableSources
      .filter((source) => source.kind !== 'super-source')
      .map((source) => ({
        id: sourceRefToAtemId(source),
        label: sourceLabel(source),
      })),
  ]
  const sourceSelect = (
    label: string,
    value: number,
    onChange: (value: number) => void,
  ): React.JSX.Element => (
    <label className="super-field">
      {label}
      <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {!sourceOptions.some((option) => option.id === value) && (
          <option value={value}>Source {value}</option>
        )}
        {sourceOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
  const setBox = (
    boxId: number,
    props: Partial<NonNullable<(typeof state.boxes)[number]>>,
  ): void => {
    void onRunCommand({ type: 'set-super-source-box', ssrcId: state.index, boxId, props })
  }
  const setArt = (
    props: NonNullable<Extract<ControlCommand, { type: 'set-super-source-properties' }>['props']>,
  ): void => {
    void onRunCommand({ type: 'set-super-source-properties', ssrcId: state.index, props })
  }
  const setBorder = (
    props: NonNullable<Extract<ControlCommand, { type: 'set-super-source-border' }>['props']>,
  ): void => {
    void onRunCommand({ type: 'set-super-source-border', ssrcId: state.index, props })
  }
  const art = state.properties
  const border = state.border
  return (
    <div className="supersource-controls">
      {state.boxes.map(
        (box, boxId) =>
          box && (
            <div className="super-box" key={boxId}>
              <strong>Box {boxId + 1}</strong>
              {sourceSelect('Source', box.source, (source) => setBox(boxId, { source }))}
              {(['x', 'y', 'size'] as const).map((field) => (
                <NumericControl
                  key={field}
                  label={field === 'size' ? 'Size' : field.toUpperCase()}
                  value={box[field]}
                  min={field === 'size' ? 0 : -32768}
                  max={field === 'size' ? 65535 : 32767}
                  onChange={(value) => setBox(boxId, { [field]: value })}
                />
              ))}
              <button
                type="button"
                className={`keyer-mini-toggle ${box.enabled ? 'enabled' : ''}`}
                aria-pressed={box.enabled}
                onClick={() => setBox(boxId, { enabled: !box.enabled })}
              >
                {box.enabled ? 'On' : 'Off'}
              </button>
              <details className="super-crop">
                <summary>Crop</summary>
                <div className="super-fields">
                  <label className="super-check">
                    <input
                      type="checkbox"
                      checked={box.cropped}
                      onChange={(event) => setBox(boxId, { cropped: event.target.checked })}
                    />{' '}
                    Enabled
                  </label>
                  {(['cropTop', 'cropBottom', 'cropLeft', 'cropRight'] as const).map((field) => (
                    <NumericControl
                      key={field}
                      label={field.slice(4)}
                      value={box[field]}
                      min={0}
                      max={65535}
                      onChange={(value) => setBox(boxId, { [field]: value })}
                    />
                  ))}
                </div>
              </details>
            </div>
          ),
      )}
      {art && (
        <details className="super-detail">
          <summary>Art</summary>
          <div className="super-fields">
            {sourceSelect('Fill source', art.artFillSource, (artFillSource) =>
              setArt({ artFillSource }),
            )}
            {sourceSelect('Cut source', art.artCutSource, (artCutSource) =>
              setArt({ artCutSource }),
            )}
            <label className="super-field">
              Placement
              <select
                value={art.artOption}
                onChange={(event) => setArt({ artOption: Number(event.target.value) })}
              >
                <option value={0}>Background</option>
                <option value={1}>Foreground</option>
              </select>
            </label>
            {(['artClip', 'artGain'] as const).map((field) => (
              <NumericControl
                key={field}
                label={field === 'artClip' ? 'Clip' : 'Gain'}
                value={art[field]}
                min={0}
                max={65535}
                onChange={(value) => setArt({ [field]: value })}
              />
            ))}
            <label className="super-check">
              <input
                type="checkbox"
                checked={art.artPreMultiplied}
                onChange={(event) => setArt({ artPreMultiplied: event.target.checked })}
              />{' '}
              Pre-multiplied
            </label>
            <label className="super-check">
              <input
                type="checkbox"
                checked={art.artInvertKey}
                onChange={(event) => setArt({ artInvertKey: event.target.checked })}
              />{' '}
              Invert key
            </label>
          </div>
        </details>
      )}
      {border && (
        <details className="super-detail">
          <summary>Border</summary>
          <div className="super-fields">
            <label className="super-check">
              <input
                type="checkbox"
                checked={border.borderEnabled}
                onChange={(event) => setBorder({ borderEnabled: event.target.checked })}
              />{' '}
              Enabled
            </label>
            <NumericControl
              label="Bevel"
              value={border.borderBevel}
              min={0}
              max={3}
              onChange={(borderBevel) => setBorder({ borderBevel })}
            />
            {(
              [
                ['borderOuterWidth', 'Outer width', 65535],
                ['borderInnerWidth', 'Inner width', 65535],
                ['borderOuterSoftness', 'Outer softness', 255],
                ['borderInnerSoftness', 'Inner softness', 255],
                ['borderBevelSoftness', 'Bevel softness', 255],
                ['borderBevelPosition', 'Bevel position', 255],
                ['borderHue', 'Hue', 65535],
                ['borderSaturation', 'Saturation', 65535],
                ['borderLuma', 'Luma', 65535],
                ['borderLightSourceDirection', 'Light direction', 65535],
                ['borderLightSourceAltitude', 'Light altitude', 255],
              ] as const
            ).map(([field, label, max]) => (
              <NumericControl
                key={field}
                label={label}
                value={border[field]}
                min={0}
                max={max}
                onChange={(value) => setBorder({ [field]: value })}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function AudioInputControl({
  input,
  label,
  onRunCommand,
}: {
  input: AtemState['fairlightAudio']['inputs'][number]
  label: string
  onRunCommand: (command: ControlCommand) => Promise<void>
}): React.JSX.Element {
  const [fader, setFader] = useState(String(input.faderGain / 100))
  useEffect(() => setFader(String(input.faderGain / 100)), [input.faderGain])
  const update = (properties: { mixOption?: 1 | 2 | 4; faderGain?: number }): void => {
    void onRunCommand({
      type: 'set-fairlight-source',
      id: input.id,
      sourceId: input.sourceId,
      properties,
    })
  }
  return (
    <div className="audio-row">
      <strong id={`audio-input-${input.id}`}>{label}</strong>
      <fieldset className="audio-modes" aria-labelledby={`audio-input-${input.id}`}>
        {(
          [
            { value: 1, label: 'Off' },
            { value: 2, label: 'On' },
            { value: 4, label: 'AFV' },
          ] as const
        ).map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={`audio-mode-${input.id}`}
              value={option.value}
              checked={input.mixOption === option.value}
              onChange={() => update({ mixOption: option.value })}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
      <label className="super-field">
        Fader (dB)
        <input
          aria-label={`${label} fader in dB`}
          type="number"
          min="-100"
          max="10"
          step="0.1"
          value={fader}
          onChange={(event) => setFader(event.target.value)}
          onBlur={() => {
            const value = Number(fader)
            if (fader.trim() !== '' && Number.isFinite(value) && value >= -100 && value <= 10)
              update({ faderGain: Math.round(value * 100) })
            else setFader(String(input.faderGain / 100))
          }}
        />
      </label>
    </div>
  )
}

function MacroControls({
  state,
  onRunCommand,
}: {
  state: AtemState['macro']
  onRunCommand: (command: ControlCommand) => Promise<void>
}): React.JSX.Element {
  const [index, setIndex] = useState(0)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [pauseFrames, setPauseFrames] = useState(25)
  const macro = state.macros[index]
  const busy = state.macroRecorder.isRecording || state.macroPlayer.isRunning

  useEffect(() => {
    setName(macro?.name ?? '')
    setDescription(macro?.description ?? '')
  }, [index, macro?.name, macro?.description])

  return (
    <div className="macro-controls">
      <div className="macro-fields">
        <label>
          Slot
          <input
            type="number"
            min="0"
            max={MACRO_COUNT - 1}
            value={index}
            disabled={busy}
            onChange={(event) => setIndex(Number(event.target.value))}
          />
        </label>
        <label>
          Saved macros
          <select
            value={macro === undefined ? '' : String(index)}
            disabled={busy}
            onChange={(event) => setIndex(Number(event.target.value))}
          >
            <option value="">Select a macro</option>
            {Object.entries(state.macros).map(([slot, item]) => (
              <option key={slot} value={slot}>
                {slot}: {item.name || 'Untitled'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input
            value={name}
            maxLength={255}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Description
          <input
            value={description}
            maxLength={1024}
            disabled={busy}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      </div>
      <div className="macro-actions">
        <button
          type="button"
          disabled={busy || !Number.isInteger(index) || index < 0 || index >= MACRO_COUNT}
          onClick={() => {
            if (macro !== undefined && !window.confirm(`Replace macro ${index}?`)) return
            void onRunCommand({
              type: 'macro-start-record',
              index,
              name: name || `Macro ${index}`,
              description,
            })
          }}
        >
          Record
        </button>
        <button
          type="button"
          disabled={!state.macroRecorder.isRecording}
          onClick={() => void onRunCommand({ type: 'macro-stop-record' })}
        >
          Stop recording
        </button>
        <button
          type="button"
          disabled={!state.macroRecorder.isRecording}
          onClick={() => void onRunCommand({ type: 'macro-insert-user-wait' })}
        >
          Insert wait
        </button>
        <label className="macro-pause">
          Frames{' '}
          <input
            type="number"
            min="0"
            max="65535"
            value={pauseFrames}
            onChange={(event) => setPauseFrames(Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          disabled={
            !state.macroRecorder.isRecording ||
            !Number.isInteger(pauseFrames) ||
            pauseFrames < 0 ||
            pauseFrames > 65535
          }
          onClick={() => void onRunCommand({ type: 'macro-add-pause', frames: pauseFrames })}
        >
          Insert pause
        </button>
      </div>
      <div className="macro-actions">
        <button
          type="button"
          disabled={busy || macro === undefined || macro.hasUnsupportedOps}
          onClick={() => void onRunCommand({ type: 'macro-run', index })}
        >
          Run
        </button>
        <button
          type="button"
          disabled={!state.macroPlayer.isWaiting}
          onClick={() => void onRunCommand({ type: 'macro-continue' })}
        >
          Continue
        </button>
        <button
          type="button"
          disabled={!state.macroPlayer.isRunning}
          onClick={() => void onRunCommand({ type: 'macro-stop' })}
        >
          Stop
        </button>
        <label className="macro-loop">
          <input
            type="checkbox"
            checked={state.macroPlayer.loop}
            onChange={(event) =>
              void onRunCommand({ type: 'set-macro-loop', loop: event.target.checked })
            }
          />{' '}
          Loop
        </label>
        <button
          type="button"
          disabled={busy || macro === undefined}
          onClick={() => {
            if (window.confirm(`Delete macro ${index}?`))
              void onRunCommand({ type: 'macro-delete', index })
          }}
        >
          Delete
        </button>
      </div>
      <p className="macro-status" role="status">
        {state.macroRecorder.isRecording
          ? `Recording slot ${state.macroRecorder.macroIndex}`
          : state.macroPlayer.isWaiting
            ? `Macro ${state.macroPlayer.macroIndex} waiting`
            : state.macroPlayer.isRunning
              ? `Running macro ${state.macroPlayer.macroIndex}`
              : 'Idle'}
        {macro?.hasUnsupportedOps && ' | Contains unsupported operations; playback is disabled.'}
        {state.lastError && ` | ${state.lastError}`}
      </p>
    </div>
  )
}

function ControlPage(): React.JSX.Element {
  const {
    state,
    status,
    isConnected,
    error,
    notice,
    clearError,
    clearNotice,
    runCommand,
    saveInput,
    saveMediaPlayerName,
    saveDeviceSettings,
    createStill,
    deleteStill,
    saveDeviceProfile,
    exportConfiguration,
    importConfigurationFile,
    resetToDefaultConfiguration,
  } = useSandbox()
  const [selectedInputId, setSelectedInputId] = useState(1)
  const [rateDraft, setRateDraft] = useState('25')
  const [fadeToBlackRateDraft, setFadeToBlackRateDraft] = useState('50')
  const [deviceNameDraft, setDeviceNameDraft] = useState('')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [pendingDeviceProfile, setPendingDeviceProfile] = useState<
    { id: string; label: string } | undefined
  >()
  const deviceProfileSelectRef = useRef<HTMLButtonElement>(null)
  const videoModePickerRef = useRef<HTMLButtonElement>(null)
  const resetTriggerRef = useRef<HTMLButtonElement>(null)
  const settingsTriggerRef = useRef<HTMLButtonElement>(null)
  const deviceProfileDialogWasOpen = useRef(false)
  const resetDialogWasOpen = useRef(false)
  const [isApplyingDeviceProfile, setIsApplyingDeviceProfile] = useState(false)
  const [isResettingDefaultConfiguration, setIsResettingDefaultConfiguration] = useState(false)
  const [isResetConfirmationOpen, setIsResetConfirmationOpen] = useState(false)
  const [mediaStillDraft, setMediaStillDraft] = useState({
    name: '',
    text: '',
    background: '#1E3A8A',
    foreground: '#FFFFFF',
  })
  const [isCreatingMediaStill, setIsCreatingMediaStill] = useState(false)

  useEffect(() => {
    if (state !== undefined) {
      setRateDraft(String(state.transition.rateFrames))
    }
  }, [state?.transition.rateFrames])

  useEffect(() => {
    if (state !== undefined) {
      setFadeToBlackRateDraft(String(state.fadeToBlack.rate))
    }
  }, [state?.fadeToBlack.rate])

  useEffect(() => {
    if (status !== undefined) {
      setDeviceNameDraft(status.deviceName)
    }
  }, [status?.deviceName])

  useEffect(() => {
    const isOpen = pendingDeviceProfile !== undefined
    if (deviceProfileDialogWasOpen.current && !isOpen) {
      deviceProfileSelectRef.current?.focus()
    }
    deviceProfileDialogWasOpen.current = isOpen
  }, [pendingDeviceProfile])

  useEffect(() => {
    if (resetDialogWasOpen.current && !isResetConfirmationOpen) {
      resetTriggerRef.current?.focus()
    }
    resetDialogWasOpen.current = isResetConfirmationOpen
  }, [isResetConfirmationOpen])

  useEffect(() => {
    if (
      (pendingDeviceProfile === undefined && !isResetConfirmationOpen) ||
      isApplyingDeviceProfile ||
      isResettingDefaultConfiguration
    ) {
      return
    }

    const handleKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setPendingDeviceProfile(undefined)
        setIsResetConfirmationOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => {
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [
    isApplyingDeviceProfile,
    isResetConfirmationOpen,
    isResettingDefaultConfiguration,
    pendingDeviceProfile,
  ])

  const confirmResetConfiguration = (): void => {
    setIsResettingDefaultConfiguration(true)
    void resetToDefaultConfiguration().finally(() => {
      setIsResettingDefaultConfiguration(false)
      setIsResetConfirmationOpen(false)
    })
  }

  useEffect(() => {
    if (notice === undefined) {
      return
    }

    const timer = setTimeout(() => {
      clearNotice()
    }, 3000)

    return () => {
      clearTimeout(timer)
    }
  }, [clearNotice, notice])

  const selectedInput = useMemo(
    () => state?.inputs.find((input) => input.id === selectedInputId) ?? state?.inputs[0],
    [selectedInputId, state],
  )

  if (state === undefined || status === undefined) {
    return <LoadingScreen message={error} />
  }

  const hardwareProfileUrl = resolveHardwareProfileUrl(status.deviceProfileId)
  const protocolVersion = (status as RuntimeStatus & { protocolVersion?: string }).protocolVersion
  const currentDeviceProfile = getAtemDeviceProfile(status.deviceProfileId as AtemDeviceProfileId)
  const supportsMediaPlayers = currentDeviceProfile.supportsMediaPlayers
  const supportedMediaPlayerIds: MediaPlayerId[] =
    currentDeviceProfile.topology.mediaPlayers === 1 ? [1] : [1, 2]
  const selectableSources = availableSources(
    state,
    currentDeviceProfile.topology.mediaPlayers,
  ).filter(
    (source) =>
      source.kind !== 'media-player' ||
      (supportsMediaPlayers && supportedMediaPlayerIds.includes(source.player)),
  )
  const recordStatus: SandboxVisualStatus =
    (state.recording.status.state & ATEM_RECORDING_STATUS_RECORDING) ===
    ATEM_RECORDING_STATUS_RECORDING
      ? 'active'
      : 'offline'
  const streamStatus: SandboxVisualStatus =
    (state.streaming.status.state & ATEM_STREAMING_STATUS_STREAMING) ===
    ATEM_STREAMING_STATUS_STREAMING
      ? 'active'
      : 'offline'
  const recordDuration = formatTimecode(state.recording.duration)
  const streamDuration = formatTimecode(state.streaming.duration)

  const selectPreview = (source: SourceRef): void => {
    void runCommand({ type: 'set-preview', source })
  }

  const confirmDeviceProfileChange = (): void => {
    if (pendingDeviceProfile === undefined) {
      return
    }

    const nextDeviceProfileId = pendingDeviceProfile.id
    setIsApplyingDeviceProfile(true)

    void saveDeviceProfile(nextDeviceProfileId).finally(() => {
      setIsApplyingDeviceProfile(false)
      setPendingDeviceProfile(undefined)
    })
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            A
          </div>
          <div>
            <h1>ATEM Sandbox</h1>
            <p className="eyebrow">{status.deviceModel}</p>
          </div>
        </div>
        <div className="header-actions">
          <div className={`connection-badge ${isConnected ? 'connected' : ''}`}>
            <span aria-hidden="true" />
            {isConnected ? `Connected · ${status.host}:${status.atemPort}` : 'Connecting…'}
          </div>
          <button
            ref={settingsTriggerRef}
            className="secondary-button settings-trigger"
            type="button"
            onClick={() => setIsSettingsOpen(true)}
          >
            Settings
          </button>
        </div>
      </header>

      {error !== undefined && (
        <aside className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={clearError} aria-label="Dismiss error">
            ×
          </button>
        </aside>
      )}

      {notice !== undefined && (
        <aside className="notice-banner" role="status">
          <span>{notice}</span>
          <button type="button" onClick={clearNotice} aria-label="Dismiss notice">
            ×
          </button>
        </aside>
      )}

      {isSettingsOpen && (
        <div
          className="settings-backdrop"
          onClick={() => {
            if (pendingDeviceProfile === undefined && !isResetConfirmationOpen) {
              setIsSettingsOpen(false)
              settingsTriggerRef.current?.focus()
            }
          }}
        >
          <aside
            className="settings-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (pendingDeviceProfile === undefined && !isResetConfirmationOpen) {
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  setIsSettingsOpen(false)
                  settingsTriggerRef.current?.focus()
                } else trapDialogTabKeyDown(event)
              }
            }}
          >
            <header className="settings-header">
              <h2 id="settings-title">Settings</h2>
              <button
                className="secondary-button settings-close"
                type="button"
                aria-label="Close settings"
                autoFocus
                onClick={() => {
                  setIsSettingsOpen(false)
                  settingsTriggerRef.current?.focus()
                }}
              >
                ×
              </button>
            </header>
            <section className="status-strip" aria-label="Sandbox status">
              <div className="status-item status-item-model">
                <div className="status-model-head">
                  <span className="status-label">ATEM model</span>
                  <a
                    className="model-product-link"
                    href={hardwareProfileUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {status.deviceProfileId === 'atem-mini-extreme-iso'
                      ? 'View ATEM Mini specs ↗'
                      : 'View product page ↗'}
                  </a>
                </div>
                <OptionPicker
                  options={status.deviceProfiles}
                  value={status.deviceProfileId}
                  ariaLabel="ATEM model"
                  idPrefix="atem-device-profile"
                  triggerRef={deviceProfileSelectRef}
                  onSelect={(profile) => {
                    if (profile.id !== status.deviceProfileId) {
                      setPendingDeviceProfile({ id: profile.id, label: profile.label })
                    }
                  }}
                />
                <div className="device-settings-inline">
                  <label className="device-settings-field">
                    <span className="status-label">Device name</span>
                    <input
                      value={deviceNameDraft}
                      maxLength={64}
                      required
                      onChange={(event) => setDeviceNameDraft(event.target.value)}
                      onBlur={() => {
                        const name = deviceNameDraft.trim()
                        if (name.length === 0) {
                          setDeviceNameDraft(status.deviceName)
                        } else if (name !== status.deviceName) {
                          void saveDeviceSettings({ name })
                        }
                      }}
                    />
                  </label>
                  <label className="device-settings-field">
                    <span className="status-label">Video mode</span>
                    <OptionPicker
                      options={VIDEO_MODE_OPTIONS}
                      value={status.videoMode}
                      ariaLabel="Video mode"
                      idPrefix="atem-video-mode"
                      triggerRef={videoModePickerRef}
                      onSelect={(option) =>
                        void saveDeviceSettings({
                          videoMode: option.id as RuntimeStatus['videoMode'],
                        })
                      }
                    />
                  </label>
                </div>
              </div>
              <div className="status-network-stack">
                <div className="status-item status-network-endpoint">
                  <span className="status-label">ATEM endpoint - UDP</span>
                  <div className="status-network-endpoint-line">
                    <strong className="status-primary">
                      {status.host}:{status.atemPort}
                    </strong>
                    <strong
                      className={`status-primary status-protocol ${status.atemProtocol === 'listening' ? 'running' : 'pending'}`}
                      aria-label={
                        status.atemProtocol === 'listening'
                          ? `ATEM protocol listening, ${status.atemClients} client${status.atemClients === 1 ? '' : 's'}`
                          : 'ATEM protocol stopped'
                      }
                    >
                      {status.atemProtocol === 'listening' && (
                        <span className="status-dot" aria-hidden="true" />
                      )}
                      {status.atemProtocol === 'listening'
                        ? `${status.atemClients} client${status.atemClients === 1 ? '' : 's'}`
                        : 'Stopped'}
                    </strong>
                  </div>
                  {protocolVersion !== undefined && protocolVersion.length > 0 && (
                    <small className="status-helper">Protocol version {protocolVersion}</small>
                  )}
                </div>
                <div className="status-item">
                  <span className="status-label">Web UI clients</span>
                  <strong className="status-primary">{status.connectedClients} connected</strong>
                </div>
              </div>
              <SandboxConfigurationControls
                onExport={exportConfiguration}
                onImport={importConfigurationFile}
                onRequestResetToDefault={() => setIsResetConfirmationOpen(true)}
                resetTriggerRef={resetTriggerRef}
              />
            </section>
            <section className="settings-tool-section" aria-labelledby="diagnostics-title">
              <div>
                <h3 id="diagnostics-title">Diagnostics</h3>
                <p>Inspect runtime activity and errors in a separate window.</p>
              </div>
              <button
                className="secondary-button settings-console-button"
                type="button"
                onClick={() => {
                  window.open('/console', 'atem-sandbox-console', 'popup=yes,width=1080,height=720')
                }}
              >
                Open logs / console <span aria-hidden="true">↗</span>
              </button>
            </section>
          </aside>
        </div>
      )}

      <div className="workspace-head">
        <h2>Switcher</h2>
      </div>
      <section className="dashboard-layout">
        <div className="dashboard-left">
          <div className="dashboard-status">
            <SandboxStatusPanel
              recordStatus={recordStatus}
              streamStatus={streamStatus}
              recordDuration={recordDuration}
              streamDuration={streamDuration}
              onToggleRecord={() =>
                void runCommand({
                  type: 'set-recording-status',
                  enabled: recordStatus !== 'active',
                })
              }
              onToggleStream={() =>
                void runCommand({
                  type: 'set-streaming-status',
                  enabled: streamStatus !== 'active',
                })
              }
            />
          </div>

          <section className="monitor-grid dashboard-monitors">
            <Monitor role="preview" state={state} />
            <Monitor role="program" state={state} />
          </section>
        </div>

        <div className="dashboard-right">
          <section
            className="control-card transition-controls transition-controls-docked dashboard-transition"
            aria-label="Transition controls"
          >
            <div className="transition-settings-grid">
              <div className="transition-setting-group transition-type-group">
                <h3 className="transition-setting-label">Transition type</h3>
                <div className="transition-type-buttons" aria-label="Transition type">
                  {(['mix', 'dip', 'wipe'] as const).map((type) => (
                    <button
                      key={type}
                      className={state.transition.type === type ? 'selected' : ''}
                      type="button"
                      aria-pressed={state.transition.type === type}
                      onClick={() =>
                        void runCommand({ type: 'set-transition-type', transitionType: type })
                      }
                    >
                      {type[0]!.toUpperCase() + type.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="transition-setting-group transition-rates-group">
                <h3 className="transition-setting-label">Rates</h3>
                <label className="rate-control" aria-label="Transition rate">
                  <span className="rate-control-caption">Transition rate</span>
                  <div className="rate-input-line">
                    <input
                      type="number"
                      min="1"
                      max="250"
                      value={rateDraft}
                      onChange={(event) => setRateDraft(event.target.value)}
                      onBlur={() => {
                        const rateFrames = Number(rateDraft)
                        if (Number.isInteger(rateFrames) && rateFrames >= 1 && rateFrames <= 250) {
                          void runCommand({ type: 'set-transition-rate', rateFrames })
                        }
                      }}
                    />
                    <span className="rate-unit">frames</span>
                  </div>
                </label>
                <label className="rate-control fade-to-black-rate-control">
                  <span className="rate-control-caption">Fade to black</span>
                  <div className="rate-input-line">
                    <input
                      type="number"
                      min="1"
                      max="250"
                      aria-label="Fade to black rate"
                      value={fadeToBlackRateDraft}
                      onChange={(event) => setFadeToBlackRateDraft(event.target.value)}
                      onBlur={() => {
                        const rate = Number(fadeToBlackRateDraft)
                        if (Number.isInteger(rate) && rate >= 1 && rate <= 250) {
                          void runCommand({ type: 'set-fade-to-black-rate', rate })
                        } else {
                          setFadeToBlackRateDraft(String(state.fadeToBlack.rate))
                        }
                      }}
                    />
                    <span className="rate-unit">frames</span>
                  </div>
                </label>
              </div>
            </div>

            <div className="transition-action-row">
              <button
                className="cut-button"
                type="button"
                onClick={() => void runCommand({ type: 'cut' })}
              >
                Cut
              </button>
              <button
                className="auto-button"
                type="button"
                onClick={() => void runCommand({ type: 'auto' })}
              >
                Auto
              </button>
              <button
                className="fade-to-black-button"
                type="button"
                aria-label="Fade to black"
                aria-pressed={state.fadeToBlack.isFullyBlack}
                title="Fade to black or restore picture"
                onClick={() => void runCommand({ type: 'fade-to-black' })}
              >
                {state.fadeToBlack.isFullyBlack ? 'RESTORE' : 'FTB'}
              </button>
            </div>
          </section>
        </div>
      </section>

      <section className="control-card inputs-section">
        <div className="section-heading">
          <div>
            <h2>Inputs</h2>
          </div>
        </div>
        <div className="input-grid">
          {selectableSources.map((source) => {
            const surface = resolveSourceSurface(state, source)
            const isPreview = isSelectedSource(source, state.preview)
            const isProgram = isSelectedSource(source, state.program)
            return (
              <div
                key={sourceStableKey(source)}
                className={`input-tile ${isPreview ? 'on-preview' : ''} ${isProgram ? 'on-program' : ''}`}
              >
                <button
                  type="button"
                  className="input-preview-action"
                  aria-label={`Set ${sourceTitle(state, source)} to Preview`}
                  aria-pressed={isPreview}
                  onClick={() => selectPreview(source)}
                >
                  <SourceCanvas state={state} surface={surface} />
                  <span className="tile-label">{sourceButtonLabel(state, source)}</span>
                  <span className="tile-routing">
                    {isProgram && 'PROGRAM'}
                    {isProgram && isPreview && ' · '}
                    {isPreview && 'PREVIEW'}
                  </span>
                </button>
                <button
                  type="button"
                  className="tile-program-action"
                  aria-label={`Set ${sourceTitle(state, source)} to Program`}
                  title={`Set ${sourceTitle(state, source)} to Program`}
                  aria-pressed={isProgram}
                  onClick={() => void runCommand({ type: 'set-program', source })}
                >
                  SET PGM
                </button>
              </div>
            )
          })}
        </div>
      </section>

      <details className="disclosure-section">
        <summary>
          <span>Macros</span>
          <small>{Object.keys(state.macro.macros).length} saved</small>
        </summary>
        <MacroControls state={state.macro} onRunCommand={runCommand} />
      </details>

      <details className="disclosure-section">
        <summary>
          <span>Input appearance</span>
        </summary>
        <section className="control-card appearance-card">
          <div className="input-picker">
            {state.inputs.map((input) => (
              <button
                key={input.id}
                type="button"
                className={selectedInput?.id === input.id ? 'selected' : ''}
                aria-pressed={selectedInput?.id === input.id}
                onClick={() => setSelectedInputId(input.id)}
              >
                {input.shortName}
              </button>
            ))}
          </div>
          {selectedInput !== undefined && <InputEditor input={selectedInput} onSave={saveInput} />}
        </section>
      </details>

      {state.superSources.map((superSource) => (
        <details className="disclosure-section" key={superSource.index}>
          <summary>
            <span>
              SuperSource{state.superSources.length > 1 ? ` ${superSource.index + 1}` : ''}
            </span>
            <small>{superSource.boxes.filter(Boolean).length} boxes</small>
          </summary>
          <p className="capability-note">
            Simulated sources and stills are composited. Art keying and borders are approximate;
            border bevel, softness, and lighting are not rendered.
          </p>
          <SuperSourceControls
            state={superSource}
            selectableSources={selectableSources}
            onRunCommand={runCommand}
          />
        </details>
      ))}

      <details className="disclosure-section">
        <summary>
          <span>Keyers</span>
          <small>
            {currentDeviceProfile.topology.upstreamKeyersPerMixEffect} upstream ·{' '}
            {currentDeviceProfile.topology.downstreamKeyers} downstream
          </small>
        </summary>
        <KeyerControls
          profileId={status.deviceProfileId as AtemDeviceProfileId}
          upstreamKeys={state.upstreamKeys}
          upstreamKeyProperties={state.upstreamKeyProperties}
          downstreamKeys={state.downstreamKeys}
          selectableSources={selectableSources}
          onRunCommand={runCommand}
        />
      </details>

      <details className="disclosure-section">
        <summary>
          <span>Media</span>
          <small>
            {state.mediaPool.stills.length} stills · {supportedMediaPlayerIds.length} players
          </small>
        </summary>
        <section
          className={`control-card media-pool ${supportsMediaPlayers ? '' : 'unsupported-card'}`}
          aria-disabled={!supportsMediaPlayers}
        >
          {!supportsMediaPlayers ? (
            <div className="unsupported-panel" role="note" aria-live="polite">
              <strong>Media Player items unavailable</strong>
              <p>Unsupported on device: {status.deviceModel}</p>
            </div>
          ) : (
            <>
              <MediaPoolAllocationEditor
                settings={state.settings.mediaPool}
                onRunCommand={runCommand}
              />
              <div className="media-player-name-grid" aria-label="Media Player names">
                {supportedMediaPlayerIds.map((player) => (
                  <MediaPlayerNameEditor
                    key={`player-name-${player}`}
                    player={player}
                    name={state.mediaPlayers[player].name}
                    onSave={saveMediaPlayerName}
                  />
                ))}
              </div>
              <form
                className="media-item-editor"
                onSubmit={(event) => {
                  event.preventDefault()
                  const name = mediaStillDraft.name.trim()
                  const text = mediaStillDraft.text.trim()
                  if (name.length === 0 || text.length === 0) {
                    return
                  }

                  setIsCreatingMediaStill(true)
                  void createStill({
                    name,
                    text,
                    background: mediaStillDraft.background,
                    foreground: mediaStillDraft.foreground,
                  })
                    .then((created) => {
                      if (created) {
                        setMediaStillDraft((draft) => ({ ...draft, name: '', text: '' }))
                      }
                    })
                    .finally(() => {
                      setIsCreatingMediaStill(false)
                    })
                }}
              >
                <label>
                  Name
                  <input
                    value={mediaStillDraft.name}
                    maxLength={64}
                    required
                    onChange={(event) =>
                      setMediaStillDraft({ ...mediaStillDraft, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Text
                  <input
                    value={mediaStillDraft.text}
                    maxLength={160}
                    required
                    onChange={(event) =>
                      setMediaStillDraft({ ...mediaStillDraft, text: event.target.value })
                    }
                  />
                </label>
                <label>
                  Background
                  <input
                    type="color"
                    value={mediaStillDraft.background}
                    onChange={(event) =>
                      setMediaStillDraft({ ...mediaStillDraft, background: event.target.value })
                    }
                  />
                </label>
                <label>
                  Foreground
                  <input
                    type="color"
                    value={mediaStillDraft.foreground}
                    onChange={(event) =>
                      setMediaStillDraft({ ...mediaStillDraft, foreground: event.target.value })
                    }
                  />
                </label>
                <button type="submit" disabled={isCreatingMediaStill}>
                  {isCreatingMediaStill ? 'Adding…' : 'Add item'}
                </button>
              </form>
              <div className="still-list">
                {state.mediaPool.stills.map((still) => {
                  const isDefaultStill = still.slot === 1 || still.slot === 2
                  const assignedPlayers = supportedMediaPlayerIds.filter(
                    (player) => state.mediaPlayers[player].slot === still.slot,
                  )
                  const canDelete = !isDefaultStill && assignedPlayers.length === 0
                  const deleteHint = isDefaultStill
                    ? 'Default Media Pool items cannot be deleted.'
                    : assignedPlayers.length > 0
                      ? `Cannot delete while assigned to ${assignedPlayers
                          .map((player) => `Media Player ${player}`)
                          .join(' and ')}`
                      : `Delete ${still.name}`

                  return (
                    <article key={still.slot} className="still-row">
                      <span className="still-slot">{String(still.slot).padStart(2, '0')}</span>
                      <span>
                        <strong>{still.name}</strong>
                        <small>{still.type === 'image' ? still.file : still.text}</small>
                      </span>
                      {supportedMediaPlayerIds.map((player) => (
                        <button
                          key={`player-${player}`}
                          type="button"
                          className={`still-row-load player-${player}`}
                          aria-label={`Load ${still.name} into ${state.mediaPlayers[player].name}`}
                          title={`Load ${still.name} into ${state.mediaPlayers[player].name}`}
                          onClick={() =>
                            void runCommand({
                              type: 'select-media-player-still',
                              player,
                              slot: still.slot,
                            })
                          }
                        >
                          Load to MP{player}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="still-row-delete"
                        disabled={!canDelete}
                        aria-label={`Delete ${still.name}`}
                        title={deleteHint}
                        onClick={() => void deleteStill(still.slot)}
                      >
                        Delete
                      </button>
                    </article>
                  )
                })}
              </div>
            </>
          )}
        </section>
      </details>

      <details className="disclosure-section">
        <summary>
          <span>Audio</span>
          <small>{Object.keys(state.fairlightAudio.inputs).length} inputs</small>
        </summary>
        <div className="audio-list">
          {Object.values(state.fairlightAudio.inputs).map((input, index) => (
            <AudioInputControl
              key={input.id}
              input={input}
              label={`${status.deviceProfileId === 'atem-mini-extreme-iso-g2' ? 'XLR' : 'Mic'} ${index + 1}`}
              onRunCommand={runCommand}
            />
          ))}
        </div>
      </details>

      <details className="disclosure-section">
        <summary>
          <span>Aux outputs</span>
          <small>{currentDeviceProfile.topology.auxiliaries} outputs</small>
        </summary>
        <AuxiliaryControls
          profileId={status.deviceProfileId as AtemDeviceProfileId}
          auxiliaries={state.auxiliaries}
          selectableSources={selectableSources}
          onRunCommand={runCommand}
        />
      </details>

      {pendingDeviceProfile !== undefined && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!isApplyingDeviceProfile) {
              setPendingDeviceProfile(undefined)
            }
          }}
        >
          <section
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="device-profile-confirm-title"
            aria-describedby="device-profile-confirm-description"
            tabIndex={-1}
            onKeyDown={trapDialogTabKeyDown}
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            <h2 id="device-profile-confirm-title">Switch sandbox model?</h2>
            <p id="device-profile-confirm-description">
              Switch to {pendingDeviceProfile.label}?
              <br />
              This starts a fresh profile and replaces custom settings and Media Pool items. Export
              the current configuration first if you want to keep them.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={isApplyingDeviceProfile}
                onClick={() => setPendingDeviceProfile(undefined)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="save-button"
                autoFocus
                disabled={isApplyingDeviceProfile}
                onClick={confirmDeviceProfileChange}
              >
                {isApplyingDeviceProfile ? 'Switching…' : 'Switch model'}
              </button>
            </div>
          </section>
        </div>
      )}

      {isResetConfirmationOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!isResettingDefaultConfiguration) {
              setIsResetConfirmationOpen(false)
            }
          }}
        >
          <section
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-default-confirm-title"
            aria-describedby="reset-default-confirm-description"
            tabIndex={-1}
            onKeyDown={trapDialogTabKeyDown}
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            <h2 id="reset-default-confirm-title">Reset sandbox to defaults?</h2>
            <p id="reset-default-confirm-description">
              This restores default routing, appearance, transition, keyer, auxiliary, and Media
              Pool settings. Export the current configuration first if you want to keep them.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={isResettingDefaultConfiguration}
                onClick={() => setIsResetConfirmationOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="save-button"
                autoFocus
                disabled={isResettingDefaultConfiguration}
                onClick={confirmResetConfiguration}
              >
                {isResettingDefaultConfiguration ? 'Resetting…' : 'Reset to default'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

function ConsolePage(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<LogSnapshot>()
  const [error, setError] = useState<string>()
  const [level, setLevel] = useState<'all' | LogEntry['level']>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    let active = true
    const refresh = async (): Promise<void> => {
      try {
        const nextSnapshot = await loadRecentLogs()
        if (active) {
          setSnapshot(nextSnapshot)
          setError(undefined)
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Could not load runtime logs.')
        }
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), 1000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  const normalizedSearch = search.trim().toLocaleLowerCase()
  const entries = (snapshot?.entries ?? []).filter((entry) => {
    return (
      (level === 'all' || entry.level === level) &&
      (normalizedSearch.length === 0 ||
        `${entry.timestamp} ${entry.message}`.toLocaleLowerCase().includes(normalizedSearch))
    )
  })

  return (
    <main className="console-shell">
      <header className="console-header">
        <div>
          <p className="console-kicker">ATEM SANDBOX / DIAGNOSTICS</p>
          <h1>Runtime console</h1>
        </div>
        <a className="secondary-button" href="/">
          Back to switcher
        </a>
      </header>
      <div className="console-toolbar">
        <label>
          <span>Level</span>
          <select value={level} onChange={(event) => setLevel(event.target.value as typeof level)}>
            <option value="all">All levels</option>
            <option value="error">Errors</option>
            <option value="warn">Warnings</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>
        </label>
        <label className="console-search">
          <span>Search</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter messages"
          />
        </label>
        <span className="console-count">{entries.length} entries</span>
      </div>
      {snapshot !== undefined && (
        <p className={`console-debug-state ${snapshot.debugEnabled ? 'enabled' : ''}`}>
          {snapshot.debugEnabled
            ? 'Verbose logging is enabled.'
            : 'Verbose logging is off. Restart with --debug to include debug entries.'}
        </p>
      )}
      {error !== undefined && (
        <p className="console-error" role="alert">
          {error}
        </p>
      )}
      <section className="console-log" aria-label="Runtime log entries" aria-live="polite">
        {entries.length === 0 ? (
          <p className="console-empty">No matching log entries.</p>
        ) : (
          [...entries].reverse().map((entry, index) => (
            <article
              className={`console-entry level-${entry.level}`}
              key={`${entry.timestamp}-${index}`}
            >
              <time dateTime={entry.timestamp}>
                {new Date(entry.timestamp).toLocaleTimeString()}
              </time>
              <strong>{entry.level}</strong>
              <pre>{entry.message}</pre>
            </article>
          ))
        )}
      </section>
    </main>
  )
}

export function App(): React.JSX.Element {
  useEffect(() => {
    const markKeyboardNavigation = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') {
        document.documentElement.dataset.inputModality = 'keyboard'
      }
    }
    const markPointerNavigation = (): void => {
      document.documentElement.dataset.inputModality = 'pointer'
    }

    window.addEventListener('keydown', markKeyboardNavigation, true)
    window.addEventListener('pointerdown', markPointerNavigation, true)
    return () => {
      window.removeEventListener('keydown', markKeyboardNavigation, true)
      window.removeEventListener('pointerdown', markPointerNavigation, true)
    }
  }, [])

  const pathname = window.location.pathname
  if (pathname === '/console') {
    return <ConsolePage />
  }
  if (pathname === '/output/program') {
    return <OutputPage role="program" />
  }
  if (pathname === '/output/preview') {
    return <OutputPage role="preview" />
  }
  return <ControlPage />
}
