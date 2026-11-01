import { describe, expect, it } from 'vitest'
import { boxGeometry } from '../src/super-source.js'
import type { SuperSourceBoxState } from '@atem-sandbox/atem-state'

const box: SuperSourceBoxState = {
  enabled: true,
  source: 1,
  x: 0,
  y: 0,
  size: 500,
  cropped: false,
  cropTop: 0,
  cropBottom: 0,
  cropLeft: 0,
  cropRight: 0,
}

describe('SuperSource box geometry', () => {
  it('scales and positions a box using ATEM coordinates', () => {
    expect(boxGeometry({ ...box, x: 800, y: 450 })).toMatchObject({
      left: 320,
      top: 0,
      width: 320,
      height: 180,
    })
  })

  it('clips each side without changing the source scale', () => {
    expect(boxGeometry({ ...box, cropped: true, cropLeft: 8000, cropTop: 4500 })).toMatchObject({
      left: 160,
      top: 90,
      width: 320,
      height: 180,
      clipLeft: 240,
      clipTop: 135,
      clipWidth: 240,
      clipHeight: 135,
    })
  })
})
