import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { isTrustedSettingsRequest, readBody, writeJson } from '../lib/http.js'
import { isNewerVersion, isTrustedUpdateRequest, registerPluginUpdater } from '../lib/updater.js'
import { apply } from '../lib/index.js'

function createMockResponse(options = {}) {
  let statusCode = 200
  const headers = {}
  let body = ''
  let ended = false
  return {
    writeHead(code, h) {
      if (options.throwOnWriteHead) throw new Error('socket closed')
      statusCode = code
      if (h) Object.assign(headers, h)
    },
    end(chunk) {
      if (chunk) body += chunk
      ended = true
    },
    get statusCode() { return statusCode },
    get headers() { return headers },
    get body() { return body },
    get json() { return body ? JSON.parse(body) : null },
    get ended() { return ended },
  }
}

function createMockRequest({ method = 'GET', headers = {}, remoteAddress = '127.0.0.1', body = null } = {}) {
  const chunks = []
  if (body !== null) {
    chunks.push(typeof body === 'string' ? Buffer.from(body) : Buffer.from(JSON.stringify(body)))
  }
  const req = new Readable({
    read() {
      while (chunks.length > 0) {
        this.push(chunks.shift())
      }
      this.push(null)
    },
  })
  req.method = method
  req.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  req.socket = { remoteAddress }
  return req
}

