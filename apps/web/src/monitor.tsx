import type { CSSProperties } from 'react'
import { resolveSourceSurface, type AtemState, type SourceSurface } from '@atem-sandbox/atem-state'
import { SuperSourceCanvas } from './super-source.js'

interface SourceCanvasProps {
  surface: SourceSurface
  state: AtemState
  className?: string
  opacity?: number
  style?: CSSProperties
}

function mediaUrl(file: string): string {
  return `/media/${file
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`
}

export function SourceCanvas({
  surface,
  state,
  className = '',
  opacity,
  style,
}: SourceCanvasProps): React.JSX.Element {
  const canvasStyle: CSSProperties = {
    background: surface.background,
    color: surface.foreground,
    opacity,
    ...style,
  }
  if (surface.kind === 'super-source') {
    return (
      <div className={`source-canvas composite-canvas ${className}`} style={canvasStyle}>
        <SuperSourceCanvas state={state} />
      </div>
    )
  }
  if (surface.kind === 'image-still' && surface.mediaFile !== null) {
    return (
      <div className={`source-canvas image-canvas ${className}`} style={canvasStyle}>
        <img alt={surface.text} src={mediaUrl(surface.mediaFile)} />
        <span className="source-caption">{surface.subtitle}</span>
      </div>
    )
  }

  return (
    <div className={`source-canvas ${className}`} style={canvasStyle}>
      <span className="source-text">{surface.text}</span>
      <span className="source-caption">{surface.subtitle}</span>
    </div>
  )
}

function renderTransitionFrame(
  state: AtemState,
  type: AtemState['transition']['type'],
  fromSurface: SourceSurface,
  toSurface: SourceSurface,
  position: number,
): React.JSX.Element {
  const progress = Math.min(1, Math.max(0, position))

  switch (type) {
    case 'dip': {
      const dippingToBlack = progress < 0.5
      const blackoutOpacity = dippingToBlack ? progress * 2 : (1 - progress) * 2
      return (
        <>
          <SourceCanvas
            state={state}
            surface={dippingToBlack ? fromSurface : toSurface}
            className="transition-layer"
          />
          <div
            className="transition-layer transition-blackout"
            style={{ opacity: blackoutOpacity }}
          />
          <span className="transition-readout">DIP {Math.round(progress * 100)}%</span>
        </>
      )
    }
    case 'wipe':
      return (
        <>
          <SourceCanvas state={state} surface={fromSurface} className="transition-layer" />
          <SourceCanvas
            state={state}
            surface={toSurface}
            className="transition-layer transition-incoming transition-wipe"
            style={{ clipPath: `inset(0 ${String((1 - progress) * 100)}% 0 0)` }}
          />
          <span className="transition-readout">WIPE {Math.round(progress * 100)}%</span>
        </>
      )
    case 'mix':
    default:
      return (
        <>
          <SourceCanvas state={state} surface={fromSurface} className="transition-layer" />
          <SourceCanvas
            state={state}
            surface={toSurface}
            className="transition-layer transition-incoming"
            opacity={progress}
          />
          <span className="transition-readout">MIX {Math.round(progress * 100)}%</span>
        </>
      )
  }
}

interface MonitorProps {
  role: 'program' | 'preview'
  state: AtemState
  bare?: boolean
}

export function Monitor({ role, state, bare = false }: MonitorProps): React.JSX.Element {
  const isProgram = role === 'program'
  const activeSource = isProgram ? state.program : state.preview
  const surface = resolveSourceSurface(state, activeSource)
  const transition = state.transition
  const fromSurface =
    isProgram && transition.inTransition && transition.fromProgram !== null
      ? resolveSourceSurface(state, transition.fromProgram)
      : undefined
  const toSurface =
    isProgram && transition.inTransition && transition.toProgram !== null
      ? resolveSourceSurface(state, transition.toProgram)
      : undefined
  const isTransitioning = fromSurface !== undefined && toSurface !== undefined
  const fadeToBlack = state.fadeToBlack
  const fadeToBlackOpacity = isProgram
    ? fadeToBlack.inTransition
      ? fadeToBlack.isFullyBlack
        ? fadeToBlack.remainingFrames / fadeToBlack.rate
        : 1 - fadeToBlack.remainingFrames / fadeToBlack.rate
      : fadeToBlack.isFullyBlack
        ? 1
        : 0
    : 0

  return (
    <section
      className={`monitor monitor-${role} ${bare ? 'monitor-bare' : ''}`}
      aria-label={`${role} monitor`}
    >
      {!bare && (
        <header className="monitor-header">
          <span className="monitor-role">{role.toUpperCase()}</span>
          <a
            className="monitor-external-link"
            href={`/output/${role}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${role} external monitor in a new tab`}
            title={`Open ${role} external monitor in a new tab`}
          >
            -{' \u00a0'}External Monitor
          </a>
          <span className="monitor-source-name">{surface.title}</span>
        </header>
      )}
      <div className="monitor-frame">
        {isTransitioning && fromSurface !== undefined && toSurface !== undefined ? (
          renderTransitionFrame(state, transition.type, fromSurface, toSurface, transition.position)
        ) : (
          <SourceCanvas state={state} surface={surface} />
        )}
        {fadeToBlackOpacity > 0 && (
          <div
            className="transition-layer transition-blackout fade-to-black-overlay"
            style={{ opacity: Math.min(1, Math.max(0, fadeToBlackOpacity)) }}
            aria-hidden="true"
          />
        )}
      </div>
    </section>
  )
}
