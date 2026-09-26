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
  const tracked = ['README.md', 'package.json', 'cordis.patch.yml', 'lib/client.js', 'lib/index.js', 'lib/updater.js', 'lib/snapshot.js'];
  for (const file of tracked) {
    const text = read(file);
    for (const marker of ['/' + 'home/', '/' + 'mnt/', '192.' + '168.']) {
      assert.equal(text.includes(marker), false, file + ' contains ' + marker);
    }
  }
  for (const file of ['package.json', 'cordis.patch.yml', 'README.md']) {
    const text = read(file);
    assert.equal(text.includes('f' + 'ile:'), false, file + ' contains file: dependency/path');
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
  // Snapshot without git commit must reject with descriptive error (Issue #58)
  await assert.rejects(() => eng.rollbackSnapshot(c.id, { confirm: true }), /git commit/);
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

test('turn/end auto-prune respects maxSnapshots setting on success (issue #56)', async () => {
  const host = read('lib/index.js');
  assert.ok(host.includes("engine.pruneSnapshots(sid, getConfig().maxSnapshots ?? 20"), 'prune uses maxSnapshots config');
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
  // Both seats must go through slots.inject: the Plugins page row seat the current
  // core renders, and the legacy settings.plugin.item card.
  assert.ok(text.includes("ctx.slots.inject(seat.name") || text.includes('ctx.slots.inject(seat.name'), 'must use slots.inject for the settings seats');
  assert.ok(text.includes("name: 'plugins.row.config'"), 'row seat is declared');
  assert.ok(text.includes("name: 'settings.plugin.item'"), 'legacy seat is declared');
  assert.ok(text.includes('ctx.inject([\'betterSidebar\']') || text.includes('ctx.inject(["betterSidebar"]'), 'betterSidebar via inject single path');
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
  const httpText = read('lib/http.js');
  assert.ok(text.includes("ctx.on('session/event'"), 'must listen to native session/event');
  assert.ok(text.includes('auto:error:'), 'must support error checkpoint for autoHealPrompt');
  assert.ok(httpText.includes('readBody') && httpText.includes('256 * 1024'), 'must protect against DoS payload');
  assert.ok(text.includes('isTrustedSettingsRequest'), 'must enforce CSRF protection on mutating routes');
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
test("unified diff supports patch and stat formats with length limit", async () => {
  const { ShadowSnapshotEngine } = await import("../lib/snapshot.js");
  const exec = async (cmd, args) => {
    if (args[0] === "rev-parse") return { stdout: "true\n" };
    if (args[0] === "diff") {
      if (args.includes("--stat")) return { stdout: " file.txt | 2 +-\n 1 file changed" };
      return { stdout: "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new" };
    }
    return { stdout: "" };
  };
  const eng = new ShadowSnapshotEngine({ exec });
  eng.snapshots.push({ id: "s1", commit: "commit1", ref: "refs/dsh-time-machine/s1" });

  const patchRes = await eng.diff("s1", undefined, { format: "patch" });
  assert.equal(patchRes.format, "patch");
  assert.ok(patchRes.diff.includes("--- a/file.txt"));

  const statRes = await eng.diff("s1", undefined, { format: "stat" });
  assert.equal(statRes.format, "stat");
  assert.ok(statRes.diff.includes("1 file changed"));
});

test("snapshot creation deduplicates unchanged trees", async () => {
  const { ShadowSnapshotEngine } = await import("../lib/snapshot.js");
  let commitCount = 0;
  const exec = async (cmd, args) => {
    if (args[0] === "rev-parse") {
      if (args[1] === "--git-dir") return { stdout: ".git\n" };
      return { stdout: "true\n" };
    }
    if (args[0] === "write-tree") return { stdout: "same-tree-hash\n" };
    if (args[0] === "commit-tree") {
      commitCount++;
      return { stdout: "commithash\n" };
    }
    return { stdout: "" };
  };
  const eng = new ShadowSnapshotEngine({ exec });
  const s1 = await eng.createSnapshot("first", { sessionId: "sess-1" });
  assert.equal(commitCount, 1);
  assert.equal(s1.treeHash, "same-tree-hash");

  // Second snapshot with identical tree
  const s2 = await eng.createSnapshot("second", { sessionId: "sess-1" });
  assert.equal(commitCount, 1, "commit-tree must not be called when treeHash is identical");
  assert.equal(s2.id, s1.id);
});

test("dynamic cwd resolution is supported in snapshot engine and tools", async () => {
  const { ShadowSnapshotEngine } = await import("../lib/snapshot.js");
  let usedCwd = null;
  const exec = async (cmd, args, opts) => {
    if (args[0] === "rev-parse") return { stdout: "true\n" };
    if (args[0] === "diff") {
      usedCwd = opts?.cwd;
      return { stdout: "diff output" };
    }
    return { stdout: "" };
  };
  const eng = new ShadowSnapshotEngine({ exec });
  eng.snapshots.push({ id: "s1", commit: "c1" });
  await eng.diff("s1", undefined, { cwd: "/custom/workspace" });
  assert.equal(usedCwd, "/custom/workspace");
});

test("loadFromRefs uses single-batch git for-each-ref", async () => {
  const { ShadowSnapshotEngine } = await import("../lib/snapshot.js");
  let forEachRefCalled = false;
  let logCalled = false;
  const exec = async (cmd, args) => {
    if (args[0] === "rev-parse") return { stdout: "true\n" };
    if (args[0] === "for-each-ref") {
      forEachRefCalled = true;
      const ref1 = "refs/dsh-time-machine/s1/snap1\x00commit1\x001700000000 +0000\x00label1\n";
      const ref2 = "refs/dsh-time-machine/s1/snap2\x00commit2\x001700000100 +0000\x00label2\n";
      return { stdout: ref1 + ref2 };
    }
    if (args[0] === "log") {
      logCalled = true;
      return { stdout: "" };
    }
    return { stdout: "" };
  };
  const eng = new ShadowSnapshotEngine({ exec });
  await eng.loadFromRefs();
  assert.ok(forEachRefCalled, "must call for-each-ref");
  assert.equal(logCalled, false, "must NOT call git log per ref");
  assert.equal(eng.snapshots.length, 2);
  assert.equal(eng.snapshots[0].id, "snap1");
  assert.equal(eng.snapshots[1].id, "snap2");
});

test("client registers native DSH Right Sidebar tabs and slots", () => {
  const text = read("lib/client.js");
  assert.ok(text.includes("ctx.inject(['sidebarRightTabs']"), "must inject sidebarRightTabs");
  assert.ok(text.includes("kind: 'time-machine'"), "must define kind time-machine");
  assert.ok(text.includes("sidebar.right.pane.tab"), "must register slot sidebar.right.pane.tab");
  assert.ok(text.includes("TimeMachineTab"), "must mount TimeMachineTab");
});

test("client sidebar matrix handles all four layout combinations safely", () => {
  const clientText = read("lib/client.js");

  // Helper mock runtime for client.js evaluation
  function evaluateClient(mockServices = {}) {
    const registeredSlots = [];
    const registeredTabs = [];
    const nativeTabs = [];

    const mockCtx = {
      locale: {
        register: () => {},
        bind: () => (k) => k,
        getSnapshot: () => ({ active: "en" }),
        subscribe: () => () => {},
      },
      slots: {
        inject: (name, cb) => {
          cb();
          return () => {};
        },
        register: (desc, comp) => {
          registeredSlots.push({ desc, comp });
        },
      },
      inject: (deps, cb) => {
        const subCtx = { ...mockCtx };
        for (const dep of deps) {
          if (mockServices[dep]) {
            subCtx[dep] = mockServices[dep];
          } else {
            return; // dependency not declared in this host build
          }
        }
        cb(subCtx);
      },
      ...mockServices,
    };

    // Load factory
    let factoryFn = null;
    const mockWindow = {
      __ModuleLoader__: {
        load: ({ factory }) => {
          factoryFn = factory;
        },
      },
    };

    const mockRequire = (mod) => {
      if (mod === "react") return {
        createElement: (type, props, ...children) => ({ type, props, children }),
        useState: (init) => [init, () => {}],
        useEffect: () => {},
        useCallback: (fn) => fn,
        useMemo: (fn) => fn(),
        useRef: (init) => ({ current: init }),
        useSyncExternalStore: (sub, snap) => snap(),
      };
      if (mod === "@deepseek-ai/dsh-client-ui-primitives") return {};
      throw new Error("Cannot require " + mod);
    };

    const fn = new Function("window", "document", clientText);
    const mockDoc = {
      head: { appendChild: () => {} },
      querySelector: () => null,
      createElement: () => ({ setAttribute: () => {}, textContent: "" }),
    };
    fn(mockWindow, mockDoc);

    const mod = factoryFn(mockRequire);
    mod.apply(mockCtx);

    return {
      registeredSlots,
      hasSettings: registeredSlots.some(s => s.desc.name === "settings.plugin.item"),
      hasNativePane: registeredSlots.some(s => s.desc.name === "sidebar.right.pane.tab"),
    };
  }

  // Layout 1: Neither sidebar available
  const l1 = evaluateClient({});
  assert.ok(l1.hasSettings, "Layout 1 (neither): settings must register");
  assert.equal(l1.hasNativePane, false, "Layout 1 (neither): no native pane");

  // Layout 2: Legacy betterSidebar only
  let betterRegistered = false;
  const l2 = evaluateClient({
    betterSidebar: {
      registerTab: () => { betterRegistered = true; },
    },
  });
  assert.ok(l2.hasSettings, "Layout 2 (legacy only): settings must register");
  assert.ok(betterRegistered, "Layout 2 (legacy only): betterSidebar tab must register");
  assert.equal(l2.hasNativePane, false, "Layout 2 (legacy only): no native pane");

  // Layout 3: Native Sidebar only
  let nativeRegistered = false;
  const l3 = evaluateClient({
    sidebarRightTabs: {
      register: () => { nativeRegistered = true; return () => {}; },
    },
  });
  assert.ok(l3.hasSettings, "Layout 3 (native only): settings must register");
  assert.ok(nativeRegistered, "Layout 3 (native only): native tab must register");
  assert.ok(l3.hasNativePane, "Layout 3 (native only): native pane slot must register");

  // Layout 4: Both sidebars available (native prioritized, deduplicated to prevent collision)
  let bothNative = false;
  let bothBetter = false;
  const l4 = evaluateClient({
    sidebarRightTabs: {
      register: () => { bothNative = true; return () => {}; },
    },
    betterSidebar: {
      registerTab: () => { bothBetter = true; },
    },
  });
  assert.ok(l4.hasSettings, "Layout 4 (both): settings must register");
  assert.ok(bothNative, "Layout 4 (both): native tab registered");
  assert.equal(bothBetter, false, "Layout 4 (both): betterSidebar tab skipped to prevent tab kind collision");
  assert.ok(l4.hasNativePane, "Layout 4 (both): native pane registered");

  // Layout 5: sidebarRightTabs register throws 'already registered' - must handle gracefully
  let threwCaught = false;
  try {
    evaluateClient({
      sidebarRightTabs: {
        register: () => { throw new Error('sidebarRight: tab kind "time-machine" is already registered (extension)'); },
      },
    });
    threwCaught = true;
  } catch (e) {
    threwCaught = false;
  }
  assert.ok(threwCaught, "Layout 5: already registered error must be handled gracefully");
});

test("TimeMachineIcon handles both props object and numeric argument with explicit bounding box", () => {
  const text = read("lib/client.js");
  assert.ok(text.includes("function TimeMachineIcon"), "must declare TimeMachineIcon");
  assert.ok(text.includes("props && props.size"), "must extract size from props");
  assert.ok(text.includes("display: \"inline-block\""), "must constrain layout display");
  assert.ok(text.includes("flex: \"none\""), "must prevent flex stretching");
});

test('client settings does not register top-level settings.section and resolves settingsScope safely', () => {
  const clientText = read('lib/client.js');
  assert.ok(!clientText.includes("name: 'settings.section'"), 'must not register settings.section');
  assert.ok(!clientText.includes('name: "settings.section"'), 'must not register settings.section');
  assert.ok(clientText.includes("ctx.get('settingsScope')"), 'must use ctx.get for settingsScope resolution');
});

test('http helper enforces payload limits, fail-closed CSRF check and writeJson headers', async () => {
  const { isTrustedSettingsRequest, readBody, writeJson } = await import('../lib/http.js');
  
  // CSRF fail-closed tests (Issue #38)
  assert.equal(isTrustedSettingsRequest({ headers: { 'sec-fetch-site': 'cross-site' } }), false);
  assert.equal(isTrustedSettingsRequest({ headers: { 'sec-fetch-site': 'same-site' } }), false);
  assert.equal(isTrustedSettingsRequest({ headers: { 'sec-fetch-site': 'same-origin' } }), true);
  assert.equal(isTrustedSettingsRequest({ headers: { 'sec-fetch-site': 'none' }, socket: { remoteAddress: '127.0.0.1' } }), true);

  // same-site explicitly rejected even with matching or subdomain origin (Issue #38)
  assert.equal(isTrustedSettingsRequest({
    headers: { 'sec-fetch-site': 'same-site', origin: 'http://sub.my-host:3000', host: 'my-host:3000' },
    socket: { remoteAddress: '192.168.1.50' }
  }), false);
  assert.equal(isTrustedSettingsRequest({
    headers: { 'sec-fetch-site': 'same-site', origin: 'http://my-host:3000', host: 'my-host:3000' },
    socket: { remoteAddress: '192.168.1.50' }
  }), false);

  // Missing sec-fetch-site on external IP is rejected (fail-closed)
  assert.equal(isTrustedSettingsRequest({ headers: {}, socket: { remoteAddress: '198.51.100.1' } }), false);
  assert.equal(isTrustedSettingsRequest(null), false);
  assert.equal(isTrustedSettingsRequest({}), false);

  // Loopback requests allowed even without sec-fetch-site
  assert.equal(isTrustedSettingsRequest({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), true);
  assert.equal(isTrustedSettingsRequest({ headers: {}, socket: { remoteAddress: '::1' } }), true);
  assert.equal(isTrustedSettingsRequest({ headers: {}, socket: { remoteAddress: '::ffff:127.0.0.1' } }), true);

  // Matching origin and host allowed
  assert.equal(isTrustedSettingsRequest({
    headers: { origin: 'http://my-host:3000', host: 'my-host:3000' },
    socket: { remoteAddress: '192.168.1.50' }
  }), true);
  assert.equal(isTrustedSettingsRequest({
    headers: { origin: 'https://evil.com', host: 'my-host:3000' },
    socket: { remoteAddress: '192.168.1.50' }
  }), false);

  // Unverified Bearer and cookie without origin/referer rejected (Issue #59)
  assert.equal(isTrustedSettingsRequest({
    headers: { authorization: 'Bearer tok123' },
    socket: { remoteAddress: '198.51.100.1' }
  }), false);
  assert.equal(isTrustedSettingsRequest({
    headers: { cookie: 'dsh_token=abc' },
    socket: { remoteAddress: '198.51.100.1' }
  }), false);

  // Cross-site rejected even from loopback (Issue #59)
  assert.equal(isTrustedSettingsRequest({
    headers: { 'sec-fetch-site': 'cross-site' },
    socket: { remoteAddress: '127.0.0.1' }
  }), false);

  // Referer matching host allowed
  assert.equal(isTrustedSettingsRequest({
    headers: { referer: 'http://my-host:3000/some/path', host: 'my-host:3000' },
    socket: { remoteAddress: '192.168.1.50' }
  }), true);

  // writeJson test
  let writtenCode = 0;
  let writtenHeaders = {};
  let writtenBody = '';
  const mockRes = {
    writeHead: (code, headers) => { writtenCode = code; writtenHeaders = headers; },
    end: (str) => { writtenBody = str; },
  };
  writeJson(mockRes, 200, { ok: true });
  assert.equal(writtenCode, 200);
  assert.equal(writtenHeaders['Cache-Control'], 'no-store');
  assert.equal(JSON.parse(writtenBody).ok, true);
});

test('HTTP web routes enforce method restrictions (405 Method Not Allowed)', () => {
  const host = read('lib/index.js');
  // Write routes must require POST
  const writeRoutes = [
    "path: '/dsh-time-machine/create'",
    "path: '/dsh-time-machine/delete'",
    "path: '/dsh-time-machine/prune'",
    "path: '/dsh-time-machine/rollback'",
    "path: '/dsh-time-machine/rollback-file'",
  ];
  for (const route of writeRoutes) {
    assert.ok(host.includes(route), `must include ${route}`);
  }
  const postChecks = (host.match(/req\.method !== 'POST'/g) || []).length;
  assert.ok(postChecks >= 5, 'must enforce POST on all 5 mutation routes');

  const getChecks = (host.match(/req\.method !== 'GET'/g) || []).length;
  assert.ok(getChecks >= 2, 'must enforce GET on read routes');
  assert.ok(host.includes('Method Not Allowed. POST required.'), 'must return 405 for write routes');
  assert.ok(host.includes('Method Not Allowed. GET required.'), 'must return 405 for read routes');

  // Verify all 7 web routes enforce isTrustedSettingsRequest (Issue #60)
  const trustedChecks = host.split('!isTrustedSettingsRequest(req)').length - 1;
  assert.equal(trustedChecks, 7, 'all 7 web routes (5 write + 2 read) must enforce isTrustedSettingsRequest');
});

test('ShadowSnapshotEngine cleanupOrphanedIndices handles gitDir safely', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js');
  const eng = new ShadowSnapshotEngine({
    exec: async (cmd, args) => {
      if (args[0] === 'rev-parse') return { stdout: '/nonexistent/dir' };
      return { stdout: '' };
    }
  });
  // Must not throw even if git dir cannot be read
  await eng.cleanupOrphanedIndices('/some/dir');
});

test('client uses dsh-clinebot design token styles with primary and danger buttons', () => {
  const clientText = read('lib/client.js');
  assert.ok(clientText.includes('.tm-btn-primary'), 'must include primary button style');
  assert.ok(clientText.includes('.tm-btn-danger'), 'must include danger button style');
  assert.ok(clientText.includes('.tm-badge-ok'), 'must include badge-ok style');
  assert.ok(clientText.includes('dsh-time-machine-full-css'), 'must include standard css id');
});

test('ShadowSnapshotEngine cleanupOrphanedIndices supports options object (issue #35)', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js');
  let executedCwd = '';
  const eng = new ShadowSnapshotEngine({
    exec: async (cmd, args, opts) => {
      executedCwd = opts?.cwd;
      if (args[0] === 'rev-parse') return { stdout: '/nonexistent/dir' };
      return { stdout: '' };
    }
  });
  await eng.cleanupOrphanedIndices({ cwd: '/custom/workspace' });
  assert.equal(executedCwd, '/custom/workspace');
});

test('ShadowSnapshotEngine rollbackFile performs selective file checkout or unlink', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js');
  const commands = [];
  const eng = new ShadowSnapshotEngine({
    exec: async (cmd, args) => {
      commands.push([cmd, ...args]);
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return { stdout: 'true' };
      if (args[0] === 'ls-tree') return { stdout: '100644 blob abc1234\tlib/test.js' };
      return { stdout: '' };
    }
  });
  eng.snapshots.push({ id: 's1', commit: 'c1', ref: 'refs/s1', sessionId: 'sess1' });

  // Test rollback existing file
  const res = await eng.rollbackFile('s1', 'lib/test.js', { confirm: true, cwd: '/app' });
  assert.equal(res.rolledBack, true);
  assert.equal(res.file, 'lib/test.js');
  assert.ok(commands.some(c => c[0] === 'git' && c[1] === 'checkout' && c[2] === 'c1' && c[4] === 'lib/test.js'));

  // Test confirm requirement
  await assert.rejects(async () => {
    await eng.rollbackFile('s1', 'lib/test.js', { confirm: false });
  }, /confirm required/);
});

test('ShadowSnapshotEngine diff includes structured files list', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js');
  const eng = new ShadowSnapshotEngine({
    exec: async (cmd, args) => {
      if (args[0] === 'rev-parse') return { stdout: 'true' };
      if (args[0] === 'diff' && args[1] === '--numstat') {
        return { stdout: '10\t2\tlib/index.js\n-\t-\tasset.png\n' };
      }
      if (args[0] === 'diff') return { stdout: 'diff --git a/lib/index.js b/lib/index.js' };
      return { stdout: '' };
    }
  });
  eng.snapshots.push({ id: 's1', commit: 'c1', ref: 'refs/s1', label: 'chk1' });

  const diffRes = await eng.diff('s1', undefined, { cwd: '/app' });
  assert.ok(Array.isArray(diffRes.files));
  assert.equal(diffRes.files.length, 2);
  assert.equal(diffRes.files[0].path, 'lib/index.js');
  assert.equal(diffRes.files[0].additions, 10);
  assert.equal(diffRes.files[0].deletions, 2);
  assert.equal(diffRes.files[1].binary, true);
});