// -------------------------------------------------------------
// 1. lib/http.js unit tests
// -------------------------------------------------------------
test('writeJson writes status code, headers and json payload', () => {
  const res = createMockResponse()
  writeJson(res, 200, { success: true, message: 'ok' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8')
  assert.equal(res.headers['Cache-Control'], 'no-store')
  assert.deepEqual(res.json, { success: true, message: 'ok' })
  assert.equal(res.ended, true)
})

test('writeJson handles writeHead exceptions gracefully when socket is closed', () => {
  const res = createMockResponse({ throwOnWriteHead: true })
  assert.doesNotThrow(() => {
    writeJson(res, 500, { success: false, error: 'failed' })
  })
})

test('readBody parses valid JSON stream', async () => {
  const req = createMockRequest({ body: { hello: 'world', count: 42 } })
  const result = await readBody(req)
  assert.deepEqual(result, { hello: 'world', count: 42 })
})

test('readBody returns empty object on empty stream', async () => {
  const req = createMockRequest({ body: '' })
  const result = await readBody(req)
  assert.deepEqual(result, {})
})

test('readBody rejects with 413 when payload exceeds maxBytes', async () => {
  const largeData = 'a'.repeat(200)
  const req = createMockRequest({ body: largeData })
  await assert.rejects(async () => {
    await readBody(req, 100)
  }, (err) => {
    assert.equal(err.statusCode, 413)
    assert.ok(err.message.includes('payload too large'))
    return true
  })
})

test('readBody rejects with 400 on malformed JSON', async () => {
  const req = createMockRequest({ body: '{ malformed: json ' })
  await assert.rejects(async () => {
    await readBody(req)
  }, (err) => {
    assert.equal(err.statusCode, 400)
    assert.ok(err.message.includes('invalid json'))
    return true
  })
})

test('isTrustedSettingsRequest security matrix', () => {
  // Non-objects and nulls
  assert.equal(isTrustedSettingsRequest(null), false)
  assert.equal(isTrustedSettingsRequest(undefined), false)
  assert.equal(isTrustedSettingsRequest('string'), false)

  // Cross-site and same-site always rejected
  assert.equal(isTrustedSettingsRequest({ headers: { 'sec-fetch-site': 'cross-site' } }), false)
  assert.equal(isTrustedSettingsRequest({ headers: { 'sec-fetch-site': 'same-site' } }), false)

  // External / LAN clients cannot forge same-origin without matching origin or loopback
  assert.equal(isTrustedSettingsRequest({
    headers: { 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '192.168.1.50' },
  }), false)

  // X-Forwarded-Host spoofing on LAN rejected (Issue #82)
  assert.equal(isTrustedSettingsRequest({
    headers: { origin: 'http://attacker.com', 'x-forwarded-host': 'attacker.com', host: 'victim-dsh:3000' },
    socket: { remoteAddress: '192.168.1.50' },
  }), false)

  assert.equal(isTrustedSettingsRequest({
    headers: { referer: 'http://attacker.com/evil', 'x-forwarded-host': 'attacker.com', host: 'victim-dsh:3000' },
    socket: { remoteAddress: '192.168.1.50' },
  }), false)

  // Legitimate LAN browser request with matching Origin and Host
  assert.equal(isTrustedSettingsRequest({
    headers: { origin: 'http://victim-dsh:3000', host: 'victim-dsh:3000', 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '192.168.1.50' },
  }), true)

  // Legitimate LAN browser request with matching Referer and Host
  assert.equal(isTrustedSettingsRequest({
    headers: { referer: 'http://victim-dsh:3000/dsh-time-machine', host: 'victim-dsh:3000', 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '192.168.1.50' },
  }), true)

  // Loopback allowed without Origin/Referer (e.g. curl or internal tool calls)
  assert.equal(isTrustedSettingsRequest({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), true)
  assert.equal(isTrustedSettingsRequest({ headers: {}, socket: { remoteAddress: '::1' } }), true)
  assert.equal(isTrustedSettingsRequest({ headers: {}, socket: { remoteAddress: '::ffff:127.0.0.1' } }), true)

  // Loopback with sec-fetch-site none
  assert.equal(isTrustedSettingsRequest({ headers: { 'sec-fetch-site': 'none' }, socket: { remoteAddress: '127.0.0.1' } }), true)

  // Invalid Origin / null Origin rejected
  assert.equal(isTrustedSettingsRequest({ headers: { origin: 'null', host: 'my-host:3000' }, socket: { remoteAddress: '192.168.1.50' } }), false)
  assert.equal(isTrustedSettingsRequest({ headers: { origin: 'not-a-valid-url', host: 'my-host:3000' }, socket: { remoteAddress: '192.168.1.50' } }), false)
})

// -------------------------------------------------------------
// 2. lib/updater.js unit tests
// -------------------------------------------------------------
test('isNewerVersion semver comparison', () => {
  assert.equal(isNewerVersion('0.1.26', '0.1.27'), true)
  assert.equal(isNewerVersion('0.1.26', '0.2.0'), true)
  assert.equal(isNewerVersion('0.1.26', '1.0.0'), true)
  assert.equal(isNewerVersion('0.1.27', '0.1.27'), false)
  assert.equal(isNewerVersion('0.1.27', '0.1.26'), false)
  assert.equal(isNewerVersion('0.2.0', '0.1.99'), false)
  assert.equal(isNewerVersion('0.2.0-rc.1', '0.2.0-rc.2'), true)
  assert.equal(isNewerVersion('0.2.0-rc.2', '0.2.0'), true)
  assert.equal(isNewerVersion('invalid', '0.1.0'), false)
})

test('isTrustedUpdateRequest validates updater security contract', () => {
  // Missing update header
  assert.equal(isTrustedUpdateRequest({
    headers: { host: 'localhost:3080', origin: 'http://localhost:3080' },
    socket: { remoteAddress: '127.0.0.1' },
  }), false)

  // Non-local and non-LAN client rejected
  assert.equal(isTrustedUpdateRequest({
    headers: { 'x-dsh-plugin-update': '1', host: 'example.com', origin: 'http://example.com' },
    socket: { remoteAddress: '198.51.100.1' },
  }), false)

  // Cross-site site header rejected
  assert.equal(isTrustedUpdateRequest({
    headers: { 'x-dsh-plugin-update': '1', 'sec-fetch-site': 'cross-site', host: 'localhost:3080', origin: 'http://localhost:3080' },
    socket: { remoteAddress: '127.0.0.1' },
  }), false)

  // Legitimate loopback update request
  assert.equal(isTrustedUpdateRequest({
    headers: { 'x-dsh-plugin-update': '1', host: 'localhost:3080', origin: 'http://localhost:3080' },
    socket: { remoteAddress: '127.0.0.1' },
  }), true)

  // Legitimate private LAN update request
  assert.equal(isTrustedUpdateRequest({
    headers: { 'x-dsh-plugin-update': '1', host: '192.168.1.111:3080', origin: 'http://192.168.1.111:3080' },
    socket: { remoteAddress: '192.168.1.50' },
  }), true)

  // Mismatched origin vs host rejected
  assert.equal(isTrustedUpdateRequest({
    headers: { 'x-dsh-plugin-update': '1', host: '192.168.1.111:3080', origin: 'http://192.168.1.222:3080' },
    socket: { remoteAddress: '192.168.1.50' },
  }), false)
})

test('registerPluginUpdater skips gracefully when webServer is absent', () => {
  const dummyCtx = { logger: { warn: () => {} } }
  assert.doesNotThrow(() => {
    registerPluginUpdater(dummyCtx, { endpoint: '/api/test', packageName: 'test' })
  })
})

// -------------------------------------------------------------
// 3. Web routes and mutation guard tests via apply(ctx)
// -------------------------------------------------------------
test('apply(ctx) registers HTTP routes with 405 Method Not Allowed and 403 CSRF guards', async () => {
  const routes = new Map()
  const tools = new Map()

  const mockCtx = {
    logger: { warn: () => {}, error: () => {}, info: () => {} },
    tools: {
      register: (tool) => tools.set(tool.name, tool),
    },
    webServer: {
      register: ({ path, handler }) => {
        routes.set(path, handler)
        return () => routes.delete(path)
      },
    },
    effect: (fn) => fn(),
    on: () => () => {},
  }

  apply(mockCtx, { autoSnapshotEnabled: true, maxSnapshots: 10 })

  // Verify routes are registered
  assert.ok(routes.has('/dsh-time-machine/rollback'), 'must register /rollback')
  assert.ok(routes.has('/dsh-time-machine/rollback-file'), 'must register /rollback-file')
  assert.ok(routes.has('/dsh-time-machine/delete'), 'must register /delete')
  assert.ok(routes.has('/dsh-time-machine/prune'), 'must register /prune')
  assert.ok(routes.has('/dsh-time-machine/snapshots'), 'must register /snapshots')

  // 1. /dsh-time-machine/rollback route
  const rollbackHandler = routes.get('/dsh-time-machine/rollback')

  // 1.1 GET -> 405 Method Not Allowed
  const resGet = createMockResponse()
  await rollbackHandler(createMockRequest({ method: 'GET' }), resGet)
  assert.equal(resGet.statusCode, 405)
  assert.equal(resGet.json.success, false)

  // 1.2 POST from untrusted cross-site -> 403 Forbidden
  const resUntrusted = createMockResponse()
  await rollbackHandler(createMockRequest({
    method: 'POST',
    headers: { 'sec-fetch-site': 'cross-site' },
    remoteAddress: '192.168.1.50',
    body: { id: 'snap-1', confirm: true },
  }), resUntrusted)
  assert.equal(resUntrusted.statusCode, 403)
  assert.equal(resUntrusted.json.success, false)

  // 1.3 POST without confirm:true -> 400 Bad Request
  const resNoConfirm = createMockResponse()
  await rollbackHandler(createMockRequest({
    method: 'POST',
    remoteAddress: '127.0.0.1',
    body: { id: 'snap-1', confirm: false },
  }), resNoConfirm)
  assert.equal(resNoConfirm.statusCode, 400)
  assert.equal(resNoConfirm.json.success, false)

  // 2. /dsh-time-machine/rollback-file route
  const rollbackFileHandler = routes.get('/dsh-time-machine/rollback-file')

  // 2.1 GET -> 405
  const resFileGet = createMockResponse()
  await rollbackFileHandler(createMockRequest({ method: 'GET' }), resFileGet)
  assert.equal(resFileGet.statusCode, 405)

  // 2.2 Untrusted -> 403
  const resFileUntrusted = createMockResponse()
  await rollbackFileHandler(createMockRequest({
    method: 'POST',
    headers: { 'sec-fetch-site': 'cross-site' },
    body: { id: 'snap-1', filePath: 'a.txt', confirm: true },
  }), resFileUntrusted)
  assert.equal(resFileUntrusted.statusCode, 403)

  // 2.3 Traversal path escape -> 400
  const resFileTraversal = createMockResponse()
  await rollbackFileHandler(createMockRequest({
    method: 'POST',
    remoteAddress: '127.0.0.1',
    body: { id: 'snap-1', filePath: '../../etc/passwd', confirm: true },
  }), resFileTraversal)
  assert.equal(resFileTraversal.statusCode, 400)

  // 3. /dsh-time-machine/delete route
  const deleteHandler = routes.get('/dsh-time-machine/delete')

  // 3.1 GET -> 405
  const resDelGet = createMockResponse()
  await deleteHandler(createMockRequest({ method: 'GET' }), resDelGet)
  assert.equal(resDelGet.statusCode, 405)

  // 3.2 Untrusted -> 403
  const resDelUntrusted = createMockResponse()
  await deleteHandler(createMockRequest({
    method: 'POST',
    headers: { 'sec-fetch-site': 'cross-site' },
    body: { id: 'snap-1', confirm: true },
  }), resDelUntrusted)
  assert.equal(resDelUntrusted.statusCode, 403)

  // 3.3 No confirm -> 400
  const resDelNoConfirm = createMockResponse()
  await deleteHandler(createMockRequest({
    method: 'POST',
    remoteAddress: '127.0.0.1',
    body: { id: 'snap-1', confirm: false },
  }), resDelNoConfirm)
  assert.equal(resDelNoConfirm.statusCode, 400)

  // 4. /dsh-time-machine/prune route
  const pruneHandler = routes.get('/dsh-time-machine/prune')

  // 4.1 GET -> 405
  const resPruneGet = createMockResponse()
  await pruneHandler(createMockRequest({ method: 'GET' }), resPruneGet)
  assert.equal(resPruneGet.statusCode, 405)

  // 4.2 Untrusted -> 403
  const resPruneUntrusted = createMockResponse()
  await pruneHandler(createMockRequest({
    method: 'POST',
    headers: { 'sec-fetch-site': 'cross-site' },
    body: { keep: 3 },
  }), resPruneUntrusted)
  assert.equal(resPruneUntrusted.statusCode, 403)

  // 5. /dsh-time-machine/snapshots route
  const snapshotsHandler = routes.get('/dsh-time-machine/snapshots')

  // 5.1 POST -> 405
  const resSnapPost = createMockResponse()
  await snapshotsHandler(createMockRequest({ method: 'POST' }), resSnapPost)
  assert.equal(resSnapPost.statusCode, 405)

  // 5.2 Untrusted GET -> 403
  const resSnapUntrusted = createMockResponse()
  await snapshotsHandler(createMockRequest({
    method: 'GET',
    headers: { 'sec-fetch-site': 'cross-site' },
  }), resSnapUntrusted)
  assert.equal(resSnapUntrusted.statusCode, 403)

  // 5.3 Trusted loopback GET -> 200 with snapshots array
  const resSnapOk = createMockResponse()
  await snapshotsHandler(createMockRequest({
    method: 'GET',
    remoteAddress: '127.0.0.1',
  }), resSnapOk)
  assert.equal(resSnapOk.statusCode, 200)
  assert.equal(resSnapOk.json.success, true)
  assert.ok(Array.isArray(resSnapOk.json.snapshots))
})
