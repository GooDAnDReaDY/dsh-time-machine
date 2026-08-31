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

export function apply(ctx, config) {
  let getConfig = () => config;
  let engine = new ShadowSnapshotEngine({ maxSnapshots: config?.maxSnapshots ?? 20 });

  ctx.inject(['settings'], (sctx) => {
    const scope = sctx.settings.register(NS, Config, { base: config });
    getConfig = () => scope.get() ?? config;
    const syncMax = () => engine.setMax(getConfig().maxSnapshots ?? 20);
    syncMax();
    const stop = scope.watch ? scope.watch(syncMax) : () => {};
    sctx.effect(() => () => { try { stop(); } catch {} }, 'dsh-time-machine: settings watch');
  });

  // tools
  const registerTools = (tctx) => {
    tctx.tools.register({
      name: 'time_machine_checkpoint_create',
      description: 'Create a workspace checkpoint (shadow git snapshot) before risky changes. Returns id and label.',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Human label for checkpoint' },
        },
      },
      execute: async ({ label } = {}) => {
        const snap = await engine.createSnapshot(label);
        return { success: true, snapshot: snap };
      },
    });

    tctx.tools.register({
      name: 'time_machine_checkpoint_list',
      description: 'List recent workspace checkpoints newest first.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const list = engine.listSnapshots();
        return { success: true, snapshots: list };
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
        },
        required: ['id', 'confirm'],
      },
      execute: async ({ id, confirm } = {}) => {
        const res = await engine.rollbackSnapshot(String(id ?? ''), { confirm });
        return { success: true, ...res };
      },
    });

    tctx.tools.register({
      name: 'time_machine_diff',
      description: 'Show diff between checkpoint and current or another checkpoint.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Source snapshot id' },
          to: { type: 'string', description: 'Target snapshot id (default HEAD)' },
        },
        required: ['from'],
      },
      execute: async ({ from, to } = {}) => {
        const res = await engine.diff(String(from ?? ''), to ? String(to) : undefined);
        return { success: true, ...res };
      },
    });
  };

  try {
    if (ctx.tools) registerTools(ctx);
    else ctx.inject(['tools'], (tctx) => registerTools(tctx));
  } catch {}

  // web routes for UI
  ctx.effect(() => {
    const disposals = [];
    try {
      disposals.push(ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-time-machine/snapshots',
        handler: (req, res) => {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ success: true, snapshots: engine.listSnapshots() }));
        },
      }));
      disposals.push(ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-time-machine/diff',
        handler: async (req, res) => {
          const url = new URL(req.url, 'http://localhost');
          const from = url.searchParams.get('from') || '';
          const to = url.searchParams.get('to') || undefined;
          try {
            const out = await engine.diff(String(from), to ? String(to) : undefined);
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
        handler: async (req, res) => {
          let body = '';
          req.on('data', (c) => body += c);
          req.on('end', async () => {
            try {
              const parsed = body ? JSON.parse(body) : {};
              const snap = await engine.createSnapshot(parsed.label);
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
        path: '/dsh-time-machine/rollback',
        handler: async (req, res) => {
          let body = '';
          req.on('data', (c) => body += c);
          req.on('end', async () => {
            try {
              const parsed = body ? JSON.parse(body) : {};
              const out = await engine.rollbackSnapshot(String(parsed.id || ''), { confirm: parsed.confirm });
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

  // expose engine for tests
  ctx.provide?.('timeMachineEngine', engine);
}
