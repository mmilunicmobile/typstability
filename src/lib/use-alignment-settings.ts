import { useEffect, useState } from 'react'

const KEY = 'typstability-alignment'
export function useAlignmentSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
      return { showGrid: saved?.showGrid === true, snapEnabled: saved?.snapEnabled === true }
    } catch { return { showGrid: false, snapEnabled: false } }
  })
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch { /* Alignment still works without storage. */ }
  }, [settings])
  return { ...settings,
    toggleGrid: () => setSettings((current) => ({ ...current, showGrid: !current.showGrid })),
    toggleSnap: () => setSettings((current) => ({ ...current, snapEnabled: !current.snapEnabled })),
  }
}
