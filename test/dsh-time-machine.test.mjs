import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const pkg = JSON.parse(read('package.json'));
const name = '@goodandready/dsh-time-machine';

test('private package identity matches all loader sites', () => {
  assert.equal(pkg.name, name);
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.publishConfig.access, 'public');
  assert.ok(read('cordis.patch.yml').includes("name: '@goodandready/dsh-time-machine'"));
  assert.ok(read('lib/client.js').includes("id: '@goodandready/dsh-time-machine'"));
});

test('tracked package sources contain no host-specific infra references', () => {
  const tracked = ['README.md', 'AGENTS.md', 'index.md', 'package.json', 'cordis.patch.yml', 'lib/client.js', 'lib/index.js'];
  for (const file of tracked) {
    const text = read(file);
    for (const marker of ['/' + 'home/', '/' + 'mnt/', '192.' + '168.', 'f' + 'ile:']) {
      assert.equal(text.includes(marker), false, file + ' contains ' + marker);
    }
  }
});

test('ShadowSnapshotEngine create/list/rollback/diff with maxSnapshots', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js');
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, args.join(' ')]);
    if (args[0] === 'rev-parse') throw Object.assign(new Error('not a git repo'), { stdout: '' });
    return { stdout: '' };
  };
  const eng = new ShadowSnapshotEngine({ exec, maxSnapshots: 2 });
  const a = await eng.createSnapshot('first');
  const b = await eng.createSnapshot('second');
  const c = await eng.createSnapshot('third');
  assert.equal(eng.listSnapshots().length, 2);
  assert.equal(eng.getSnapshot(a.id), null);
  assert.ok(eng.getSnapshot(c.id));
  // confirm required
  await assert.rejects(() => eng.rollbackSnapshot(b.id, { confirm: false }), /confirm/);
  await assert.rejects(() => eng.rollbackSnapshot(b.id, {}), /confirm/);
  await assert.rejects(() => eng.rollbackSnapshot('nope', { confirm: true }), /not found/);
  const ok = await eng.rollbackSnapshot(c.id, { confirm: true });
  assert.equal(ok.rolledBack, true);
  const diff = await eng.diff(c.id);
  assert.ok(diff.diff.includes('diff'));
  await assert.rejects(() => eng.diff('missing'), /not found/);
});

test('ShadowSnapshotEngine is session-scoped with per-session trim', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js');
  const exec = async (cmd, args) => {
    if (args[0] === 'rev-parse') throw Object.assign(new Error('not a git repo'), { stdout: '' });
    return { stdout: '' };
  };
  const eng = new ShadowSnapshotEngine({ exec, maxSnapshots: 2 });
  const sA = await eng.createSnapshot('a1', { sessionId: 'sessA' });
  const sA2 = await eng.createSnapshot('a2', { sessionId: 'sessA' });
  const sB = await eng.createSnapshot('b1', { sessionId: 'sessB' });
  const sA3 = await eng.createSnapshot('a3', { sessionId: 'sessA' });
  // per-session trim: sessA keeps newest 2, sessB unaffected
  assert.equal(eng.getSnapshot(sA.id), null, 'oldest sessA evicted');
  assert.ok(eng.getSnapshot(sA2.id));
  assert.ok(eng.getSnapshot(sA3.id));
  assert.ok(eng.getSnapshot(sB.id));
  // list filters by session
  assert.deepEqual(eng.listSnapshots('sessA').map(s => s.sessionId), ['sessA', 'sessA']);
  assert.deepEqual(eng.listSnapshots('sessB').map(s => s.sessionId), ['sessB']);
  // global list still returns all
  assert.equal(eng.listSnapshots().length, 3);
  // git ref path is session-scoped
  const gitEng = new ShadowSnapshotEngine({ exec: async (cmd, args) => {
    if (args[0] === 'rev-parse') return { stdout: 'true\n' };
    if (args[0] === 'add') return { stdout: '' };
    if (args[0] === 'write-tree') return { stdout: 'abc123tree\n' };
    if (args[0] === 'commit-tree') return { stdout: 'def456commit\n' };
    if (args[0] === 'update-ref') return { stdout: '' };
    return { stdout: '' };
  }, maxSnapshots: 5 });
  const snap = await gitEng.createSnapshot('x', { sessionId: 'S1' });
  assert.equal(snap.ref, `refs/dsh-time-machine/S1/${snap.id}`);
  const snapNoSession = await gitEng.createSnapshot('y');
  assert.equal(snapNoSession.ref, `refs/dsh-time-machine/${snapNoSession.id}`);
});