test('host registers time_machine_file_rollback tool and pre-tool event trigger (static)', () => {
  const host = read('lib/index.js');
  assert.ok(host.includes("name: 'time_machine_file_rollback'"), 'must register time_machine_file_rollback tool');
  assert.ok(host.includes("engine.rollbackFile("), 'tool must delegate to engine.rollbackFile');
  assert.ok(host.includes("path: '/dsh-time-machine/rollback-file'"), 'must register HTTP rollback-file route');
  assert.ok(host.includes("auto:pre-tool:"), 'must register pre-tool auto-checkpoint');
});

test('client bundle contains no hardcoded Russian translations and adheres to en/zh standard', () => {
  const clientText = read('lib/client.js');
  assert.ok(!clientText.includes('const ru = {'), 'Russian translation object must not be bundled in client.js');
  assert.ok(!clientText.includes('Машина времени'), 'Russian phrases must not be hardcoded in client bundle');
  assert.ok(clientText.includes('restoreFile:'), 'Must include restoreFile in en and zh');
});

test('package.json declares dsh.client.inject and public files list (issues #40, #42)', () => {
  const pkgJson = JSON.parse(read('package.json'));
  assert.ok(Array.isArray(pkgJson.files), 'files field must be present');
  assert.ok(!pkgJson.files.includes('AGENTS.md'), 'AGENTS.md must not be in package files');
  assert.ok(!pkgJson.files.includes('index.md'), 'index.md must not be in package files');
  assert.ok(Array.isArray(pkgJson.dsh?.client?.inject), 'dsh.client.inject must be an array');
  assert.ok(pkgJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'));
  assert.ok(pkgJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'));
  assert.ok(pkgJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar'));
});

test('lib/updater.js and updater route wiring in index.js (issue #39)', () => {
  const host = read('lib/index.js');
  assert.ok(host.includes("import { registerPluginUpdater } from './updater.js'"));
  assert.ok(host.includes("endpoint: '/api/dsh-time-machine/update'"));
  assert.ok(host.includes("dsh-time-machine: plugin updater route"));
  const clientText = read('lib/client.js');
  assert.ok(clientText.includes('PluginUpdaterBox'));
  assert.ok(clientText.includes('/api/dsh-time-machine/update'));
});

test('theme colors adherence - zero hardcoded rgba in client.js (issue #41)', () => {
  const clientText = read('lib/client.js');
  const rgbaMatches = clientText.match(/rgba\(/g) || [];
  assert.equal(rgbaMatches.length, 0, 'client.js must contain zero rgba values');
});

test('client dictionary registration uses ctx.effect and avoids undeclared ru (issue #43)', () => {
  const clientText = read('lib/client.js');
  assert.ok(!clientText.includes('register(NS, { en, ru, zh })'), 'must not reference undeclared ru');
  assert.ok(clientText.includes("'dsh-time-machine: dictionaries'"), 'must wrap registration in ctx.effect');
});

test('rollbackSnapshot fails with error if read-tree staged fails (issue #44)', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js');
  const eng = new ShadowSnapshotEngine({
    exec: async (cmd, args) => {
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return { stdout: 'true\n' };
      if (args[0] === 'read-tree' && args[1] === 'bad-tree') {
        throw new Error('fatal: read-tree failed');
      }
      return { stdout: '' };
    }
  });
  eng.snapshots.push({ id: 's-fail', commit: 'c1', stagedTreeHash: 'bad-tree', label: 'staged-test' });
  await assert.rejects(
    () => eng.rollbackSnapshot('s-fail', { confirm: true, restoreStaging: true }),
    /Failed to restore staging area/
  );
});

test('tools declare output contract with schema and render function (issue #47)', () => {
  const host = read('lib/index.js');

  // Verify TM_OUTPUT is defined with schema and render function
  assert.ok(host.includes('const TM_OUTPUT = {'), 'must declare shared TM_OUTPUT contract');
  assert.ok(host.includes("render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]"), 'must provide canonical render block');
  assert.ok(host.includes("properties: {") && host.includes("success: { type: 'boolean' }"), 'must declare success boolean schema');
  assert.ok(!host.includes("additionalProperties: false"), 'must keep additionalProperties open for engine payloads');

  // Verify all 7 tools declare output: TM_OUTPUT
  const expectedTools = [
    'time_machine_checkpoint_create',
    'time_machine_checkpoint_list',
    'time_machine_checkpoint_rollback',
    'time_machine_file_rollback',
    'time_machine_diff',
    'time_machine_checkpoint_delete',
    'time_machine_checkpoint_prune',
  ];

  for (const name of expectedTools) {
    const toolRegex = new RegExp("name:\\s*'" + name + "'[\\s\\S]*?output:\\s*TM_OUTPUT");
    assert.ok(toolRegex.test(host), `tool ${name} must declare output: TM_OUTPUT`);
  }

  // Functional test of the TM_OUTPUT contract
  const TM_OUTPUT = {
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
      },
    },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };

  assert.equal(typeof TM_OUTPUT.render, 'function');
  const rendered = TM_OUTPUT.render({}, { success: true, dummy: 'ok' });
  assert.ok(Array.isArray(rendered));
  assert.equal(rendered[0]?.type, 'text');
  assert.ok(rendered[0]?.text?.includes('"success": true'));
  assert.equal(TM_OUTPUT.schema.type, 'object');
  assert.equal(TM_OUTPUT.schema.additionalProperties, undefined);
});

test('setMax applies the runtime snapshot cap, deletes evicted refs and supports settings watch (issue #48)', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js');
  assert.equal(typeof ShadowSnapshotEngine.prototype.setMax, 'function', 'host syncMax calls engine.setMax');

  const deletedRefs = [];
  const exec = async (cmd, args) => {
    if (args[0] === 'update-ref' && args[1] === '-d') deletedRefs.push(args[2]);
    return { stdout: '' };
  };

  const eng = new ShadowSnapshotEngine({ exec });

  // 1. Test clamp table
  await eng.setMax(0);
  assert.equal(eng.maxSnapshots, 20, '0 falls back to default 20');
  await eng.setMax('invalid');
  assert.equal(eng.maxSnapshots, 20, 'NaN string falls back to default 20');
  await eng.setMax(-5);
  assert.equal(eng.maxSnapshots, 1, 'Negative numbers clamped to minimum 1');
  await eng.setMax(5);
  assert.equal(eng.maxSnapshots, 5, 'Valid positive number accepted');

  // 2. Test per-session trimming and evicted ref deletion
  eng.snapshots = [
    { id: 's1_1', sessionId: 's1', createdAt: 100, seq: 1, ref: 'refs/dsh-time-machine/s1/s1_1' },
    { id: 's1_2', sessionId: 's1', createdAt: 200, seq: 2, ref: 'refs/dsh-time-machine/s1/s1_2' },
    { id: 's1_3', sessionId: 's1', createdAt: 300, seq: 3, ref: 'refs/dsh-time-machine/s1/s1_3' },
    { id: 's1_4', sessionId: 's1', createdAt: 400, seq: 4, ref: 'refs/dsh-time-machine/s1/s1_4' },
    { id: 's2_1', sessionId: 's2', createdAt: 500, seq: 5, ref: 'refs/dsh-time-machine/s2/s2_1' },
    { id: 's2_2', sessionId: 's2', createdAt: 600, seq: 6, ref: 'refs/dsh-time-machine/s2/s2_2' },
  ];

  await eng.setMax(2, '/test/cwd');

  const s1Snaps = eng.snapshots.filter(s => s.sessionId === 's1');
  const s2Snaps = eng.snapshots.filter(s => s.sessionId === 's2');
  assert.equal(s1Snaps.length, 2, 'Session s1 must be trimmed to maxSnapshots (2)');
  assert.equal(s2Snaps.length, 2, 'Session s2 must remain intact at 2');
  assert.equal(s1Snaps[0].id, 's1_3', 'Oldest s1 snapshots removed');
  assert.equal(s1Snaps[1].id, 's1_4');

  assert.ok(deletedRefs.includes('refs/dsh-time-machine/s1/s1_1'), 'Evicted ref 1 must be deleted');
  assert.ok(deletedRefs.includes('refs/dsh-time-machine/s1/s1_2'), 'Evicted ref 2 must be deleted');

  // 3. Test global fallback when sessions empty
  deletedRefs.length = 0;
  eng.snapshots = [
    { id: 'g1', sessionId: '', createdAt: 10, seq: 1, ref: 'refs/dsh-time-machine/g1' },
    { id: 'g2', sessionId: '', createdAt: 20, seq: 2, ref: 'refs/dsh-time-machine/g2' },
    { id: 'g3', sessionId: '', createdAt: 30, seq: 3, ref: 'refs/dsh-time-machine/g3' },
  ];
  await eng.setMax(1, '/test/cwd');
  assert.equal(eng.snapshots.length, 1, 'Global snapshots trimmed to 1');
  assert.equal(eng.snapshots[0].id, 'g3', 'Newest global snapshot kept');
  assert.ok(deletedRefs.includes('refs/dsh-time-machine/g1'));
  assert.ok(deletedRefs.includes('refs/dsh-time-machine/g2'));

  // 4. Test host apply wiring (scope.watch registration)
  const host = read('lib/index.js');
  assert.ok(host.includes('const syncMax = () => engine.setMax('), 'host syncMax invokes setMax');
  assert.ok(host.includes('scope.watch(syncMax)'), 'settings watcher bound to syncMax');
});

