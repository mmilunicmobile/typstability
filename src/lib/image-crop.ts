import type { Box, ImageElement, Point } from '../types'

export const FULL_IMAGE_CROP: Box = { x: 0, y: 0, width: 1, height: 1 }

export function isValidImageCrop(value: unknown): value is Box {
  if (!value || typeof value !== 'object') return false
  const crop = value as Box
  return [crop.x, crop.y, crop.width, crop.height].every(Number.isFinite)
    && crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0
    && crop.x + crop.width <= 1 + 1e-9 && crop.y + crop.height <= 1 + 1e-9
}

export function getImageCrop(image: Pick<ImageElement, 'crop'>): Box {
  return isValidImageCrop(image.crop) ? image.crop : FULL_IMAGE_CROP
}

/** Position the original artwork inside the visible image frame. */
export function imageSourceBox(image: Pick<ImageElement, 'width' | 'height' | 'crop'>): Box {
  const crop = getImageCrop(image)
  const width = image.width / crop.width
  const height = image.height / crop.height
  return { x: -crop.x * width, y: -crop.y * height, width, height }
}

/** Keep the retained pixels at their existing scale and position on the page. */
export function cropImage(image: ImageElement, crop: Box): ImageElement {
  if (!isValidImageCrop(crop)) throw new Error('Choose a crop within the image.')
  const previous = getImageCrop(image)
  const source = imageSourceBox(image)
  return {
    ...image,
    x: image.x + (crop.x - previous.x) * source.width,
    y: image.y + (crop.y - previous.y) * source.height,
    width: source.width * crop.width,
    height: source.height * crop.height,
    crop: crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1 ? undefined : { ...crop },
  }
}

/** CSS for thumbnails and the preview shown while dragging between pages. */
export function imageCropStyle(image: Pick<ImageElement, 'crop'>) {
  const crop = getImageCrop(image)
  return {
    position: 'absolute' as const,
    left: `${-crop.x / crop.width * 100}%`,
    top: `${-crop.y / crop.height * 100}%`,
    width: `${100 / crop.width}%`,
    height: `${100 / crop.height}%`,
  }
}

export function cropFromPoints(start: Point, end: Point): Box {
  const clamp = (value: number) => Math.max(0, Math.min(1, value))
  const x = Math.min(clamp(start.x), clamp(end.x), 0.99)
  const y = Math.min(clamp(start.y), clamp(end.y), 0.99)
  return { x, y, width: Math.max(0.01, Math.abs(clamp(end.x) - clamp(start.x))),
    height: Math.max(0.01, Math.abs(clamp(end.y) - clamp(start.y))) }
}