test('host index wires auto-snapshot events and session-aware tools', () => {
  const host = read('lib/index.js');
  assert.ok(host.includes("ctx.events.on('turn/start'"), 'must listen turn/start');
  assert.ok(host.includes("ctx.events.on('approval/asked'"), 'must listen approval/asked');
  assert.ok(host.includes("ctx.events.on('turn/end'"), 'must listen turn/end for auto-prune');
  assert.ok(host.includes('autoSnapshotEnabled'), 'config gate present');
  assert.ok(host.includes('sessionId'), 'session scoping present');
  assert.ok(host.includes('engine.createSnapshot(label, { sessionId: sid })') || host.includes("engine.createSnapshot(label, { sessionId"), 'auto snap passes sessionId');
});

test('delete + prune lifecycle', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js');
  const exec = async (cmd, args) => {
    if (args[0] === 'rev-parse') throw Object.assign(new Error('not a git repo'), { stdout: '' });
    return { stdout: '' };
  };
  const eng = new ShadowSnapshotEngine({ exec, maxSnapshots: 20 });
  const a = await eng.createSnapshot('a', { sessionId: 'S' });
  const b = await eng.createSnapshot('b', { sessionId: 'S' });
  const c = await eng.createSnapshot('c', { sessionId: 'S' });
  const d = await eng.createSnapshot('d', { sessionId: 'S' });
  // delete requires confirm
  await assert.rejects(() => eng.deleteSnapshot(a.id), /confirm/);
  await assert.rejects(() => eng.deleteSnapshot('nope', { confirm: true }), /not found/);
  await eng.deleteSnapshot(a.id, { confirm: true });
  assert.equal(eng.getSnapshot(a.id), null);
  assert.equal(eng.listSnapshots('S').length, 3);
  // prune keeps newest N
  const pr = await eng.pruneSnapshots('S', 2);
  assert.equal(pr.kept, 2);
  assert.equal(eng.listSnapshots('S').length, 2);
  assert.ok(eng.getSnapshot(d.id), 'newest kept');
  assert.equal(eng.getSnapshot(b.id), null, 'oldest pruned');
});

test('loadFromRefs restores checkpoints after restart', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js');
  // simulate git repo with two shadow refs; treat as a fresh engine (restart)
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push(args[0]);
    if (args[0] === 'rev-parse') return { stdout: 'true\n' };
    if (args[0] === 'for-each-ref') {
      return { stdout: 'refs/dsh-time-machine/S1/aaa1\0c111aaa\nrefs/dsh-time-machine/S1/bbb2\0c222bbb\n' };
    }
    if (args[0] === 'log') {
      // ref -> time|label
      const ref = args[args.length - 1];
      if (ref === 'refs/dsh-time-machine/S1/aaa1') return { stdout: '1700000000\0first\0' };
      if (ref === 'refs/dsh-time-machine/S1/bbb2') return { stdout: '1700000100\0second\0' };
      return { stdout: '' };
    }
    return { stdout: '' };
  };
  const eng = new ShadowSnapshotEngine({ exec, maxSnapshots: 5 });
  const n = await eng.loadFromRefs();
  assert.equal(n, 2);
  assert.equal(eng.listSnapshots().length, 2);
  const list = eng.listSnapshots('S1');
  assert.equal(list.length, 2);
  assert.equal(list[0].label, 'second', 'newest first');
  assert.equal(list[0].sessionId, 'S1');
  assert.equal(list[1].label, 'first');
  // new snapshot beyond restored keeps later seq (created last)
  const after = await eng.createSnapshot('third', { sessionId: 'S1' });
  const all = eng.listSnapshots('S1');
  assert.equal(all.length, 3);
  assert.equal(all[0].label, 'third');
  assert.ok(after.seq > list[0].seq, 'created after restore has larger seq');
});

test('host apply restores refs on boot', () => {
  const host = read('lib/index.js');
  assert.ok(host.includes('engine.loadFromRefs()') || host.includes('engine.loadFromRefs'), 'must load refs on apply');
});

test('turn/end auto-prune keeps 3 on success', async () => {
  const host = read('lib/index.js');
  assert.ok(host.includes("engine.pruneSnapshots(sid, 3)"), 'prune(keep 3) wired on success');
  assert.ok(host.includes("outcome === 'success'"), 'success outcome checked');
});

test('client timeline is session-filtered', () => {
  const text = read('lib/client.js');
  assert.ok(text.includes("'/dsh-time-machine/snapshots' + q") || text.includes("'/dsh-time-machine/snapshots'+q") || text.includes("'/dsh-time-machine/snapshots'"), 'session-filtered fetch in Timeline');
  assert.ok(text.includes('sessionId'), 'sessionId helper in client');
});

