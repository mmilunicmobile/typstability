export const sessionToolNames = new Set(['typstability_read_session', 'typstability_edit_session'])

export function browserEndpoint(value) {
  const endpoint = new URL(value)
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(endpoint.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
    || endpoint.username || endpoint.password) {
    throw new Error('The browser debugging endpoint must be on localhost without embedded credentials.')
  }
  return endpoint
}

export function targetUrl(value) {
  const target = new URL(value)
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new Error('TYPSTABILITY_URL must be the HTTP(S) URL of your Typstability tab without embedded credentials.')
  }
  return target
}

export function matchesTarget(pageUrl, target) {
  const page = new URL(pageUrl)
  return page.origin === target.origin
    && page.pathname.replace(/\/$/, '') === target.pathname.replace(/\/$/, '')
}
