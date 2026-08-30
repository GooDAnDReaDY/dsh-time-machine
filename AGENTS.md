# AGENTS.md for dsh-time-machine

## Project Scope
- Plugin: `@goodandready-private/dsh-time-machine`
- Architecture: DeepSeek Harness Cordis plugin + Web client
- Canonical path: `/mnt/external/Project/DEV/dhsplugins/dsh-time-machine`

## Rules
- Tests must pass: `node --test test/*.test.mjs`
- Settings registered only via `settings.plugin.item` card format.
- No infrastructure paths or credentials hardcoded.
