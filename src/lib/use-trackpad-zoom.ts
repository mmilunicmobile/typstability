import { useEffect, useLayoutEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'

type Anchor = { element: HTMLElement; x: number; y: number; clientX: number; clientY: number }
type GestureEvent = Event & { scale: number; clientX: number; clientY: number }
const clampZoom = (value: number) => Math.min(5, Math.max(0.1, value))

export function useTrackpadZoom(viewportRef: RefObject<HTMLElement | null>, zoom: number,
  setZoom: Dispatch<SetStateAction<number>>, enabled: boolean) {
  const currentZoom = useRef(zoom)
  const renderedZoom = useRef(zoom)
  const pendingAnchor = useRef<Anchor | null>(null)

  useLayoutEffect(() => {
    currentZoom.current = zoom
    renderedZoom.current = zoom
    const viewport = viewportRef.current
    const anchor = pendingAnchor.current
    pendingAnchor.current = null
    if (!viewport || !anchor || !anchor.element.isConnected) return
    const bounds = anchor.element.getBoundingClientRect()
    // Keep the same document point beneath the pointer after layout changes.
    const behavior = viewport.style.scrollBehavior
    viewport.style.scrollBehavior = 'auto'
    viewport.scrollLeft += bounds.left + anchor.x * zoom - anchor.clientX
    viewport.scrollTop += bounds.top + anchor.y * zoom - anchor.clientY
    viewport.style.scrollBehavior = behavior
  }, [zoom, viewportRef])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!enabled || !viewport) return
    let gestureStartZoom: number | null = null
    const applyZoom = (value: number, event: { target: EventTarget | null; clientX: number; clientY: number }) => {
      if (!Number.isFinite(value)) return
      const next = clampZoom(value)
      if (next === currentZoom.current) return
      const page = event.target instanceof Element ? event.target.closest<HTMLElement>('.page-shell') : null
      if (page) {
        const bounds = page.getBoundingClientRect()
        pendingAnchor.current = { element: page, x: (event.clientX - bounds.left) / renderedZoom.current,
          y: (event.clientY - bounds.top) / renderedZoom.current, clientX: event.clientX, clientY: event.clientY }
      }
      currentZoom.current = next
      setZoom(next)
    }
    const onWheel = (event: WheelEvent) => {
      // Browsers expose trackpad pinches as Ctrl+wheel. Ordinary two-finger
      // scrolling remains native, including horizontal pan and momentum.
      if (!event.ctrlKey || !event.cancelable) return
      event.preventDefault()
      if (gestureStartZoom !== null) return
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1
      const delta = Math.max(-200, Math.min(200, event.deltaY * unit))
      applyZoom(currentZoom.current * Math.exp(-delta * 0.01), event)
    }
    const onGestureStart = (event: Event) => {
      event.preventDefault()
      gestureStartZoom = currentZoom.current
    }
    const onGestureChange = (event: Event) => {
      event.preventDefault()
      const gesture = event as GestureEvent
      if (gestureStartZoom !== null && Number.isFinite(gesture.scale) && gesture.scale > 0) {
        applyZoom(gestureStartZoom * gesture.scale, gesture)
      }
    }
    const onGestureEnd = (event: Event) => { event.preventDefault(); gestureStartZoom = null }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    viewport.addEventListener('gesturestart', onGestureStart, { passive: false })
    viewport.addEventListener('gesturechange', onGestureChange, { passive: false })
    viewport.addEventListener('gestureend', onGestureEnd, { passive: false })
    return () => {
      viewport.removeEventListener('wheel', onWheel)
      viewport.removeEventListener('gesturestart', onGestureStart)
      viewport.removeEventListener('gesturechange', onGestureChange)
      viewport.removeEventListener('gestureend', onGestureEnd)
      pendingAnchor.current = null
    }
  }, [enabled, setZoom, viewportRef])
}
