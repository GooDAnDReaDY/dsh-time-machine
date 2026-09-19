# Changelog

Notable changes to `@goodandready/dsh-time-machine`.

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
