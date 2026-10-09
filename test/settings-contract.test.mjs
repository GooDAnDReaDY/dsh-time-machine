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

test('host does not pass raw config with accessors to structuredClone (issue #6)', () => {
  const c = code(host)
  assert.doesNotMatch(c, /structuredClone\s*\(\s*config\s*\)/, 'structuredClone throws DataCloneError on volatile accessors')
})

test('host apply handles volatile accessor boxes without DataCloneError (issue #6)', async () => {
  const { apply } = await import('../lib/index.js')
  const warnLogs = []
  let volatileUpdateHandler = null

  const mockCtx = {
    inject: () => {},
    on: (event, handler) => {
      if (event === 'loader/volatile-update') volatileUpdateHandler = handler
    },
    effect: (cb) => { try { return cb() } catch {} },
    logger: {
      warn: (msg) => { warnLogs.push(msg) },
      error: () => {}
    },
    tools: { register: () => {} },
    webServer: { registerRoute: () => {} },
    workspace: { cwd: '/tmp' }
  }

  let currentMax = 35
  const mockConfig = {
    maxSnapshots: { get: () => currentMax },
    autoSnapshotEnabled: { get: () => true },
    autoHealPrompt: { get: () => false }
  }

  assert.doesNotThrow(() => apply(mockCtx, mockConfig))
  assert.ok(!warnLogs.some(msg => msg.includes('failed to apply maxSnapshots')), 'must not fail applying maxSnapshots')

  // verify loader/volatile-update re-applies without error
  currentMax = 42
  assert.equal(typeof volatileUpdateHandler, 'function', 'must register volatile-update listener')
  volatileUpdateHandler()
  assert.ok(!warnLogs.some(msg => msg.includes('failed to apply maxSnapshots')), 'must not fail on update')
})

test('cwdOf resolves workspace from workspaceRegistry and entity path (issue #7)', async () => {
  const { cwdOf } = await import('../lib/index.js')

  // 1. ctx.workspaceRegistry.list()[0].path (DSH 0.2.0-rc.2 kernel)
  const ctxWithRegistryList = {
    workspaceRegistry: {
      list: () => [{ id: 'w1', path: '/var/repos/project-a', title: 'Project A' }]
    }
  }
  assert.equal(cwdOf(null, ctxWithRegistryList), '/var/repos/project-a')

  // 2. ctx.workspaceRegistry.current.path
  const ctxWithRegistryCurrent = {
    workspaceRegistry: {
      current: { path: '/var/repos/current-project' }
    }
  }
  assert.equal(cwdOf(null, ctxWithRegistryCurrent), '/var/repos/current-project')

  // 3. session.workspace.path
  const sessionWithWsPath = {
    workspace: { path: '/var/repos/session-ws' }
  }
  assert.equal(cwdOf(sessionWithWsPath, {}), '/var/repos/session-ws')

  // 4. session.workspacePath
  const sessionWithWsPathProp = {
    workspacePath: '/var/repos/session-wspath'
  }
  assert.equal(cwdOf(sessionWithWsPathProp, {}), '/var/repos/session-wspath')

  // 5. configured workspacePath setting overrides default fallback
  assert.equal(cwdOf(null, ctxWithRegistryList, '/var/repos/custom-override'), '/var/repos/custom-override')

  // 6. execution.cwd / explicit target takes precedence
  assert.equal(cwdOf({ cwd: '/explicit/target' }, ctxWithRegistryList), '/explicit/target')
})

test('snapshot creation emits warning and rollbackFile resets index (issue #7)', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js')
  const warnings = []
  const origWarn = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))

  try {
    const commands = []
    const eng = new ShadowSnapshotEngine({
      exec: async (cmd, args) => {
        commands.push([cmd, ...args])
        if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return { stdout: 'false' }
        if (args[0] === 'ls-tree') return { stdout: '100644 blob abc1234	lib/test.js' }
        return { stdout: '' }
      }
    })

    // createSnapshot in non-git directory warns rather than degrading silently
    const snap = await eng.createSnapshot('auto:turn:1', { cwd: '/non/git/dir' })
    assert.equal(snap.commit, null)
    assert.ok(warnings.some(w => w.includes('is not a git repository')), 'must warn about non-git directory')

    // rollbackFile resets staged index after checkout
    eng.snapshots.push({ id: 's2', commit: 'c2', ref: 'refs/s2', sessionId: 'sess' })
    eng.exec = async (cmd, args) => {
      commands.push([cmd, ...args])
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return { stdout: 'true' }
      if (args[0] === 'ls-tree') return { stdout: '100644 blob abc1234	lib/test.js' }
      return { stdout: '' }
    }
    await eng.rollbackFile('s2', 'lib/test.js', { confirm: true, cwd: '/app' })
    assert.ok(commands.some(c => c[0] === 'git' && c[1] === 'reset' && c[2] === 'HEAD' && c[4] === 'lib/test.js'), 'must unstage file from index')
  } finally {
    console.warn = origWarn
  }
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

