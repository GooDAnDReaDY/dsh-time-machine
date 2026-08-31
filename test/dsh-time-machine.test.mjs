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
