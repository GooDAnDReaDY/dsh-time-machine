# Changelog

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