test('ShadowSnapshotEngine uses git shadow refs when repo present', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js');
  const log = [];
  const exec = async (cmd, args) => {
    log.push(args[0]);
    if (args[0] === 'rev-parse') return { stdout: 'true\n' };
    if (args[0] === 'add') return { stdout: '' };
    if (args[0] === 'write-tree') return { stdout: 'abc123tree\n' };
    if (args[0] === 'commit-tree') return { stdout: 'def456commit\n' };
    if (args[0] === 'update-ref') return { stdout: '' };
    if (args[0] === 'diff') return { stdout: ' file.txt | 2 +-' };
    if (args[0] === 'reset') return { stdout: '' };
    return { stdout: '' };
  };
  const eng = new ShadowSnapshotEngine({ exec, maxSnapshots: 5 });
  const snap = await eng.createSnapshot('git-label');
  assert.equal(snap.commit, 'def456commit');
  assert.equal(snap.ref, `refs/dsh-time-machine/${snap.id}`);
  const d = await eng.diff(snap.id);
  assert.ok(d.diff.includes('file.txt'));
  const r = await eng.rollbackSnapshot(snap.id, { confirm: true });
  assert.ok(r.rolledBack);
});

test('plugin registers 4 tools with correct security flags (static)', () => {
  const text = read('lib/index.js');
  for (const n of ['time_machine_checkpoint_create','time_machine_checkpoint_list','time_machine_checkpoint_rollback','time_machine_diff']) {
    assert.ok(text.includes(n), `missing ${n}`);
  }
  assert.ok(text.includes("confirm") && text.includes("required"), 'rollback must require confirm');
  // ponytail: static check avoids needing @deepseek-ai/schemastery in test env
});

test('client card uses plugin.item with prefixed classes and theme vars', () => {
  const text = read('lib/client.js');
  assert.ok(text.includes("name: 'settings.plugin.item'"));
  assert.ok(text.includes("key: NS"));
  assert.ok(text.includes('tm-card'));
  assert.ok(text.includes('var(--dsw-alias-border-l2)'));
  assert.ok(text.includes('border-radius:12px'));
  assert.ok(text.includes('IconChevronDownOutline14') || text.includes('FallbackChevron'));
  // hooks before returns: ensure useState appears before early return pattern
  assert.ok(text.indexOf('useState') < text.indexOf('expanded ?'));
});

test('client registers betterSidebar tab with fallback', () => {
  const text = read('lib/client.js');
  assert.ok(text.includes('betterSidebar') && text.includes('registerTab'), 'missing betterSidebar registerTab');
  assert.ok(text.includes("id: 'time-machine'") || text.includes('id: "time-machine"'));
  assert.ok(text.includes('TimeMachineTab') && text.includes('component'));
});

test('browser entry compatible with DSH 0.1.2-alpha.2 (no dsh-client-runtime)', () => {
  const inject = pkg.dsh?.client?.inject || [];
  assert.equal(inject.includes('@deepseek-ai/dsh-client-runtime'), false, 'obsolete @deepseek-ai/dsh-client-runtime must be removed for alpha2');
  assert.equal(inject.includes('@deepseek-ai/dsh-client-ui-slots'), false, 'must keep @deepseek-ai/dsh-client-ui-slots — инвертировано для ядра 0.1.2-rc.1 (модуль убран)');
  const client = read('lib/client.js');
  assert.equal(client.includes('@deepseek-ai/dsh-client-runtime'), false, 'client.js must not require obsolete runtime');
});

test('client registration is declaration-safe (alpha2 SlotCore)', () => {
  const text = read('lib/client.js');
  assert.ok(text.includes("ctx.slots.inject('settings.plugin.item'") || text.includes('ctx.slots.inject("settings.plugin.item"'), 'must use slots.inject for settings.plugin.item');
  assert.ok(text.includes("ctx.inject(['betterSidebar']") || text.includes('ctx.inject(["betterSidebar"]'), 'betterSidebar via inject single path');
  // old direct double-path must be gone (call site, not definition)
  assert.equal((text.match(/registerBetterSidebar\(ctx\);/g) || []).length, 0, 'should not have direct registerBetterSidebar(ctx); double path');
});