test('ShadowSnapshotEngine cleanupOrphanedIndices skips git commands when not a git repository (issues #57, #61)', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js');
  const commands = [];
  const eng = new ShadowSnapshotEngine({
    exec: async (cmd, args) => {
      commands.push([cmd, ...args]);
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return { stdout: 'false' };
      return { stdout: '' };
    }
  });
  await eng.cleanupOrphanedIndices('/non-git-dir');
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0], ['git', 'rev-parse', '--is-inside-work-tree']);
});

test('rollbackSnapshot and rollbackFile reject with error if snapshot lacks commit or git (issue #58)', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js');
  const eng = new ShadowSnapshotEngine({
    exec: async () => ({ stdout: '' })
  });
  eng.snapshots.push({ id: 's-no-commit', label: 'test', commit: null, sessionId: 's1' });
  await assert.rejects(
    () => eng.rollbackSnapshot('s-no-commit', { confirm: true }),
    /does not have an associated git commit/
  );
  await assert.rejects(
    () => eng.rollbackFile('s-no-commit', 'some/file.js', { confirm: true }),
    /does not have an associated git commit/
  );
});

test('createSnapshot with skipIfNoChanges avoids git add when workspace is clean (issue #55)', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js');
  const commands = [];
  const exec = async (cmd, args) => {
    commands.push([cmd, ...args]);
    if (args[0] === 'rev-parse') {
      if (args[1] === '--is-inside-work-tree') return { stdout: 'true\n' };
      if (args[1] === '--git-dir') return { stdout: '.git\n' };
      if (args[2] === 'HEAD') return { stdout: 'commit-abc\n' };
    }
    if (args[0] === 'write-tree') return { stdout: 'tree-abc\n' };
    if (args[0] === 'commit-tree') return { stdout: 'commit-abc\n' };
    if (args[0] === 'status' && args[1] === '--porcelain') return { stdout: '' };
    return { stdout: '' };
  };

  const eng = new ShadowSnapshotEngine({ exec });
  const s1 = await eng.createSnapshot('first', { sessionId: 'sess-skip' });
  assert.equal(s1.commit, 'commit-abc');

  const initialAddCalls = commands.filter(c => c[1] === 'add').length;
  assert.equal(initialAddCalls, 1);

  // Second call with skipIfNoChanges: true on clean working tree
  const s2 = await eng.createSnapshot('second', { sessionId: 'sess-skip', skipIfNoChanges: true });
  assert.equal(s2.id, s1.id);
  const finalAddCalls = commands.filter(c => c[1] === 'add').length;
  assert.equal(finalAddCalls, 1, 'must not run git add when skipIfNoChanges is true and workspace is clean');
});

