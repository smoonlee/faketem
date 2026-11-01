import { useEffect, useRef } from 'react'
import {
  resolveSourceSurface,
  type AtemState,
  type SuperSourceBoxState,
} from '@atem-sandbox/atem-state'
import { atemIdToSourceRef } from '@atem-sandbox/shared'

const WIDTH = 640
const HEIGHT = 360

export function boxGeometry(box: SuperSourceBoxState) {
  const width = (WIDTH * box.size) / 1000
  const height = (HEIGHT * box.size) / 1000
  const left = WIDTH / 2 + (box.x / 3200) * WIDTH - width / 2
  const top = HEIGHT / 2 - (box.y / 1800) * HEIGHT - height / 2
  const cropLeft = box.cropped ? Math.min(1, box.cropLeft / 32000) : 0
  const cropRight = box.cropped ? Math.min(1, box.cropRight / 32000) : 0
  const cropTop = box.cropped ? Math.min(1, box.cropTop / 18000) : 0
  const cropBottom = box.cropped ? Math.min(1, box.cropBottom / 18000) : 0
  return {
    left,
    top,
    width,
    height,
    clipLeft: left + width * cropLeft,
    clipTop: top + height * cropTop,
    clipWidth: Math.max(0, width * (1 - cropLeft - cropRight)),
    clipHeight: Math.max(0, height * (1 - cropTop - cropBottom)),
  }
}

function mediaUrl(file: string): string {
  return `/media/${file
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`
}

export function SuperSourceCanvas({ state }: { state: AtemState }): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    const superSource = state.superSources[0]
    if (!context || !superSource) return
    const images = new Map<string, HTMLImageElement>()
    let active = true

    function drawSource(
      target: CanvasRenderingContext2D,
      id: number,
      x: number,
      y: number,
      width: number,
      height: number,
    ) {
      target.fillStyle = '#000000'
      target.fillRect(x, y, width, height)
      const source = atemIdToSourceRef(id)
      if (
        !source ||
        source.kind === 'super-source' ||
        (source.kind === 'input' && !state.inputs.some((input) => input.id === source.inputId))
      )
        return
      const surface = resolveSourceSurface(state, source)
      target.fillStyle = surface.background
      target.fillRect(x, y, width, height)
      if (surface.kind === 'image-still' && surface.mediaFile) {
        const url = mediaUrl(surface.mediaFile)
        let image = images.get(url)
        if (!image) {
          image = new Image()
          images.set(url, image)
          image.onload = () => {
            if (active) draw()
          }
          image.src = url
        }
        if (image.complete && image.naturalWidth) {
          const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight)
          const imageWidth = image.naturalWidth * scale
          const imageHeight = image.naturalHeight * scale
          target.drawImage(
            image,
            x + (width - imageWidth) / 2,
            y + (height - imageHeight) / 2,
            imageWidth,
            imageHeight,
          )
        }
      } else {
        target.fillStyle = surface.foreground
        target.textAlign = 'center'
        target.textBaseline = 'middle'
        target.font = `bold ${Math.max(1, Math.min(width / 8, height / 5))}px sans-serif`
        target.fillText(surface.text, x + width / 2, y + height / 2, width * 0.9)
      }
    }

    function drawArt() {
      const art = superSource!.properties
      if (!art) return
      if (art.artOption === 0) {
        drawSource(context!, art.artFillSource, 0, 0, WIDTH, HEIGHT)
        return
      }
      const fill = document.createElement('canvas')
      const cut = document.createElement('canvas')
      fill.width = cut.width = WIDTH
      fill.height = cut.height = HEIGHT
      const fillContext = fill.getContext('2d')!
      const cutContext = cut.getContext('2d')!
      drawSource(fillContext, art.artFillSource, 0, 0, WIDTH, HEIGHT)
      drawSource(cutContext, art.artCutSource, 0, 0, WIDTH, HEIGHT)
      const fillPixels = fillContext.getImageData(0, 0, WIDTH, HEIGHT)
      const cutPixels = cutContext.getImageData(0, 0, WIDTH, HEIGHT).data
      const clip = art.artClip / 1000
      const gain = 1 + art.artGain / 1000
      for (let offset = 0; offset < cutPixels.length; offset += 4) {
        const luminance =
          (cutPixels[offset]! * 0.2126 +
            cutPixels[offset + 1]! * 0.7152 +
            cutPixels[offset + 2]! * 0.0722) /
          255
        let alpha = Math.min(1, Math.max(0, (luminance - clip) * gain))
        if (art.artInvertKey) alpha = 1 - alpha
        if (art.artPreMultiplied && alpha > 0) {
          fillPixels.data[offset] = Math.min(255, fillPixels.data[offset]! / alpha)
          fillPixels.data[offset + 1] = Math.min(255, fillPixels.data[offset + 1]! / alpha)
          fillPixels.data[offset + 2] = Math.min(255, fillPixels.data[offset + 2]! / alpha)
        }
        fillPixels.data[offset + 3] = Math.round(alpha * 255)
      }
      fillContext.putImageData(fillPixels, 0, 0)
      context!.drawImage(fill, 0, 0)
    }

    function draw() {
      context!.fillStyle = '#000000'
      context!.fillRect(0, 0, WIDTH, HEIGHT)
      if (superSource!.properties?.artOption === 0) drawArt()
      for (const box of superSource!.boxes) {
        if (!box?.enabled || box.size <= 0) continue
        const geometry = boxGeometry(box)
        context!.save()
        context!.beginPath()
        context!.rect(geometry.clipLeft, geometry.clipTop, geometry.clipWidth, geometry.clipHeight)
        context!.clip()
        drawSource(
          context!,
          box.source,
          geometry.left,
          geometry.top,
          geometry.width,
          geometry.height,
        )
        context!.restore()
        const border = superSource!.border
        if (border?.borderEnabled && geometry.clipWidth > 0 && geometry.clipHeight > 0) {
          context!.strokeStyle = `hsl(${border.borderHue / 10} ${Math.min(100, border.borderSaturation / 10)}% ${Math.min(100, border.borderLuma / 10)}%)`
          context!.lineWidth = Math.max(
            1,
            (((border.borderOuterWidth + border.borderInnerWidth) / 100) * WIDTH) / 32,
          )
          context!.strokeRect(
            geometry.clipLeft,
            geometry.clipTop,
            geometry.clipWidth,
            geometry.clipHeight,
          )
        }
      }
      if (superSource!.properties?.artOption === 1) drawArt()
    }
    draw()
    return () => {
      active = false
    }
  }, [state])

  return (
    <canvas
      ref={canvas}
      width={WIDTH}
      height={HEIGHT}
      className="super-source-canvas"
      aria-label="SuperSource composite"
    />
  )
}