test('safe rollback executes read-tree and clean without moving branch HEAD', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js');
  const commands = [];
  const exec = async (cmd, args) => {
    commands.push(args[0]);
    if (args[0] === 'rev-parse') return { stdout: 'true\n' };
    return { stdout: '' };
  };
  const eng = new ShadowSnapshotEngine({ exec });
  eng.snapshots.push({ id: 's1', commit: 'abc123commit', ref: 'refs/dsh-time-machine/s1' });
  const res = await eng.rollbackSnapshot('s1', { confirm: true });
  assert.ok(res.rolledBack);
  assert.ok(commands.includes('read-tree'), 'must use read-tree');
  assert.ok(commands.includes('checkout-index'), 'must checkout index');
  assert.ok(commands.includes('clean'), 'must clean untracked files');
  assert.equal(commands.includes('reset'), false, 'MUST NOT use git reset which destroys branch HEAD');
});

test('shadow snapshots use isolated GIT_INDEX_FILE and author env', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js');
  let capturedEnv = null;
  const exec = async (cmd, args, opts) => {
    if (args[0] === 'add') capturedEnv = opts?.env;
    if (args[0] === 'rev-parse') {
      if (args[1] === '--git-dir') return { stdout: '.git\n' };
      return { stdout: 'true\n' };
    }
    if (args[0] === 'write-tree') return { stdout: 'treehash\n' };
    if (args[0] === 'commit-tree') return { stdout: 'commithash\n' };
    return { stdout: '' };
  };
  const eng = new ShadowSnapshotEngine({ exec });
  const snap = await eng.createSnapshot('test-shadow');
  assert.ok(snap.commit);
  assert.ok(capturedEnv?.GIT_INDEX_FILE?.includes('tm_index_'), 'must isolate staging area via GIT_INDEX_FILE');
  assert.equal(capturedEnv?.GIT_AUTHOR_NAME, 'DSH Time Machine');
});

test('trimming evicted snapshots deletes their git refs', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js');
  const deletedRefs = [];
  const exec = async (cmd, args) => {
    if (args[0] === 'update-ref' && args[1] === '-d') {
      deletedRefs.push(args[2]);
    }
    return { stdout: '' };
  };
  const eng = new ShadowSnapshotEngine({ exec, maxSnapshots: 2 });
  eng.snapshots.push(
    { id: '1', sessionId: 's1', ref: 'refs/dsh-time-machine/s1/1', seq: 1 },
    { id: '2', sessionId: 's1', ref: 'refs/dsh-time-machine/s1/2', seq: 2 },
    { id: '3', sessionId: 's1', ref: 'refs/dsh-time-machine/s1/3', seq: 3 }
  );
  await eng._trimFor('s1');
  assert.equal(eng.snapshots.length, 2);
  assert.ok(deletedRefs.includes('refs/dsh-time-machine/s1/1'), 'oldest ref must be deleted from git');
});

test('pruneSnapshots with keep=0 removes all session snapshots', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js');
  const exec = async () => ({ stdout: '' });
  const eng = new ShadowSnapshotEngine({ exec });
  eng.snapshots.push(
    { id: 'a', sessionId: 'sess', ref: 'refs/dsh-time-machine/sess/a', createdAt: 100, seq: 1 },
    { id: 'b', sessionId: 'sess', ref: 'refs/dsh-time-machine/sess/b', createdAt: 200, seq: 2 }
  );
  const out = await eng.pruneSnapshots('sess', 0);
  assert.equal(out.removed.length, 2);
  assert.equal(eng.listSnapshots('sess').length, 0);
});

test('host listens to native session/event bus and handles errors', async () => {
  const text = read('lib/index.js');
  assert.ok(text.includes("ctx.on('session/event'"), 'must listen to native session/event');
  assert.ok(text.includes('auto:error:'), 'must support error checkpoint for autoHealPrompt');
  assert.ok(text.includes('readJsonBody') && text.includes('1024 * 1024'), 'must protect against DoS payload');
});

test('client enforces writable only on ready status and provides zh locale', () => {
  const text = read('lib/client.js');
  assert.ok(text.includes("const writable = settingsStatus === 'ready';"), 'writable must be strictly ready');
  assert.ok(text.includes('时光机'), 'must provide Chinese localization');
});
test('peerDependencies does not contain dead dsh-credentials', () => {
  const currentPkg = JSON.parse(read('package.json'));
  assert.equal(Boolean(currentPkg.peerDependencies && '@deepseek-ai/dsh-credentials' in currentPkg.peerDependencies), false, 'dead credentials peer dependency must be removed');
});

test('event bus subscription prevents double-firing by prioritizing native session/event', () => {
  const text = read('lib/index.js');
  assert.ok(text.includes("const hasNativeEvents = typeof ctx.on === 'function';"), 'checks native event support');
  assert.ok(text.includes('if (hasNativeEvents)'), 'branches on native support');
  assert.ok(text.includes('} else {'), 'legacy events fallback only when native missing');
  assert.ok(text.includes("ctx.events.on('turn/start'"), 'preserves fallback turn/start');
});