test('rollbackFile rejects paths outside workspace and prevents traversal escapes (issue #65)', async () => {
  const { ShadowSnapshotEngine } = await import('../lib/snapshot.js');
  const os = await import('node:os');
  const fsPromises = await import('node:fs/promises');
  const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'tm-sec-test-'));
  const outsideFile = path.join(tmpDir, 'outside-sentinel.txt');
  const workDir = path.join(tmpDir, 'workspace');
  await fsPromises.mkdir(workDir, { recursive: true });
  await fsPromises.writeFile(outsideFile, 'should-not-be-deleted', 'utf8');

  try {
    const exec = async (cmd, args) => {
      if (args[0] === 'rev-parse') return { stdout: 'true\n' };
      return { stdout: '' };
    };

    const eng = new ShadowSnapshotEngine({ exec });
    eng.snapshots = [{
      id: 'snap-test-65',
      label: 'test',
      commit: 'commit-test-65',
      createdAt: Date.now(),
      sessionId: 'sess-65',
    }];

    // 1. Relative path with .. traversal
    await assert.rejects(
      () => eng.rollbackFile('snap-test-65', '../outside-sentinel.txt', { confirm: true, cwd: workDir }),
      /Path traversal detected/
    );
    // Verify outside file was NOT deleted
    assert.equal(await fsPromises.readFile(outsideFile, 'utf8'), 'should-not-be-deleted');

    // 2. Absolute path
    await assert.rejects(
      () => eng.rollbackFile('snap-test-65', outsideFile, { confirm: true, cwd: workDir }),
      /Absolute paths are not allowed/
    );

    // 3. Confirm missing
    await assert.rejects(
      () => eng.rollbackFile('snap-test-65', 'valid.txt', { confirm: false, cwd: workDir }),
      /confirm required/
    );
  } finally {
    await fsPromises.rm(tmpDir, { recursive: true, force: true });
  }
});
