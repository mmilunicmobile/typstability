import { useState } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useTrackpadZoom } from './use-trackpad-zoom'

afterEach(() => { cleanup(); document.body.replaceChildren() })

function setup(enabled = true) {
  const viewport = document.createElement('main')
  const page = document.createElement('section')
  page.className = 'page-shell'
  page.getBoundingClientRect = () => ({ left: 100, top: 50 }) as DOMRect
  viewport.append(page)
  document.body.append(viewport)
  const ref = { current: viewport }
  const hook = renderHook(({ active }) => {
    const [zoom, setZoom] = useState(1)
    useTrackpadZoom(ref, zoom, setZoom, active)
    return zoom
  }, { initialProps: { active: enabled } })
  const wheel = (options: WheelEventInit) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 200, clientY: 150, ...options })
    act(() => { page.dispatchEvent(event) })
    return event
  }
  const gesture = (type: string, scale = 1) => {
    const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { scale, clientX: 200, clientY: 150 })
    act(() => { page.dispatchEvent(event) })
    return event
  }
  return { viewport, hook, wheel, gesture }
}

describe('trackpad zoom', () => {
  it('zooms a Ctrl+wheel pinch, preserves its pointer anchor and leaves normal scrolling native', () => {
    const { hook, viewport, wheel } = setup()
    expect(wheel({ deltaY: 20 }).defaultPrevented).toBe(false)
    expect(hook.result.current).toBe(1)
    expect(wheel({ ctrlKey: true, deltaY: -Math.log(1.2) / 0.01 }).defaultPrevented).toBe(true)
    expect(hook.result.current).toBeCloseTo(1.2)
    expect(viewport.scrollLeft).toBeCloseTo(20)
    expect(viewport.scrollTop).toBeCloseTo(20)
  })
  it('accumulates quick pinches and clamps zoom to the supported range', () => {
    const { hook, wheel } = setup()
    wheel({ ctrlKey: true, deltaY: -200 })
    expect(hook.result.current).toBe(5)
    wheel({ ctrlKey: true, deltaY: 200 })
    wheel({ ctrlKey: true, deltaY: 200 })
    expect(hook.result.current).toBe(0.1)
    wheel({ ctrlKey: true, deltaY: 200 })
    expect(hook.result.current).toBe(0.1)
  })
  it('supports Safari gesture scale without double-applying associated wheel events', () => {
    const { hook, gesture, wheel } = setup()
    expect(gesture('gesturestart').defaultPrevented).toBe(true)
    gesture('gesturechange', 1.5)
    expect(hook.result.current).toBe(1.5)
    wheel({ ctrlKey: true, deltaY: -50 })
    expect(hook.result.current).toBe(1.5)
    gesture('gesturechange', 2)
    expect(hook.result.current).toBe(2)
    gesture('gestureend')
    wheel({ ctrlKey: true, deltaY: 10 })
    expect(hook.result.current).toBeLessThan(2)
  })
  it('binds only while a workspace is open and removes listeners on cleanup', () => {
    const { hook, wheel } = setup(false)
    expect(wheel({ ctrlKey: true, deltaY: -10 }).defaultPrevented).toBe(false)
    hook.rerender({ active: true })
    expect(wheel({ ctrlKey: true, deltaY: -10 }).defaultPrevented).toBe(true)
    hook.unmount()
    expect(wheel({ ctrlKey: true, deltaY: -10 }).defaultPrevented).toBe(false)
  })
})
