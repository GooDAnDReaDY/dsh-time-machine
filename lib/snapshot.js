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
    const snap = { id, label: safeLabel, sessionId: sid, createdAt, commit, ref };
    this.snapshots.push(snap);
    this._trimFor(sid);
    return snap;
  }

  listSnapshots(sessionId) {
    const sid = sessionId != null ? String(sessionId).trim() : undefined;
    const list = sid !== undefined ? this.snapshots.filter(s => String(s.sessionId) === sid) : [...this.snapshots];
    return [...list].sort((a, b) => b.createdAt - a.createdAt);
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
