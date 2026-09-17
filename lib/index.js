import { registerPluginUpdater } from './updater.js';
import Schema from '@deepseek-ai/schemastery';
import { ShadowSnapshotEngine } from './snapshot.js';
import { writeJson, readBody, isTrustedSettingsRequest } from './http.js';

export const name = '@goodandready/dsh-time-machine';
export const inject = ['tools', 'settings', 'webServer'];

export const Config = Schema.object({
  autoSnapshotEnabled: Schema.boolean().default(true).description('Take automatic checkpoints before file changes'),
  maxSnapshots: Schema.number().default(20).description('Maximum snapshots in session history'),
  autoHealPrompt: Schema.boolean().default(true).description('Prompt recovery on command failure'),
});

const NS = '@goodandready/dsh-time-machine';

function cwdOf(execution, ctx) {
  try {
    if (execution?.cwd) return String(execution.cwd);
    if (execution?.session?.workspace?.cwd) return String(execution.session.workspace.cwd);
    if (execution?.session?.cwd) return String(execution.session.cwd);
    if (ctx?.workspace?.cwd) return String(ctx.workspace.cwd);
    if (typeof ctx?.get === 'function') {
      const ws = ctx.get('workspace');
      if (ws?.cwd) return String(ws.cwd);
    }
  } catch (err) {
    // best-effort workspace resolution
  }
  return undefined;
}

function sessionIdOf(execution, ctx) {
  try {
    if (execution?.sessionId) return String(execution.sessionId);
    if (execution?.session?.id) return String(execution.session.id);
    if (execution?.data?.sessionId) return String(execution.data.sessionId);
    if (ctx?.session?.id) return String(ctx.session.id);
  } catch (err) {
    // best-effort session ID extraction
  }
  return '';
}

