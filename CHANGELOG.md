# Changelog

## 0.1.25

### Fixed
- **Crash on startup and first turn on DSH 0.1.7+/0.2.0 due to DataCloneError** (GitHub #6, #73): volatile schema fields in `config` are passed as accessor objects with `get()` functions. Calling `structuredClone(config)` threw `DataCloneError`, preventing `engine.setMax` from applying and terminating the host turn on the first turn. Volatile accessors are now safely unwrapped with `plainConfig` before schema evaluation.

## 0.1.24

### Fixed
- **Peer gate on DSH 0.2.0-rc.1** (#58): the bundle was skipped at profile startup because its `peerDependencies` excluded the running version.
- **Settings card served no form**: `NS` was the package name rather than the profile entry id, `Config` declared no `.volatile()` field, and `getConfig` handed out `Volatile` boxes. Both 0.1.7-rc.2 and 0.2.0 now serve and read the form.
- **A saved setting never took effect**: the host applied changes through `settings.register` and `scope.watch`, neither of which exists in either release. Changes are applied on `loader/volatile-update` now.
- **`settings.plugin.item` registration removed**: retired before DSH 0.1.7-rc.2, so it only registered the card a second time on a seat that no longer exists.

## 0.1.23

### Fixed
- **Peer gate on DSH 0.2.0-rc.1** (#58): DSH skips a profile bundle whose `peerDependencies` exclude the running version, so this plugin was absent from the profile with no error in the UI. Every `@deepseek-ai/dsh-*` peer now names both the 0.1.7-rc.2 and 0.2.0-rc.1 lines, because semver does not admit a prerelease of the next minor into a range that does not name it.

Notable changes to `@goodandready/dsh-time-machine`.

## 0.1.22

### Security
- **Strict path traversal and symlink escape protection in selective rollback**: `rollbackFile`
  now strictly rejects absolute paths, `..` directory traversal attempts, and symlink escapes
  outside the repository workspace before invoking Git checkout or unlinking files (#65).
- **Hardened HTTP trust validation against same-site requests**: `isTrustedSettingsRequest`
  now categorically rejects `sec-fetch-site: same-site` requests, enforces verified `Origin`
  or `Referer` headers matching the server Host for all non-loopback clients, and restricts
  unauthenticated requests strictly to local loopback (#38).

## 0.1.21

### Security
- **Hardened HTTP settings & web routes validation**: improved `isTrustedSettingsRequest`
  to reject `Sec-Fetch-Site: cross-site`, validated `Origin`/`Referer` headers against `Host` and
  `X-Forwarded-Host`, and removed unverified token fallbacks. Added `isTrustedSettingsRequest`
  protection to `GET /dsh-time-machine/snapshots` and `GET /dsh-time-machine/diff` (#59, #60).

### Fixed
- **Cleanup orphaned indices in non-git directories**: `cleanupOrphanedIndices` now safely verifies
  whether the working directory is a git repository before invoking `git rev-parse --git-dir`,
  preventing fatal git errors during startup in non-git directories (#57, #61).
- **Descriptive rollback errors without git commit**: `rollbackSnapshot` and `rollbackFile` now fail
  with an explicit error if a target snapshot lacks an associated git commit, avoiding false success (#58).
- **Session snapshot limits on turn end**: event listener for `turn/end` now respects the configured
  `maxSnapshots` limit instead of truncating history to 3 snapshots (#56).

### Performance
- **Optimized snapshot creation**: added `skipIfNoChanges` fast check using `git status --porcelain`
  and HEAD verification to avoid redundant `git add -A` and object writes on clean trees, plus label
  newline sanitization (#55).

### Release
- **Canonical GitHub mirror publishing script**: added executable `scripts/publish-github.sh` with
  `--check` dry-run and sanitized tree packaging for mirror synchronization (#53).

## 0.1.20

### Fixed
- **Settings reachable again on the plugin's own page**: the current DSH core
  (0.1.6-alpha.2) renders a plugin's configuration page only for entries registered
  in the plugin-list seat `plugins.item`. It takes an `id` and a static label instead
  of a `key`, so it is registered on its own alongside the existing seat list; the row
  seat and the legacy `settings.plugin.item` card stay as fallbacks.

## 0.1.19

### Fixed
- **Settings reachable again**: the card registered into `settings.plugin.item`, a
  slot the current DSH core (0.1.6-alpha.2) no longer renders, so the plugin's
  settings were unreachable. The surface now registers into the Plugins page row
  seat `plugins.row.config` first, keyed
  `@goodandready/dsh-time-machine#dsh-time-machine` (`rowConfigKey(package, rowId)`):
  the plugin's row gains a configure control whose page is the settings form
  (`view: 'page'`, expanded and without our card chrome — the host page draws the
  title, icon, crumb and padding) plus a one-line state for `view: 'summary'`. The
  legacy seat stays registered as a fallback, and both go through `slots.inject`,
  which alpha2 SlotCore requires.

### Added
- This changelog.
