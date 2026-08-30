import { Schema } from '@deepseek-ai/schemastery';

export const name = '@goodandready-private/dsh-time-machine';
export const inject = ['tools', 'settings', 'webServer'];

export const Config = Schema.object({
  autoSnapshotEnabled: Schema.boolean().default(true).description("Take automatic checkpoints before file changes"),
  maxSnapshots: Schema.number().default(20).description("Maximum snapshots in session history"),
  autoHealPrompt: Schema.boolean().default(true).description("Prompt recovery on command failure")
});

const NS = '@goodandready-private/dsh-time-machine';

export function apply(ctx, config) {
  let getConfig = () => config;

  ctx.inject(['settings'], (sctx) => {
    const scope = sctx.settings.register(NS, Config, { base: config });
    getConfig = () => scope.get() ?? config;
  });

  if (ctx.tools) {
    ctx.tools.register({
      name: 'time_machine_checkpoint_create',
      description: 'Initial tool for dsh-time-machine',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        return { success: true, plugin: 'dsh-time-machine' };
      }
    });
  }
}