export function apply(ctx, config) {
  let getConfig = () => config;
  const initialCwd = cwdOf(null, ctx);
  let engine = new ShadowSnapshotEngine({ maxSnapshots: config?.maxSnapshots ?? 20, cwd: initialCwd });
  engine.loadFromRefs({ cwd: initialCwd }).catch(() => {});
  engine.cleanupOrphanedIndices({ cwd: initialCwd }).catch(() => {});

  ctx.inject(['settings'], (sctx) => {
    const scope = sctx.settings.register(NS, Config, { base: config });
    getConfig = () => scope.get() ?? config;
    const syncMax = () => engine.setMax(getConfig().maxSnapshots ?? 20, cwdOf(null, ctx));
    syncMax();
    const stop = scope.watch ? scope.watch(syncMax) : () => {};
    sctx.effect(() => () => { try { stop(); } catch (err) { /* ignore cleanup error */ } }, 'dsh-time-machine: settings watch');
  });

  // auto-snapshot on turn/start and approval/asked (session-scoped)
  const autoSnap = async (label, sessId, customCwd) => {
    if (!getConfig().autoSnapshotEnabled) return;
    try {
      const sid = String(sessId || '').trim();
      const targetCwd = customCwd || cwdOf(null, ctx);
      await engine.createSnapshot(label, { sessionId: sid, cwd: targetCwd, skipIfNoChanges: true });
    } catch (err) {
      console.warn('[dsh-time-machine] auto-snapshot failed:', err.message || err);
    }
  };

  // 1. Native DSH session/event bus (Cordis standard in DSH)
  // When native session/event bus is present, use it exclusively to prevent double-fire.
  const hasNativeEvents = typeof ctx.on === 'function';

  if (hasNativeEvents) {
    ctx.effect(() => {
      const off = ctx.on('session/event', (session, event) => {
        const sid = (session && session.id) || sessionIdOf(event, ctx);
        const sessionCwd = session?.workspace?.cwd || session?.cwd || cwdOf(event, ctx);
        const type = event && event.type;
        if (type === 'turn/start') {
          const turnId = event.turnId || event.data?.turnId || Date.now();
          autoSnap(`auto:turn:${turnId}`, sid, sessionCwd);
        } else if (type === 'approval/asked') {
          const tool = event.tool || event.data?.toolName || event.data?.tool || 'approval';
          autoSnap(`auto:approval:${tool}`, sid, sessionCwd);
        } else if (type === 'tool/before_execute' || type === 'tool/execute' || type === 'tool/call') {
          const tool = String(event.tool || event.data?.toolName || event.name || event.data?.name || '');
          const risky = ['execute_command', 'bash', 'apply_patch', 'edit_file', 'write_file', 'delete_file'];
          if (risky.some(r => tool.toLowerCase().includes(r))) {
            autoSnap(`auto:pre-tool:${tool || 'tool'}`, sid, sessionCwd);
          }
        } else if (type === 'turn/end') {
          if (!getConfig().autoSnapshotEnabled) return;
          const outcome = String((event && (event.outcome || event.data?.outcome || event.result?.outcome || event.result?.status)) || '');
          if (!sid) return;
          if (outcome === 'success' || outcome === 'ok' || outcome === 'done') {
            engine.pruneSnapshots(sid, 3, { cwd: sessionCwd }).catch(() => {});
          }
        } else if (type === 'tool/error' || type === 'command/error') {
          if (getConfig().autoHealPrompt) {
            const tool = event.tool || event.data?.toolName || 'command';
            autoSnap(`auto:error:${tool}`, sid, sessionCwd);
          }
        }
      });
      return () => { try { typeof off === 'function' && off(); } catch (err) { /* ignore unbind */ } };
    }, 'dsh-time-machine: native session events');
  } else {
    // 2. Legacy/mock events bus fallback (for unit tests and non-standard environments without ctx.on)
    try {
      if (ctx.events && typeof ctx.events.on === 'function') {
        ctx.effect(() => {
          const offs = [];
          try {
            offs.push(ctx.events.on('turn/start', (ev) => {
              const sid = sessionIdOf(ev, ctx);
              autoSnap(`auto:turn:${ev?.turnId || Date.now()}`, sid);
            }));
          } catch (err) { /* ignore event hook error */ }
          try {
            offs.push(ctx.events.on('approval/asked', (ev) => {
              const sid = sessionIdOf(ev, ctx);
              const tool = ev?.tool || ev?.name || 'approval';
              autoSnap(`auto:approval:${tool}`, sid);
            }));
          } catch (err) { /* ignore event hook error */ }
          try {
            offs.push(ctx.events.on('tool/call', (ev) => {
              const sid = sessionIdOf(ev, ctx);
              const tool = String(ev?.tool || ev?.name || '');
              const risky = ['execute_command', 'bash', 'apply_patch', 'edit_file', 'write_file', 'delete_file'];
              if (risky.some(r => tool.toLowerCase().includes(r))) {
                autoSnap(`auto:pre-tool:${tool || 'tool'}`, sid);
              }
            }));
          } catch (err) { /* ignore event hook error */ }
          try {
            offs.push(ctx.events.on('turn/end', (ev) => {
              if (!getConfig().autoSnapshotEnabled) return;
              const outcome = String((ev && (ev.outcome || ev.result?.outcome || ev.result?.status)) || '');
              const sid = sessionIdOf(ev, ctx);
              if (!sid) return;
              if (outcome === 'success' || outcome === 'ok' || outcome === 'done') {
                engine.pruneSnapshots(sid, 3).catch(() => {});
              }
            }));
          } catch (err) { /* ignore event hook error */ }
          try {
            offs.push(ctx.events.on('tool/error', (ev) => {
              if (getConfig().autoHealPrompt) {
                const sid = sessionIdOf(ev, ctx);
                const tool = ev?.tool || ev?.name || 'command';
                autoSnap(`auto:error:${tool}`, sid);
              }
            }));
          } catch (err) { /* ignore event hook error */ }
          try {
            offs.push(ctx.events.on('command/error', (ev) => {
              if (getConfig().autoHealPrompt) {
                const sid = sessionIdOf(ev, ctx);
                const tool = ev?.tool || ev?.name || 'command';
                autoSnap(`auto:error:${tool}`, sid);
              }
            }));
          } catch (err) { /* ignore event hook error */ }
          return () => { for (const off of offs) try { typeof off === 'function' && off(); } catch (err) { /* ignore */ } };
        }, 'dsh-time-machine: auto snapshot events fallback');
      }
    } catch (err) { /* fallback events unavailable */ }
  }

  // tools (session-aware and cwd-aware)
  const TM_OUTPUT = {
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
      },
    },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };

  const registerTools = (tctx) => {
    tctx.tools.register({
      name: 'time_machine_checkpoint_create',
      output: TM_OUTPUT,
      description: 'Create a workspace checkpoint (shadow git snapshot) before risky changes. Returns id and label. Auto-creates per session if autoSnapshotEnabled.',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Human label for checkpoint' },
          sessionId: { type: 'string', description: 'Session id to scope checkpoint (auto-detected if omitted)' },
          cwd: { type: 'string', description: 'Target workspace directory (auto-detected if omitted)' },
        },
      },
      execute: async (args = {}, execution) => {
        const sid = String(args.sessionId || sessionIdOf(execution, tctx) || '').trim();
        const targetCwd = args.cwd ? String(args.cwd) : cwdOf(execution, tctx);
        const snap = await engine.createSnapshot(args.label, { sessionId: sid, cwd: targetCwd });
        return { success: true, snapshot: snap };
      },
    });

    tctx.tools.register({
      name: 'time_machine_checkpoint_list',
      output: TM_OUTPUT,
      description: 'List recent workspace checkpoints newest first. Filter by sessionId if given.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Filter by session id' },
        },
      },
      execute: async (args = {}, execution) => {
        const sid = args.sessionId != null ? String(args.sessionId).trim() : (sessionIdOf(execution, tctx) ? String(sessionIdOf(execution, tctx)).trim() : undefined);
        const finalList = (args.sessionId == null && sid !== undefined && sid !== '') ? engine.listSnapshots(sid) : (args.sessionId != null ? engine.listSnapshots(String(args.sessionId)) : engine.listSnapshots());
        return { success: true, snapshots: finalList, sessionId: sid || '' };
      },
    });

    tctx.tools.register({
      name: 'time_machine_checkpoint_rollback',
      output: TM_OUTPUT,
      description: 'Rollback workspace to a checkpoint. Requires confirm:true.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Snapshot id to rollback to' },
          confirm: { type: 'boolean', description: 'Must be true to confirm destructive rollback' },
          cwd: { type: 'string', description: 'Target workspace directory' },
        },
        required: ['id', 'confirm'],
      },
      execute: async ({ id, confirm, cwd } = {}, execution) => {
        const targetCwd = cwd ? String(cwd) : cwdOf(execution, tctx);
        const res = await engine.rollbackSnapshot(String(id ?? ''), { confirm, cwd: targetCwd });
        return { success: true, ...res };
      },
    });

    tctx.tools.register({
      name: 'time_machine_file_rollback',
      output: TM_OUTPUT,
      description: 'Restore a specific file from a checkpoint without resetting the entire workspace. Requires confirm:true.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Snapshot id to restore file from' },
          filePath: { type: 'string', description: 'Relative path of the file to restore' },
          confirm: { type: 'boolean', description: 'Must be true to confirm restoration' },
          cwd: { type: 'string', description: 'Target workspace directory' },
        },
        required: ['id', 'filePath', 'confirm'],
      },
      execute: async ({ id, filePath, confirm, cwd } = {}, execution) => {
        const targetCwd = cwd ? String(cwd) : cwdOf(execution, tctx);
        const res = await engine.rollbackFile(String(id ?? ''), String(filePath ?? ''), { confirm, cwd: targetCwd });
        return { success: true, ...res };
      },
    });

    tctx.tools.register({
      name: 'time_machine_diff',
      output: TM_OUTPUT,
      description: 'Show unified diff or stat between checkpoint and current or another checkpoint.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Source snapshot id' },
          to: { type: 'string', description: 'Target snapshot id (default HEAD)' },
          format: { type: 'string', enum: ['patch', 'stat'], description: 'Format of diff: patch (unified diff) or stat (summary)' },
          cwd: { type: 'string', description: 'Target workspace directory' },
        },
        required: ['from'],
      },
      execute: async ({ from, to, format, cwd } = {}, execution) => {
        const targetCwd = cwd ? String(cwd) : cwdOf(execution, tctx);
        const res = await engine.diff(String(from ?? ''), to ? String(to) : undefined, {
          cwd: targetCwd,
          format: format === 'stat' ? 'stat' : 'patch',
        });
        return { success: true, ...res };
      },
    });

    tctx.tools.register({
      name: 'time_machine_checkpoint_delete',
      output: TM_OUTPUT,
      description: 'Delete a single checkpoint. Requires confirm:true.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Snapshot id to delete' },
          confirm: { type: 'boolean', description: 'Must be true to confirm deletion' },
          cwd: { type: 'string', description: 'Target workspace directory' },
        },
        required: ['id', 'confirm'],
      },
      execute: async ({ id, confirm, cwd } = {}, execution) => {
        const targetCwd = cwd ? String(cwd) : cwdOf(execution, tctx);
        const res = await engine.deleteSnapshot(String(id ?? ''), { confirm, cwd: targetCwd });
        return { success: true, ...res };
      },
    });

    tctx.tools.register({
      name: 'time_machine_checkpoint_prune',
      output: TM_OUTPUT,
      description: 'Prune session checkpoints, keeping only the newest N (default 3).',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session id to prune (default current session)' },
          keep: { type: 'number', description: 'How many newest checkpoints to keep (default 3)' },
          cwd: { type: 'string', description: 'Target workspace directory' },
        },
      },
      execute: async (args = {}, execution) => {
        const sid = String(args.sessionId || sessionIdOf(execution, tctx) || '').trim();
        const targetCwd = args.cwd ? String(args.cwd) : cwdOf(execution, tctx);
        const out = await engine.pruneSnapshots(sid, args.keep, { cwd: targetCwd });
        return { success: true, sessionId: sid, ...out };
      },
    });
  };

  try {
    if (ctx.tools) registerTools(ctx);
    else ctx.inject(['tools'], (tctx) => registerTools(tctx));
  } catch (err) {
    console.warn('[dsh-time-machine] tools service injection failed:', err.message || err);
  }

  // web routes for UI (session-aware via ?sessionId= and ?format=, CSRF-protected)
  ctx.effect(() => {
    const disposals = [];
    try {
      disposals.push(ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-time-machine/snapshots',
        handler: (req, res) => {
          if (req.method !== 'GET') {
            writeJson(res, 405, { success: false, error: 'Method Not Allowed. GET required.' });
            return;
          }
          const url = new URL(req.url, 'http://localhost');
          const sid = url.searchParams.get('sessionId');
          const list = sid != null ? engine.listSnapshots(String(sid)) : engine.listSnapshots();
          writeJson(res, 200, { success: true, snapshots: list });
        },
      }));

      disposals.push(ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-time-machine/diff',
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            writeJson(res, 405, { success: false, error: 'Method Not Allowed. GET required.' });
            return;
          }
          const url = new URL(req.url, 'http://localhost');
          const from = url.searchParams.get('from') || '';
          const to = url.searchParams.get('to') || undefined;
          const format = url.searchParams.get('format') || 'patch';
          try {
            const out = await engine.diff(String(from), to ? String(to) : undefined, {
              cwd: cwdOf(null, ctx),
              format: format === 'stat' ? 'stat' : 'patch',
            });
            writeJson(res, 200, { success: true, ...out });
          } catch (e) {
            writeJson(res, 400, { success: false, error: String(e.message || e) });
          }
        },
      }));

      disposals.push(ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-time-machine/create',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            writeJson(res, 405, { success: false, error: 'Method Not Allowed. POST required.' });
            return;
          }
          if (!isTrustedSettingsRequest(req)) {
            writeJson(res, 403, { success: false, error: 'cross-site requests forbidden' });
            return;
          }
          try {
            const parsed = await readBody(req);
            const sid = String(parsed.sessionId || new URL(req.url, 'http://localhost').searchParams.get('sessionId') || '').trim();
            const targetCwd = parsed.cwd ? String(parsed.cwd) : cwdOf(null, ctx);
            const snap = await engine.createSnapshot(parsed.label, { sessionId: sid, cwd: targetCwd });
            writeJson(res, 200, { success: true, snapshot: snap });
          } catch (e) {
            const status = e.statusCode || 400;
            writeJson(res, status, { success: false, error: String(e.message || e) });
          }
        },
      }));

      disposals.push(ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-time-machine/delete',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            writeJson(res, 405, { success: false, error: 'Method Not Allowed. POST required.' });
            return;
          }
          if (!isTrustedSettingsRequest(req)) {
            writeJson(res, 403, { success: false, error: 'cross-site requests forbidden' });
            return;
          }
          try {
            const parsed = await readBody(req);
            const targetCwd = parsed.cwd ? String(parsed.cwd) : cwdOf(null, ctx);
            const out = await engine.deleteSnapshot(String(parsed.id || ''), { confirm: parsed.confirm, cwd: targetCwd });
            writeJson(res, 200, { success: true, ...out });
          } catch (e) {
            const status = e.statusCode || 400;
            writeJson(res, status, { success: false, error: String(e.message || e), code: e.code || '' });
          }
        },
      }));

      disposals.push(ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-time-machine/prune',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            writeJson(res, 405, { success: false, error: 'Method Not Allowed. POST required.' });
            return;
          }
          if (!isTrustedSettingsRequest(req)) {
            writeJson(res, 403, { success: false, error: 'cross-site requests forbidden' });
            return;
          }
          try {
            const parsed = await readBody(req);
            const sid = String(parsed.sessionId || new URL(req.url, 'http://localhost').searchParams.get('sessionId') || '');
            const targetCwd = parsed.cwd ? String(parsed.cwd) : cwdOf(null, ctx);
            const out = await engine.pruneSnapshots(sid, parsed.keep, { cwd: targetCwd });
            writeJson(res, 200, { success: true, sessionId: sid, ...out });
          } catch (e) {
            const status = e.statusCode || 400;
            writeJson(res, status, { success: false, error: String(e.message || e) });
          }
        },
      }));

      disposals.push(ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-time-machine/rollback',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            writeJson(res, 405, { success: false, error: 'Method Not Allowed. POST required.' });
            return;
          }
          if (!isTrustedSettingsRequest(req)) {
            writeJson(res, 403, { success: false, error: 'cross-site requests forbidden' });
            return;
          }
          try {
            const parsed = await readBody(req);
            const targetCwd = parsed.cwd ? String(parsed.cwd) : cwdOf(null, ctx);
            const out = await engine.rollbackSnapshot(String(parsed.id || ''), { confirm: parsed.confirm, cwd: targetCwd });
            writeJson(res, 200, { success: true, ...out });
          } catch (e) {
            const status = e.statusCode || 400;
            writeJson(res, status, { success: false, error: String(e.message || e), code: e.code || '' });
          }
        },
      }));

      disposals.push(ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-time-machine/rollback-file',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            writeJson(res, 405, { success: false, error: 'Method Not Allowed. POST required.' });
            return;
          }
          if (!isTrustedSettingsRequest(req)) {
            writeJson(res, 403, { success: false, error: 'cross-site requests forbidden' });
            return;
          }
          try {
            const parsed = await readBody(req);
            const targetCwd = parsed.cwd ? String(parsed.cwd) : cwdOf(null, ctx);
            const out = await engine.rollbackFile(String(parsed.id || ''), String(parsed.filePath || ''), { confirm: parsed.confirm, cwd: targetCwd });
            writeJson(res, 200, { success: true, ...out });
          } catch (e) {
            const status = e.statusCode || 400;
            writeJson(res, status, { success: false, error: String(e.message || e) });
          }
        },
      }));
    } catch (err) {
      console.warn('[dsh-time-machine] web routes registration failed:', err.message || err);
    }
    return () => { for (const d of disposals) try { typeof d === 'function' && d(); } catch (err) { /* ignore route cleanup */ } };
  }, 'dsh-time-machine: web routes');

  
  // One-click plugin updater route per DSH standard
  ctx.effect(() => {
    return registerPluginUpdater(ctx, {
      endpoint: '/api/dsh-time-machine/update',
      packageName: '@goodandready/dsh-time-machine',
      manifestUrl: new URL('../package.json', import.meta.url),
    });
  }, 'dsh-time-machine: plugin updater route');

  ctx.provide?.('timeMachineEngine', engine);
}