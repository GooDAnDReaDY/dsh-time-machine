# Changelog

Notable changes to `@goodandready/dsh-time-machine`.

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
