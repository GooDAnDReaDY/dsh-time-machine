# dsh-time-machine

DSH plugin for smart checkpoints, workspace safety guards, and instant rollback for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

## Tools
- `time_machine_checkpoint_create`
- `time_machine_checkpoint_list`
- `time_machine_checkpoint_rollback`
- `time_machine_diff`

## Settings
Located in **Settings -> Plugins -> Time Machine & Checkpoints**:
- `autoSnapshotEnabled`: Take automatic checkpoints before file changes (default: `true`)
- `maxSnapshots`: Maximum snapshots in session history (default: `20`)
- `autoHealPrompt`: Prompt recovery on command failure (default: `true`)

## Verification
```bash
npm test
```
