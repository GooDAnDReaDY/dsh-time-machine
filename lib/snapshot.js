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

// ponytail: in-memory engine, git shadow refs if repo present; O(n) scan, global lock
export class ShadowSnapshotEngine {
  constructor({ exec = defaultExec, maxSnapshots = 20, cwd } = {}) {
    this.exec = exec;
    this.maxSnapshots = maxSnapshots;
    this.cwd = cwd;
    this.snapshots = []; // newest last, list returns newest first
  }

  _now() { return Date.now(); }

  _trim() {
    while (this.snapshots.length > this.maxSnapshots) this.snapshots.shift();
  }

  async _isGitRepo() {
    try {
      await this.exec('git', ['rev-parse', '--is-inside-work-tree'], this.cwd ? { cwd: this.cwd } : {});
      return true;
    } catch { return false; }
  }

  async createSnapshot(label = '') {
    const id = crypto.randomUUID().slice(0, 8);
    const createdAt = this._now();
    const safeLabel = String(label ?? '').trim() || `checkpoint-${id}`;
    let commit = null;
    let ref = null;
    const inGit = await this._isGitRepo();
    if (inGit) {
      try {
        // stage working tree without committing to main branch
        await this.exec('git', ['add', '-A'], this.cwd ? { cwd: this.cwd } : {});
        const { stdout: tree } = await this.exec('git', ['write-tree'], this.cwd ? { cwd: this.cwd } : {});
        const treeHash = String(tree).trim();
        const { stdout: commitHash } = await this.exec('git', ['commit-tree', treeHash, '-m', safeLabel], this.cwd ? { cwd: this.cwd } : {});
        commit = String(commitHash).trim();
        ref = `refs/dsh-time-machine/${id}`;
        await this.exec('git', ['update-ref', ref, commit], this.cwd ? { cwd: this.cwd } : {});
      } catch {
        commit = null;
        ref = null;
      }
    }
    const snap = { id, label: safeLabel, createdAt, commit, ref };
    this.snapshots.push(snap);
    this._trim();
    return snap;
  }

  listSnapshots() {
    return [...this.snapshots].sort((a, b) => b.createdAt - a.createdAt);
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
        // fallback to checkout of commit tree
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
    // if to not given, diff against current HEAD/working tree
    const inGit = await this._isGitRepo();
    if (inGit && from.commit) {
      try {
        const range = to?.commit ? `${from.commit}..${to.commit}` : `${from.commit}..HEAD`;
        const { stdout } = await this.exec('git', ['diff', '--stat', range], this.cwd ? { cwd: this.cwd } : {});
        const diffStat = String(stdout ?? '').trim();
        if (diffStat) return { from: fromId, to: toId || 'HEAD', diff: diffStat };
      } catch {}
      // fallback to name-only
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
    this._trim();
  }
}
