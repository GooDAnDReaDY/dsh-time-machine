import crypto from 'node:crypto';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

async function defaultExec(cmd, args, opts = {}) {
  try {
    const { stdout } = await execFile(cmd, args, { encoding: 'utf8', ...opts });
    return { stdout: String(stdout ?? ''), stderr: '' };
  } catch (e) {
    const err = e;
    err.stdout = String(err.stdout ?? '');
    err.stderr = String(err.stderr ?? err.message ?? '');
    throw err;
  }
}

// ponytail: in-memory engine, git shadow refs if repo present; O(n) scan, per-session trim
export class ShadowSnapshotEngine {
  constructor({ exec = defaultExec, maxSnapshots = 20, cwd } = {}) {
    this.exec = exec;
    this.maxSnapshots = maxSnapshots;
    this.cwd = cwd;
    this.snapshots = []; // {id, label, sessionId, createdAt, commit, ref}
    this.seq = 0;
  }

  _now() { return Date.now(); }

  _trimFor(sessionId) {
    if (!sessionId) {
      while (this.snapshots.length > this.maxSnapshots) this.snapshots.shift();
      return;
    }
    const perSession = this.snapshots.filter(s => s.sessionId === sessionId);
    while (perSession.length > this.maxSnapshots) {
      const oldest = perSession.shift();
      const idx = this.snapshots.indexOf(oldest);
      if (idx !== -1) this.snapshots.splice(idx, 1);
    }
  }

  async _isGitRepo() {
    try {
      await this.exec('git', ['rev-parse', '--is-inside-work-tree'], this.cwd ? { cwd: this.cwd } : {});
      return true;
    } catch { return false; }
  }

