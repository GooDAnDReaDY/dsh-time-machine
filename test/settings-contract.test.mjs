import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const client = read('lib/client.js')
const host = read('lib/index.js')
const { Config, plainConfig } = await import('../lib/index.js')

// Comments are stripped before asserting on code, so prose describing a removed
// call cannot read as the call itself.
const code = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

// DSH builds a namespace's settings form from the volatile fields of its profile
// entry schema, and volatileForm() returns undefined when there are none.
function volatileKeys(schema = Config) {
  if (schema.meta?.volatile) return []
  if (schema.type !== 'object') return []
  return Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
    const nested = volatileKeys(child)
    return nested.length === 0 && child.meta?.volatile ? [key] : nested
  })
}

test('schema serves a settings form, so the card can mount at all', () => {
  assert.ok(volatileKeys().length > 0, 'Config needs at least one .volatile() field')
})

test('the namespace is the profile entry id, not the package name', () => {
  const entryId = read('cordis.patch.yml').match(/^\s*- id:\s*(\S+)\s*$/m)[1]
  assert.equal(entryId, 'dsh-time-machine')
  assert.ok(code(host).includes(`const NS = '${entryId}'`))
  assert.ok(code(client).includes(`const NS = '${entryId}'`))
})

test('volatile boxes unwrap to the plain values the host reads', () => {
  const raw = Config({ maxSnapshots: 3, autoSnapshotEnabled: false })
  assert.equal(typeof raw.maxSnapshots.get, 'function', 'volatile fields hold a Volatile box')
  const plain = plainConfig(raw)
  assert.equal(plain.maxSnapshots, 3)
  assert.equal(plain.autoSnapshotEnabled, false)
})

test('the host applies settings on loader/volatile-update, not a dead scope.watch', () => {
  const c = code(host)
  assert.ok(c.includes("ctx.on('loader/volatile-update'"), 'both releases emit this event')
  assert.ok(c.includes('engine.setMax('), 'applying settings must reach the engine')
  assert.ok(c.includes('plainConfig('), 'the host must unwrap before reading maxSnapshots')
  assert.doesNotMatch(c, /scope\.watch\(/, 'ConfigForm has no watch() in either release')
  assert.doesNotMatch(c, /settings\s*\.\s*register\s*\(/, 'settings.register exists in neither release')
})

test('the card is on a live seat and the retired one is gone', () => {
  const c = code(client)
  assert.ok(c.includes("'plugins.row.config'"))
  assert.ok(c.includes("'plugins.item'"))
  assert.doesNotMatch(c, /name:\s*'settings\.plugin\.item'/)
})

test('the card reads the form through the contract both releases share', () => {
  const c = code(client)
  assert.ok(c.includes('getSnapshot'))
  assert.ok(c.includes('.subscribe('))
  assert.doesNotMatch(c, /scope\.get\(\)/, 'ConfigForm has no get() in either release')
  assert.doesNotMatch(c, /scope\.watch\(/, 'ConfigForm has no watch() in either release')
})

test('peer ranges accept the 0.1.7 and 0.2.0 DSH package lines', async () => {
  const pkg = JSON.parse(read('package.json'))
  const semver = await import('semver')
  for (const [name, range] of Object.entries(pkg.peerDependencies)) {
    if (name === '@deepseek-ai/cordis') {
      assert.ok(semver.satisfies('4.0.4', range))
      continue
    }
    if (name === '@deepseek-ai/schemastery') {
      assert.ok(semver.satisfies('3.18.4', range), 'schemastery must accept the .volatile() line')
      assert.ok(!semver.satisfies('3.18.1', range), '3.18.1 lacks .volatile() and must be rejected')
      continue
    }
    assert.ok(semver.satisfies('0.2.0-rc.1', range), name + ' ' + range + ' must accept 0.2.0-rc.1')
    assert.ok(semver.satisfies('0.1.7-rc.2', range), name + ' ' + range + ' must accept 0.1.7-rc.2')
  }
})
