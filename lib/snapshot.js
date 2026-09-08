import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

async function defaultExec(cmd, args, opts = {}) {
  try {
    const { stdout } = await execFile(cmd, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, ...opts });
    return { stdout: String(stdout ?? ''), stderr: '' };
  } catch (e) {
    const err = e;
    err.stdout = String(err.stdout ?? '');
    err.stderr = String(err.stderr ?? err.message ?? '');
    throw err;
  }
}

const MAX_DIFF_LENGTH = 256 * 1024; // 256 KB safety limit

// ponytail: in-memory engine, git shadow refs if repo present; O(n) scan, per-session trim
export class ShadowSnapshotEngine {
  constructor({ exec = defaultExec, maxSnapshots = 20, cwd } = {}) {
    this.exec = exec;
    this.maxSnapshots = maxSnapshots;
    this.cwd = cwd;
    this.snapshots = []; // {id, label, sessionId, createdAt, commit, ref, treeHash}
    this.seq = 0;
    this._queue = Promise.resolve();
  }

  _now() { return Date.now(); }

  _enqueue(operation) {
    const next = this._queue.then(() => operation(), () => operation());
    this._queue = next.catch(() => {});
    return next;
  }

  _resolveCwd(customCwd) {
    return customCwd || this.cwd || process.cwd();
  }

