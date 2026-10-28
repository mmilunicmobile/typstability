const key = 'typstability:lsp-endpoint'
const listeners = new Set<() => void>()
let endpoint = ''
try { endpoint = sessionStorage.getItem(key) ?? '' } catch { /* Storage can be unavailable in private browsing. */ }

export const lspSettings = {
  get: () => endpoint,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  set(value: string) {
    endpoint = value
    try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key) } catch { /* The current connection still works. */ }
    listeners.forEach((listener) => listener())
  },
}