  // Restore checkpoint metadata from git shadow refs after a restart.
  // git is the durable store; memory is rebuilt from refs/dsh-time-machine/*.
  async loadFromRefs() {
    if (!(await this._isGitRepo())) return 0;
    let refs = [];
    try {
      const { stdout } = await this.exec(
        'git',
        ['for-each-ref', '--format=%(refname)%00%(objectname)', 'refs/dsh-time-machine/'],
        this.cwd ? { cwd: this.cwd } : {},
      );
      refs = String(stdout ?? '').trim().split('\n').filter(Boolean);
    } catch { return 0; }
    const restored = [];
    for (const line of refs) {
      const [ref, commit] = line.split('\0');
      if (!ref || !commit) continue;
      if (this.snapshots.some(s => s.ref === ref)) continue;
      let createdAt = 0;
      let label = ref.split('/').pop();
      try {
        const { stdout } = await this.exec(
          'git',
          ['log', '-1', '--format=%ct%00%s', ref],
          this.cwd ? { cwd: this.cwd } : {},
        );
        const [ct, msg] = String(stdout ?? '').split('\0');
        createdAt = Number(ct) * 1000 || 0;
        if (msg && String(msg).trim()) label = String(msg).trim();
      } catch {}
      const short = ref.replace(/^refs\/dsh-time-machine\//, '');
      const slash = short.indexOf('/');
      const sessionId = slash === -1 ? '' : short.slice(0, slash);
      const id = slash === -1 ? short : short.slice(slash + 1);
      restored.push({ id: id || short, label, sessionId, createdAt, commit, ref, seq: 0 });
    }
    // stable order: oldest first, tie-break by ref name
    restored.sort((a, b) => a.createdAt - b.createdAt || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
    for (const snap of restored) snap.seq = ++this.seq;
    this.snapshots.push(...restored);
    const sessions = [...new Set(this.snapshots.map(s => s.sessionId))];
    for (const sid of sessions) this._trimFor(sid);
    if (sessions.length === 0) while (this.snapshots.length > this.maxSnapshots) this.snapshots.shift();
    return restored.length;
  }

  async createSnapshot(label = '', { sessionId = '' } = {}) {
    const id = crypto.randomUUID().slice(0, 8);
    const createdAt = this._now();
    const safeLabel = String(label ?? '').trim() || `checkpoint-${id}`;
    const sid = String(sessionId || '').trim();
    let commit = null;
    let ref = null;
    const inGit = await this._isGitRepo();
    if (inGit) {
      try {
        await this.exec('git', ['add', '-A'], this.cwd ? { cwd: this.cwd } : {});
        const { stdout: tree } = await this.exec('git', ['write-tree'], this.cwd ? { cwd: this.cwd } : {});
        const treeHash = String(tree).trim();
        const { stdout: commitHash } = await this.exec('git', ['commit-tree', treeHash, '-m', safeLabel], this.cwd ? { cwd: this.cwd } : {});
        commit = String(commitHash).trim();
        ref = sid ? `refs/dsh-time-machine/${sid}/${id}` : `refs/dsh-time-machine/${id}`;
        await this.exec('git', ['update-ref', ref, commit], this.cwd ? { cwd: this.cwd } : {});
      } catch {
        commit = null;
        ref = null;
      }
    }
    const snap = { id, label: safeLabel, sessionId: sid, createdAt, commit, ref, seq: ++this.seq };
    this.snapshots.push(snap);
    this._trimFor(sid);
    return snap;
  }

  listSnapshots(sessionId) {
    const sid = sessionId != null ? String(sessionId).trim() : undefined;
    const list = sid !== undefined ? this.snapshots.filter(s => String(s.sessionId) === sid) : [...this.snapshots];
    return [...list].sort((a, b) => b.createdAt - a.createdAt || b.seq - a.seq);
  }

  getSnapshot(id) {
    return this.snapshots.find(s => s.id === id) || null;
  }

  async rollbackSnapshot(id, { confirm } = {}) {
    if (confirm !== true) {
      const err = new Error('confirm:true required to rollback');
      err.code = 'CONFIRM_REQUIRED';
      throw err;
    }
    const snap = this.getSnapshot(id);
    if (!snap) {
      const err = new Error(`snapshot ${id} not found`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    const inGit = await this._isGitRepo();
    if (inGit && snap.commit) {
      try {
        await this.exec('git', ['reset', '--hard', snap.commit], this.cwd ? { cwd: this.cwd } : {});
      } catch (e) {
        await this.exec('git', ['read-tree', snap.commit], this.cwd ? { cwd: this.cwd } : {}).catch(()=>{});
        await this.exec('git', ['checkout-index', '-a', '-f'], this.cwd ? { cwd: this.cwd } : {}).catch(()=>{});
      }
    }
    return { rolledBack: true, snapshot: snap };
  }

  async deleteSnapshot(id, { confirm } = {}) {
    if (confirm !== true) {
      const err = new Error('confirm:true required to delete');
      err.code = 'CONFIRM_REQUIRED';
      throw err;
    }
    const snap = this.getSnapshot(id);
    if (!snap) {
      const err = new Error(`snapshot ${id} not found`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (snap.ref) {
      try {
        await this.exec('git', ['update-ref', '-d', snap.ref], this.cwd ? { cwd: this.cwd } : {});
      } catch {}
    }
    const idx = this.snapshots.indexOf(snap);
    if (idx !== -1) this.snapshots.splice(idx, 1);
    return { deleted: true, snapshot: snap };
  }

  async pruneSnapshots(sessionId, keep = 3) {
    const sid = sessionId != null ? String(sessionId).trim() : undefined;
    const list = this.listSnapshots(sid); // newest first
    const minKeep = Math.max(0, Number(keep) || 3);
    const toRemove = list.slice(minKeep);
    const removed = [];
    for (const snap of toRemove) {
      try { await this.deleteSnapshot(snap.id, { confirm: true }); removed.push(snap.id); } catch {}
    }
    return { removed, kept: list.length - removed.length };
  }

  async diff(fromId, toId) {
    const from = this.getSnapshot(fromId);
    if (!from) {
      const err = new Error(`snapshot ${fromId} not found`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    let to = toId ? this.getSnapshot(toId) : null;
    const inGit = await this._isGitRepo();
    if (inGit && from.commit) {
      try {
        const range = to?.commit ? `${from.commit}..${to.commit}` : `${from.commit}..HEAD`;
        const { stdout } = await this.exec('git', ['diff', '--stat', range], this.cwd ? { cwd: this.cwd } : {});
        const diffStat = String(stdout ?? '').trim();
        if (diffStat) return { from: fromId, to: toId || 'HEAD', diff: diffStat };
      } catch {}
      try {
        const range = to?.commit ? `${from.commit}..${to.commit}` : from.commit;
        const { stdout } = await this.exec('git', ['diff', '--name-only', range], this.cwd ? { cwd: this.cwd } : {});
        return { from: fromId, to: toId || 'HEAD', diff: String(stdout ?? '').trim() || '(no changes)' };
      } catch {}
    }
    const toLabel = to ? to.label : 'current';
    return { from: fromId, to: toId || 'HEAD', diff: `diff ${from.label} -> ${toLabel} (no git repo)` };
  }

  setMax(n) {
    this.maxSnapshots = Math.max(1, Number(n) || 20);
    // trim all sessions
    const sessions = [...new Set(this.snapshots.map(s => s.sessionId))];
    for (const sid of sessions) this._trimFor(sid);
    if (sessions.length === 0) {
      while (this.snapshots.length > this.maxSnapshots) this.snapshots.shift();
    }
  }
}
