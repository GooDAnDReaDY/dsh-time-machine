import Schema from '@deepseek-ai/schemastery';
import { ShadowSnapshotEngine } from './snapshot.js';

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
  } catch {}
  return undefined;
}

function sessionIdOf(execution, ctx) {
  try {
    if (execution?.sessionId) return String(execution.sessionId);
    if (execution?.session?.id) return String(execution.session.id);
    if (execution?.data?.sessionId) return String(execution.data.sessionId);
    if (ctx?.session?.id) return String(ctx.session.id);
  } catch {}
  return '';
}

export function apply(ctx, config) {
  let getConfig = () => config;
  const initialCwd = cwdOf(null, ctx);
  let engine = new ShadowSnapshotEngine({ maxSnapshots: config?.maxSnapshots ?? 20, cwd: initialCwd });
  engine.loadFromRefs({ cwd: initialCwd }).catch(() => {});

  ctx.inject(['settings'], (sctx) => {
    const scope = sctx.settings.register(NS, Config, { base: config });
    getConfig = () => scope.get() ?? config;
    const syncMax = () => engine.setMax(getConfig().maxSnapshots ?? 20, cwdOf(null, ctx));
    syncMax();
    const stop = scope.watch ? scope.watch(syncMax) : () => {};
    sctx.effect(() => () => { try { stop(); } catch {} }, 'dsh-time-machine: settings watch');
  });

  // auto-snapshot on turn/start and approval/asked (session-scoped)
  const autoSnap = async (label, sessId, customCwd) => {
    if (!getConfig().autoSnapshotEnabled) return;
    try {
      const sid = String(sessId || '').trim();
      const targetCwd = customCwd || cwdOf(null, ctx);
      await engine.createSnapshot(label, { sessionId: sid, cwd: targetCwd, skipIfNoChanges: true });
    } catch {}
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
      return () => { try { typeof off === 'function' && off(); } catch {} };
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
          } catch {}
          try {
            offs.push(ctx.events.on('approval/asked', (ev) => {
              const sid = sessionIdOf(ev, ctx);
              const tool = ev?.tool || ev?.name || 'approval';
              autoSnap(`auto:approval:${tool}`, sid);
            }));
          } catch {}
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
          } catch {}
          return () => { for (const off of offs) try { typeof off === 'function' && off(); } catch {} };
        }, 'dsh-time-machine: auto snapshot events fallback');
      }
    } catch {}
  }

  // tools (session-aware and cwd-aware)
  const registerTools = (tctx) => {
    tctx.tools.register({
      name: 'time_machine_checkpoint_create',
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
      name: 'time_machine_diff',
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
  } catch {}

  // Safe read body with max 1MB limit to protect against DoS
  const readJsonBody = (req, res, cb) => {
    let body = '';
    let exceeded = false;
    req.on('data', (c) => {
      body += c;
      if (body.length > 1024 * 1024) {
        exceeded = true;
        res.statusCode = 413;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ success: false, error: 'payload too large' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (exceeded) return;
      try {
        const parsed = body ? JSON.parse(body) : {};
        cb(parsed);
      } catch (e) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ success: false, error: 'invalid json' }));
      }
    });
  };

  // web routes for UI (session-aware via ?sessionId= and ?format=)
  ctx.effect(() => {
    const disposals = [];
    try {
      disposals.push(ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-time-machine/snapshots',
        handler: (req, res) => {
          const url = new URL(req.url, 'http://localhost');
          const sid = url.searchParams.get('sessionId');
          const list = sid != null ? engine.listSnapshots(String(sid)) : engine.listSnapshots();
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ success: true, snapshots: list }));
        },
      }));
      disposals.push(ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-time-machine/diff',
        handler: async (req, res) => {
          const url = new URL(req.url, 'http://localhost');
          const from = url.searchParams.get('from') || '';
          const to = url.searchParams.get('to') || undefined;
          const format = url.searchParams.get('format') || 'patch';
          try {
            const out = await engine.diff(String(from), to ? String(to) : undefined, {
              cwd: cwdOf(null, ctx),
              format: format === 'stat' ? 'stat' : 'patch',
            });
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ success: true, ...out }));
          } catch (e) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ success: false, error: String(e.message || e) }));
          }
        },
      }));
      disposals.push(ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-time-machine/create',
        handler: (req, res) => {
          readJsonBody(req, res, async (parsed) => {
            try {
              const sid = String(parsed.sessionId || new URL(req.url, 'http://localhost').searchParams.get('sessionId') || '').trim();
              const targetCwd = parsed.cwd ? String(parsed.cwd) : cwdOf(null, ctx);
              const snap = await engine.createSnapshot(parsed.label, { sessionId: sid, cwd: targetCwd });
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ success: true, snapshot: snap }));
            } catch (e) {
              res.statusCode = 400;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ success: false, error: String(e.message || e) }));
            }
          });
        },
      }));
      disposals.push(ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-time-machine/delete',
        handler: (req, res) => {
          readJsonBody(req, res, async (parsed) => {
            try {
              const targetCwd = parsed.cwd ? String(parsed.cwd) : cwdOf(null, ctx);
              const out = await engine.deleteSnapshot(String(parsed.id || ''), { confirm: parsed.confirm, cwd: targetCwd });
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ success: true, ...out }));
            } catch (e) {
              res.statusCode = 400;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ success: false, error: String(e.message || e), code: e.code || '' }));
            }
          });
        },
      }));
      disposals.push(ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-time-machine/prune',
        handler: (req, res) => {
          readJsonBody(req, res, async (parsed) => {
            try {
              const sid = String(parsed.sessionId || new URL(req.url, 'http://localhost').searchParams.get('sessionId') || '');
              const targetCwd = parsed.cwd ? String(parsed.cwd) : cwdOf(null, ctx);
              const out = await engine.pruneSnapshots(sid, parsed.keep, { cwd: targetCwd });
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ success: true, sessionId: sid, ...out }));
            } catch (e) {
              res.statusCode = 400;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ success: false, error: String(e.message || e) }));
            }
          });
        },
      }));
      disposals.push(ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-time-machine/rollback',
        handler: (req, res) => {
          readJsonBody(req, res, async (parsed) => {
            try {
              const targetCwd = parsed.cwd ? String(parsed.cwd) : cwdOf(null, ctx);
              const out = await engine.rollbackSnapshot(String(parsed.id || ''), { confirm: parsed.confirm, cwd: targetCwd });
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ success: true, ...out }));
            } catch (e) {
              res.statusCode = 400;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ success: false, error: String(e.message || e), code: e.code || '' }));
            }
          });
        },
      }));
    } catch {}
    return () => { for (const d of disposals) try { typeof d === 'function' && d(); } catch {} };
  }, 'dsh-time-machine: web routes');

  ctx.provide?.('timeMachineEngine', engine);
}