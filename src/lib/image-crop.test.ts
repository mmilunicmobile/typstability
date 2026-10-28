import { describe, expect, it } from 'vitest'
import type { ImageElement } from '../types'
import { cropFromPoints, cropImage, FULL_IMAGE_CROP, getImageCrop, imageCropStyle, imageSourceBox, isValidImageCrop } from './image-crop'

const original: ImageElement = { id: 'image', kind: 'image', x: 20, y: 30, width: 200, height: 100,
  mime: 'image/png', dataUrl: 'data:image/png;base64,AQID' }

describe('non-destructive image cropping', () => {
  it('keeps retained pixels in place, preserves the original, and restores the full image', () => {
    const crop = { x: 0.25, y: 0.1, width: 0.5, height: 0.6 }
    const cropped = cropImage(original, crop)
    expect(cropped).toEqual({ ...original, x: 70, y: 40, width: 100, height: 60, crop })
    expect(imageSourceBox(cropped)).toEqual({ x: -50, y: -10, width: 200, height: 100 })
    expect(cropImage(cropped, FULL_IMAGE_CROP)).toEqual({ ...original, crop: undefined })
    expect(original.crop).toBeUndefined()
  })

  it('can edit a previous crop after resizing and moving the visible image', () => {
    const cropped = cropImage(original, { x: 0.25, y: 0.1, width: 0.5, height: 0.6 })
    const resized = { ...cropped, x: 100, y: 100, width: 200, height: 120 }
    expect(cropImage(resized, { x: 0.5, y: 0.25, width: 0.25, height: 0.5 })).toMatchObject({
      x: 200, y: 130, width: 100, height: 100,
    })
    expect(imageCropStyle(cropped)).toEqual({ position: 'absolute', left: '-50%', top: `${-0.1 / 0.6 * 100}%`, width: '200%', height: `${100 / 0.6}%` })
  })

  it('supports old images without crop data', () => {
    expect(getImageCrop(original)).toEqual(FULL_IMAGE_CROP)
    expect(imageSourceBox(original)).toEqual({ x: -0, y: -0, width: 200, height: 100 })
  })

  it.each([
    { x: -0.1, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 1 },
    { x: 0.8, y: 0, width: 0.5, height: 1 },
    { x: 0, y: 0.5, width: 1, height: 0.8 },
    { x: 0, y: 0, width: NaN, height: 1 },
    { x: 0, y: 0, width: 1, height: Infinity },
  ])('rejects invalid crop rectangles: %j', (crop) => {
    expect(isValidImageCrop(crop)).toBe(false)
    expect(() => cropImage(original, crop)).toThrow()
  })

  it('allows selections in either drag direction and clamps them to image edges', () => {
    expect(cropFromPoints({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.3 })).toMatchObject({ x: 0.2, y: 0.3 })
    expect(cropFromPoints({ x: -1, y: -1 }, { x: 2, y: 2 })).toEqual(FULL_IMAGE_CROP)
    const edge = cropFromPoints({ x: 1, y: 1 }, { x: 1, y: 1 })
    expect(isValidImageCrop(edge)).toBe(true)
    expect(edge.width).toBe(0.01)
  })
})
