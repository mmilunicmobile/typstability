import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browserEndpoint, matchesTarget, sessionToolNames, targetUrl } from './policy.mjs'

test('browser connections stay on literal loopback hosts', () => {
  for (const endpoint of ['http://127.0.0.1:9222', 'http://localhost:9222', 'ws://[::1]:9222/devtools/browser/test']) {
    assert.ok(browserEndpoint(endpoint))
  }
  for (const endpoint of ['https://remote.example', 'http://127.0.0.1.evil.example', 'file:///tmp/browser', 'http://user:secret@localhost:9222']) {
    assert.throws(() => browserEndpoint(endpoint))
  }
})
test('tab access matches the configured origin and exact application path', () => {
  const target = targetUrl('https://example.com/typstability/')
  assert.ok(matchesTarget('https://example.com/typstability/?test#page', target))
  for (const page of ['https://other.example/typstability/', 'https://example.com/other/', 'http://example.com/typstability/', 'https://example.com/typstability/private']) {
    assert.equal(matchesTarget(page, target), false)
  }
  assert.throws(() => targetUrl('file:///tmp/app'))
  assert.throws(() => targetUrl('https://name:secret@example.com/typstability/'))
})
test('the bridge exposes only the two session tools', () => {
  assert.deepEqual([...sessionToolNames].sort(), ['typstability_edit_session', 'typstability_read_session'])
  assert.equal(sessionToolNames.has('evaluate'), false)
  assert.equal(sessionToolNames.has('read_file'), false)
})