test('tools resolve workspace and sessionId when omitted in tool call (GitHub #7 follow-up, #86)', async () => {
  const { cwdOf, sessionIdOf, apply } = await import('../lib/index.js')
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js')
  const registeredTools = new Map()

  // 1. Tool registration & agent execution resolution
  const mockCtx = {
    tools: {
      register: (tool) => {
        registeredTools.set(tool.name, tool)
      }
    },
    effect: (fn) => fn(),
    on: () => () => {},
  }

  apply(mockCtx, { autoSnapshotEnabled: true })
  const createTool = registeredTools.get('time_machine_checkpoint_create')
  assert.ok(createTool, 'time_machine_checkpoint_create tool must be registered')

  // Execution object with execution.agent.session
  const execWithAgent = {
    agent: {
      session: {
        id: 'session-xyz-123',
        workspace: { path: '/home/user/project-alpha' }
      }
    }
  }

  // Verify cwdOf resolves from execution.agent
  assert.equal(cwdOf(execWithAgent, mockCtx), '/home/user/project-alpha')
  assert.equal(sessionIdOf(execWithAgent, mockCtx), 'session-xyz-123')

  // 2. Active session event tracking and tool fallback when cwd/sessionId is omitted
  let eventHandler = null
  const eventCtx = {
    tools: { register: (tool) => registeredTools.set(tool.name, tool) },
    effect: (fn) => fn(),
    on: (evt, handler) => {
      if (evt === 'session/event') eventHandler = handler
      return () => {}
    }
  }

  apply(eventCtx, { autoSnapshotEnabled: true })
  const createTool2 = registeredTools.get('time_machine_checkpoint_create')
  assert.ok(typeof eventHandler === 'function', 'session/event handler must be registered')

  // Simulate turn/start event establishing active session and workspace
  eventHandler(
    { id: 'session-active-99', workspace: { path: '/home/user/active-repo' } },
    { type: 'turn/start', turnId: 'turn-1' }
  )

  // Empty execution (as received on kernel 0.2.0-rc.2 when agent/session is omitted)
  const emptyExec = { token: 't1', callId: 'c1', name: 'time_machine_checkpoint_create' }

  // Tool execution without cwd or sessionId resolves from last active session and warns if not git repo
  const res = await createTool2.execute({ label: 'manual checkpoint' }, emptyExec)
  assert.equal(res.success, true)
  assert.equal(res.snapshot.sessionId, 'session-active-99')
  assert.ok(res.warning, 'must contain warning when not a git repo')

  // 3. Volatile workspacePath unwrapped on initial resolve (issue #80)
  const volatileBox = { get: () => '/custom/configured/workspace' }
  assert.equal(cwdOf(null, mockCtx, volatileBox), '/custom/configured/workspace')

  // 4. Rollback and diff use snap.cwd when customCwd is omitted
  const eng = new ShadowSnapshotEngine({
    cwd: '/base/repo',
    exec: async (cmd, args) => {
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return { stdout: 'true' }
      if (args[0] === 'ls-tree') return { stdout: '100644 blob abc1234\ttest.txt' }
      return { stdout: '' }
    }
  })
  const snapWithCwd = {
    id: 'snap-recorded',
    commit: 'c-rec',
    ref: 'refs/rec',
    sessionId: 'sess-rec',
    cwd: '/recorded/repo/path'
  }
  eng.snapshots.push(snapWithCwd)
  assert.equal(eng.getCwdForSnapshot('snap-recorded'), '/recorded/repo/path')
})

test('rollback creates pre-rollback snapshot before git clean and both states are recoverable (issue #81)', async () => {
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const { execFile: execFileCb } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFile = promisify(execFileCb)
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js')

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-prerollback-'))
  try {
    await execFile('git', ['init'], { cwd: tmpDir })
    await execFile('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir })
    await execFile('git', ['config', 'user.email', 'test@test.local'], { cwd: tmpDir })

    const fileA = path.join(tmpDir, 'fileA.txt')
    await fs.writeFile(fileA, 'initial-content', 'utf8')
    await execFile('git', ['add', 'fileA.txt'], { cwd: tmpDir })
    await execFile('git', ['commit', '-m', 'initial commit'], { cwd: tmpDir })

    const engine = new ShadowSnapshotEngine({ cwd: tmpDir })
    const snap1 = await engine.createSnapshot('checkpoint-1')
    assert.ok(snap1.commit, 'snap1 must have commit')

    // Modify tracked file and add an untracked file
    await fs.writeFile(fileA, 'modified-content', 'utf8')
    const untracked = path.join(tmpDir, 'untracked.txt')
    await fs.writeFile(untracked, 'untracked-content', 'utf8')

    // Execute rollback to snap1
    const rollbackRes = await engine.rollbackSnapshot(snap1.id, { confirm: true })
    assert.equal(rollbackRes.rolledBack, true)
    assert.ok(rollbackRes.preRollbackId, 'must return preRollbackId')

    // Verify workspace is rolled back to snap1
    assert.equal(await fs.readFile(fileA, 'utf8'), 'initial-content')
    let untrackedExists = true
    try {
      await fs.access(untracked)
    } catch {
      untrackedExists = false
    }
    assert.equal(untrackedExists, false, 'untracked file must be cleaned up on rollback')

    // Rollback to pre-rollback snapshot restores both modified and untracked file
    const restoreRes = await engine.rollbackSnapshot(rollbackRes.preRollbackId, { confirm: true })
    assert.equal(restoreRes.rolledBack, true)
    assert.equal(await fs.readFile(fileA, 'utf8'), 'modified-content', 'modified content must be restored')
    assert.equal(await fs.readFile(untracked, 'utf8'), 'untracked-content', 'untracked file must be restored')
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
})