  async _hasGit(targetCwd) {
    try {
      const cwd = this._resolveCwd(targetCwd);
      const { stdout } = await this.exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  async cleanupOrphanedIndices(targetCwd) {
    const cwd = this._resolveCwd(targetCwd);
    try {
      const { stdout } = await this.exec('git', ['rev-parse', '--git-dir'], { cwd });
      const gitDir = stdout.trim();
      const resolvedGitDir = path.isAbsolute(gitDir) ? gitDir : path.resolve(cwd, gitDir);
      const files = await fs.readdir(resolvedGitDir).catch(() => []);
      for (const file of files) {
        if (file.startsWith('tm_index_')) {
          await fs.unlink(path.join(resolvedGitDir, file)).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[dsh-time-machine] cleanupOrphanedIndices warning:', e.message || e);
    }
  }

  async _trimFor(sessionId, targetCwd) {
    const cwd = this._resolveCwd(targetCwd);
    if (!sessionId) {
      while (this.snapshots.length > this.maxSnapshots) {
        const oldest = this.snapshots.shift();
        if (oldest?.ref) {
          try {
            await this.exec('git', ['update-ref', '-d', oldest.ref], { cwd });
          } catch (e) {
            console.warn('[dsh-time-machine] failed to delete evicted ref:', oldest.ref, e.message || e);
          }
        }
      }
      return;
    }
    const sessionSnaps = this.snapshots.filter(s => s.sessionId === sessionId);
    const toRemoveCount = sessionSnaps.length - this.maxSnapshots;
    if (toRemoveCount > 0) {
      const toRemove = sessionSnaps.slice(0, toRemoveCount);
      const removeIds = new Set(toRemove.map(s => s.id));
      for (const snap of toRemove) {
        if (snap.ref) {
          try {
            await this.exec('git', ['update-ref', '-d', snap.ref], { cwd });
          } catch (e) {
            console.warn('[dsh-time-machine] failed to delete session ref:', snap.ref, e.message || e);
          }
        }
      }
      this.snapshots = this.snapshots.filter(s => !removeIds.has(s.id));
    }
  }

  createSnapshot(label, { sessionId = '', cwd: customCwd } = {}) {
    return this._enqueue(() => this._doCreateSnapshot(label, { sessionId, cwd: customCwd }));
  }

  async _doCreateSnapshot(label, { sessionId = '', cwd: customCwd } = {}) {
    const cwd = this._resolveCwd(customCwd);
    const id = `snap-${this._now()}-${crypto.randomBytes(3).toString('hex')}`;
    const cleanLabel = String(label || 'checkpoint').slice(0, 100);
    const cleanSession = String(sessionId || '').trim();
    let commit = null;
    let ref = null;
    let treeHash = null;

    if (await this._hasGit(cwd)) {
      const gitDirRes = await this.exec('git', ['rev-parse', '--git-dir'], { cwd });
      const gitDir = gitDirRes.stdout.trim();
      const resolvedGitDir = path.isAbsolute(gitDir) ? gitDir : path.resolve(cwd, gitDir);
      const tempIndexFile = path.join(resolvedGitDir, `tm_index_${crypto.randomBytes(4).toString('hex')}`);

      const gitEnv = {
        ...process.env,
        GIT_INDEX_FILE: tempIndexFile,
        GIT_AUTHOR_NAME: 'DSH Time Machine',
        GIT_AUTHOR_EMAIL: 'time-machine@deepseek.local',
        GIT_COMMITTER_NAME: 'DSH Time Machine',
        GIT_COMMITTER_EMAIL: 'time-machine@deepseek.local',
      };

      try {
        await this.exec('git', ['add', '-A'], { cwd, env: gitEnv });
        const treeRes = await this.exec('git', ['write-tree'], { cwd, env: gitEnv });
        treeHash = treeRes.stdout.trim();

        // Check if identical to last snapshot for this session to avoid redundant commits
        const lastSnap = this.snapshots.filter(s => s.sessionId === cleanSession).slice(-1)[0];
        if (lastSnap && lastSnap.treeHash && lastSnap.treeHash === treeHash) {
          return lastSnap;
        }

        const headCommitRes = await this.exec('git', ['rev-parse', '--verify', 'HEAD'], { cwd }).catch(() => ({ stdout: '' }));
        const headCommit = headCommitRes.stdout.trim();

        const commitArgs = ['commit-tree', treeHash, '-m', `[dsh-time-machine] ${cleanLabel}`];
        if (headCommit) {
          commitArgs.push('-p', headCommit);
        }
        const commitRes = await this.exec('git', commitArgs, { cwd, env: gitEnv });
        commit = commitRes.stdout.trim();

        const refPath = cleanSession
          ? `refs/dsh-time-machine/${cleanSession}/${id}`
          : `refs/dsh-time-machine/${id}`;
        await this.exec('git', ['update-ref', refPath, commit], { cwd });
        ref = refPath;
      } catch (e) {
        console.warn('[dsh-time-machine] git snapshot creation failed, falling back to memory record:', e.message || e);
      } finally {
        await fs.unlink(tempIndexFile).catch(() => {});
      }
    }

    const snap = {
      id,
      label: cleanLabel,
      sessionId: cleanSession,
      createdAt: this._now(),
      commit,
      ref,
      treeHash,
      seq: ++this.seq,
    };
    this.snapshots.push(snap);
    await this._trimFor(cleanSession, cwd);
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

  deleteSnapshot(id, { confirm = false, cwd: customCwd } = {}) {
    return this._enqueue(async () => {
      if (!confirm) throw new Error('confirm required to delete snapshot');
      const idx = this.snapshots.findIndex(s => s.id === id);
      if (idx === -1) throw new Error(`Snapshot not found: ${id}`);
      const snap = this.snapshots[idx];
      const cwd = this._resolveCwd(customCwd);
      if (snap.ref && await this._hasGit(cwd)) {
        try {
          await this.exec('git', ['update-ref', '-d', snap.ref], { cwd });
        } catch (e) {
          console.warn('[dsh-time-machine] failed to delete ref on deleteSnapshot:', snap.ref, e.message || e);
        }
      }
      this.snapshots.splice(idx, 1);
      return { deleted: true, id };
    });
  }

  pruneSnapshots(sessionId = '', keep = 3, { cwd: customCwd } = {}) {
    return this._enqueue(async () => {
      const sid = sessionId != null ? String(sessionId).trim() : '';
      const list = this.listSnapshots(sid); // newest first
      const minKeep = Math.max(0, Number.isFinite(Number(keep)) ? Number(keep) : 3);
      const toRemove = list.slice(minKeep);
      const removed = [];
      const cwd = this._resolveCwd(customCwd);
      for (const snap of toRemove) {
        const idx = this.snapshots.findIndex(s => s.id === snap.id);
        if (idx !== -1) {
          if (snap.ref && await this._hasGit(cwd)) {
            try {
              await this.exec('git', ['update-ref', '-d', snap.ref], { cwd });
            } catch (e) {
              console.warn('[dsh-time-machine] failed to delete ref on pruneSnapshots:', snap.ref, e.message || e);
            }
          }
          this.snapshots.splice(idx, 1);
          removed.push(snap.id);
        }
      }
      return { removed, kept: list.length - removed.length };
    });
  }

  rollbackSnapshot(id, { confirm = false, cwd: customCwd } = {}) {
    return this._enqueue(() => this._doRollbackSnapshot(id, { confirm, cwd: customCwd }));
  }

  async _doRollbackSnapshot(id, { confirm = false, cwd: customCwd } = {}) {
    if (!confirm) throw new Error('confirm required for rollback');
    const snap = this.getSnapshot(id);
    if (!snap) throw new Error(`Snapshot not found: ${id}`);
    const cwd = this._resolveCwd(customCwd);
    if (snap.commit && await this._hasGit(cwd)) {
      try {
        await this.exec('git', ['read-tree', snap.commit], { cwd });
        await this.exec('git', ['checkout-index', '-a', '-f'], { cwd });
        await this.exec('git', ['clean', '-fd'], { cwd });
      } catch (e) {
        console.warn('[dsh-time-machine] rollback error:', e.message || e);
        throw new Error(`Rollback execution failed: ${e.message || e}`);
      }
    }
    return { rolledBack: true, id, commit: snap.commit };
  }

  async diff(fromId, toId = undefined, { cwd: customCwd, format = 'patch' } = {}) {
    const snapFrom = this.getSnapshot(fromId);
    if (!snapFrom) throw new Error(`Snapshot not found: ${fromId}`);
    const snapTo = toId ? this.getSnapshot(toId) : null;
    if (toId && !snapTo) throw new Error(`Target snapshot not found: ${toId}`);

    const cwd = this._resolveCwd(customCwd);
    if (!(await this._hasGit(cwd)) || !snapFrom.commit) {
      const toLabel = snapTo ? snapTo.label : "current";
      return { from: fromId, to: toId || "HEAD", diff: `diff ${snapFrom.label} -> ${toLabel} (no git repo)`, format };
    }

    try {
      const fromRef = snapFrom.commit || snapFrom.ref;
      let diffArgs = ['diff'];
      if (format === 'stat') {
        diffArgs.push('--stat');
      }

      if (snapTo) {
        const toRef = snapTo.commit || snapTo.ref;
        diffArgs.push(fromRef, toRef);
      } else {
        diffArgs.push(fromRef);
      }

      const { stdout } = await this.exec('git', diffArgs, { cwd });
      let diffOutput = stdout;
      let truncated = false;
      if (diffOutput.length > MAX_DIFF_LENGTH) {
        diffOutput = diffOutput.slice(0, MAX_DIFF_LENGTH) + '\n\n... [diff truncated: output exceeded limit]';
        truncated = true;
      }
      return { diff: diffOutput, from: fromId, to: toId || 'HEAD', format, truncated };
    } catch (e) {
      console.warn('[dsh-time-machine] diff computation error:', e.message || e);
      return { diff: `[diff error: ${e.message || e}]`, from: fromId, to: toId || 'HEAD', format };
    }
  }

  async loadFromRefs(targetCwd) {
    const cwd = this._resolveCwd(targetCwd);
    if (!(await this._hasGit(cwd))) return 0;
    let refs = [];
    try {
      // Support both single-batch with committerdate/subject and basic for-each-ref
      const { stdout } = await this.exec('git', [
        'for-each-ref',
        '--format=%(refname)%00%(objectname)%00%(committerdate:raw)%00%(contents:subject)',
        'refs/dsh-time-machine'
      ], { cwd });
      refs = String(stdout ?? '').trim().split('\n').filter(Boolean);
    } catch {
      return 0;
    }

    let restoredCount = 0;
    for (const line of refs) {
      const parts = line.split('\0');
      const ref = parts[0]?.trim();
      const commit = parts[1]?.trim();
      if (!ref || !commit) continue;
      if (this.snapshots.some(s => s.ref === ref)) continue;

      let createdAt = 0;
      let label = ref.split('/').pop();

      // If parts has date and subject from single-batch
      if (parts.length >= 4 && parts[2] && parts[3] !== undefined) {
        const timestampSeconds = parseInt(parts[2].split(' ')[0], 10);
        if (!isNaN(timestampSeconds)) createdAt = timestampSeconds * 1000;
        const sub = parts[3].trim().replace(/^\[dsh-time-machine\]\s*/, '');
        if (sub) label = sub;
      } else {
        // Fallback for tests or git versions returning minimal for-each-ref
        try {
          const { stdout } = await this.exec('git', ['log', '-1', '--format=%ct%00%s', ref], { cwd });
          const [ct, msg] = String(stdout ?? '').split('\0');
          createdAt = Number(ct) * 1000 || 0;
          if (msg && String(msg).trim()) label = String(msg).trim();
        } catch {}
      }

      const short = ref.replace(/^refs\/dsh-time-machine\//, '');
      const slash = short.indexOf('/');
      const sessionId = slash === -1 ? '' : short.slice(0, slash);
      const id = slash === -1 ? short : short.slice(slash + 1);

      this.snapshots.push({
        id: id || short,
        label,
        sessionId,
        createdAt,
        commit,
        ref,
        seq: ++this.seq,
      });
      restoredCount++;
    }

    this.snapshots.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.seq - b.seq);
    const sessions = [...new Set(this.snapshots.map(s => s.sessionId))];
    for (const sid of sessions) await this._trimFor(sid, cwd);
    if (sessions.length === 0) await this._trimFor('', cwd);
    return restoredCount;
  }
}