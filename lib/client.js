window.__ModuleLoader__.load({
  id: '@goodandready/dsh-time-machine',
  factory: (require) => {
    var module = { exports: {} };
    const React = require('react');
    const NS = '@goodandready/dsh-time-machine';

    const CSS = '.tm-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;margin:0;padding:0;overflow:hidden;box-sizing:border-box}'
      + '.tm-head{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;display:flex;align-items:center;gap:12px;padding:14px 16px}'
      + '.tm-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.05))}'
      + '.tm-head:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}'
      + '.tm-head-text{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}'
      + '.tm-title{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}'
      + '.tm-sub{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.45}'
      + '.tm-chev{margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}'
      + '.tm-chev-open{transform:rotate(180deg)}'
      + '.tm-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px;display:flex;flex-direction:column;gap:12px}'
      + '.tm-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}'
      + '.tm-label{color:var(--dsw-alias-label-secondary);font-size:12px}'
      + '.tm-input{height:34px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;box-sizing:border-box}'
      + '.tm-foot{border-top:1px solid var(--dsw-alias-border-l2);display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px}'
      + '.tm-save{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}'
      + '.tm-save:disabled{opacity:.45;cursor:default}'
      + '.tm-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 10px;font-size:12px;background:transparent;color:var(--dsw-alias-label-primary)}'
      + '.tm-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}'
      + '.tm-list{display:flex;flex-direction:column;gap:8px}'
      + '.tm-row{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1,transparent)}'
      + '.tm-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}'
      + '.tm-row-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}'
      + '.tm-row-meta{font-size:11px;color:var(--dsw-alias-label-secondary)}'
      + '.tm-modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}'
      + '.tm-modal-box{max-width:760px;width:100%;max-height:80vh;overflow:auto;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:16px;white-space:pre-wrap;font-family:monospace;font-size:12px}'
      + '.tm-tab{padding:12px;display:flex;flex-direction:column;gap:12px;height:100%;box-sizing:border-box;overflow:auto}';

    function ensureStyles() {
      if (typeof document === 'undefined' || !document.head) return;
      const id = 'dsh-time-machine/settings.module.css';
      if (document.querySelector('style[data-plugin-css="' + id + '"]')) return;
      const tag = document.createElement('style');
      tag.textContent = CSS;
      tag.setAttribute('data-plugin', 'dsh-time-machine');
      tag.setAttribute('data-plugin-css', id);
      document.head.appendChild(tag);
    }

    const en = {
      title: 'Time Machine & Checkpoints',
      sub: 'Shadow snapshots, diff and instant rollback for agent safety.',
      loading: 'Loading…',
      create: 'Create checkpoint',
      labelPh: 'Checkpoint label',
      list: 'Timeline',
      empty: 'No checkpoints yet.',
      diff: 'Diff',
      rollback: 'Rollback',
      delete: 'Delete',
      confirmDelete: 'Delete this checkpoint?',
      confirmRollback: 'Rollback to this checkpoint? This will reset the workspace.',
      close: 'Close',
      save: 'Save',
      saved: 'Saved',
      autoSnapshot: 'Auto snapshot before file changes',
      maxSnapshots: 'Max snapshots',
      autoHeal: 'Prompt recovery on failure',
      unavailable: 'Settings unavailable',
      tabTitle: 'Time Machine',
    };
    const ru = {
      title: 'Машина времени и чекпоинты',
      sub: 'Теневые снапшоты, diff и мгновенный откат для безопасности агента.',
      loading: 'Загрузка…',
      create: 'Создать чекпоинт',
      labelPh: 'Метка чекпоинта',
      list: 'Лента',
      empty: 'Чекпоинтов пока нет.',
      diff: 'Diff',
      rollback: 'Откатить',
      delete: 'Удалить',
      confirmDelete: 'Удалить этот чекпоинт?',
      confirmRollback: 'Откатиться к этому чекпоинту? Рабочая копия будет сброшена.',
      close: 'Закрыть',
      save: 'Сохранить',
      saved: 'Сохранено',
      autoSnapshot: 'Авто-снапшот перед изменениями',
      maxSnapshots: 'Макс. снапшотов',
      autoHeal: 'Предлагать восстановление при ошибке',
      unavailable: 'Настройки недоступны',
      tabTitle: 'Машина времени',
    };
    const zh = {
      title: '时光机与检查点',
      sub: '影子快照、差异对比与即时回滚，保障智能体安全。',
      loading: '加载中…',
      create: '创建检查点',
      labelPh: '检查点标签',
      list: '时间线',
      empty: '暂无检查点。',
      diff: '差异',
      rollback: '回滚',
      delete: '删除',
      confirmDelete: '确定删除此检查点？',
      confirmRollback: '确定回滚到此检查点？工作区将被重置。',
      close: '关闭',
      save: '保存',
      saved: '已保存',
      autoSnapshot: '文件变更前自动创建快照',
      maxSnapshots: '最大快照数',
      autoHeal: '命令失败时提示恢复',
      unavailable: '设置不可用',
      tabTitle: '时光机',
    };

    let ChevronIcon = null;
    try {
      const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
      ChevronIcon = primitives && primitives.IconChevronDownOutline14;
    } catch (e) { ChevronIcon = null; }
    function FallbackChevron(props) {
      return React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true', ...props },
        React.createElement('path', { d: 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5', fill: 'currentColor' }));
    }
    const Chevron = ChevronIcon || FallbackChevron;

    function useLocale(ctx) {
      if (!ctx || !ctx.locale) return 'en';
      const lang = React.useSyncExternalStore(
        React.useMemo(() => (cb) => ctx.locale.subscribe ? (ctx.locale.subscribe(cb) ?? (() => {})) : (() => {}), [ctx]),
        React.useCallback(() => (ctx.locale.getSnapshot && ctx.locale.getSnapshot()?.active) || 'en', [ctx])
      );
      return lang;
    }

    function sessionIdOf(ctx) {
      try {
        if (!ctx) return '';
        if (ctx.scope) {
          if (ctx.scope.session) return String(ctx.scope.session.id || ctx.scope.session.header?.id || '');
          if (typeof ctx.scope.id === 'string') return ctx.scope.id;
        }
        if (ctx.session) return String(ctx.session.id || ctx.session.header?.id || '');
        if (ctx.get && typeof ctx.get === 'function') {
          const s = ctx.get('session');
          if (s) return String(s.id || s.header?.id || '');
        }
      } catch {}
      return '';
    }

    function Timeline({ t, ctx }) {
      const sid = sessionIdOf(ctx);
      const [snapshots, setSnapshots] = React.useState([]);
      const [loading, setLoading] = React.useState(false);
      const [label, setLabel] = React.useState('');
      const [diffText, setDiffText] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [err, setErr] = React.useState('');

      const fetchList = React.useCallback(() => {
        setLoading(true); setErr('');
        const q = sid ? '?sessionId=' + encodeURIComponent(sid) : '';
        fetch('/dsh-time-machine/snapshots' + q).then(r => r.json()).then(j => {
          if (j.success) setSnapshots(j.snapshots || []);
          else setErr(j.error || 'load failed');
        }).catch(e => setErr(String(e.message || e))).finally(() => setLoading(false));
      }, [sid]);

      React.useEffect(() => { fetchList(); }, [fetchList]);

      const onCreate = () => {
        setBusy(true); setErr('');
        fetch('/dsh-time-machine/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label, sessionId: sid }) })
          .then(r => r.json()).then(j => {
            if (!j.success) throw new Error(j.error || 'create failed');
            setLabel(''); fetchList();
          }).catch(e => setErr(String(e.message || e))).finally(() => setBusy(false));
      };
      const onDiff = (id) => {
        setBusy(true); setErr('');
        fetch('/dsh-time-machine/diff?from=' + encodeURIComponent(id)).then(r => r.json()).then(j => {
          if (!j.success) throw new Error(j.error || 'diff failed');
          setDiffText(j.diff || '');
        }).catch(e => setErr(String(e.message || e))).finally(() => setBusy(false));
      };
      const onRollback = (id) => {
        if (!window.confirm(t.confirmRollback)) return;
        setBusy(true); setErr('');
        fetch('/dsh-time-machine/rollback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, confirm: true }) })
          .then(r => r.json()).then(j => {
            if (!j.success) throw new Error(j.error || 'rollback failed');
            fetchList();
          }).catch(e => setErr(String(e.message || e))).finally(() => setBusy(false));
      };
      const onDelete = (id) => {
        if (!window.confirm(t.confirmDelete)) return;
        setBusy(true); setErr('');
        fetch('/dsh-time-machine/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, confirm: true }) })
          .then(r => r.json()).then(j => {
            if (!j.success) throw new Error(j.error || 'delete failed');
            fetchList();
          }).catch(e => setErr(String(e.message || e))).finally(() => setBusy(false));
      };

      return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          React.createElement('input', { className: 'tm-input', style: { flex: 1 }, placeholder: t.labelPh, value: label, onChange: (e) => setLabel(e.target.value) }),
          React.createElement('button', { className: 'tm-btn', disabled: busy, onClick: onCreate }, t.create)
        ),
        loading ? React.createElement('div', { className: 'tm-label' }, t.loading) : null,
        err ? React.createElement('div', { className: 'tm-label', style: { color: 'var(--dsw-alias-state-error-primary)' } }, err) : null,
        snapshots.length === 0 && !loading ? React.createElement('div', { className: 'tm-label' }, t.empty) : null,
        React.createElement('div', { className: 'tm-list' },
          snapshots.map(s => React.createElement('div', { key: s.id, className: 'tm-row' },
            React.createElement('span', { className: 'tm-row-main' },
              React.createElement('span', { className: 'tm-row-title' }, s.label + ' · ' + s.id),
              React.createElement('span', { className: 'tm-row-meta' }, new Date(s.createdAt).toLocaleString() + (s.commit ? ' · ' + s.commit.slice(0,7) : ''))
            ),
            React.createElement('button', { className: 'tm-btn', disabled: busy, onClick: () => onDiff(s.id) }, t.diff),
            React.createElement('button', { className: 'tm-btn', disabled: busy, onClick: () => onRollback(s.id) }, t.rollback),
            React.createElement('button', { className: 'tm-btn', disabled: busy, onClick: () => onDelete(s.id) }, t.delete)
          ))
        ),
        diffText !== null ? React.createElement('div', { className: 'tm-modal', onClick: () => setDiffText(null) },
          React.createElement('div', { className: 'tm-modal-box', onClick: (e) => e.stopPropagation() },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } },
              React.createElement('strong', null, 'diff'),
              React.createElement('button', { className: 'tm-btn', onClick: () => setDiffText(null) }, t.close)
            ),
            React.createElement('pre', { style: { margin: 0, whiteSpace: 'pre-wrap' } }, diffText)
          )
        ) : null
      );
    }

    function PluginCard(props) {
      const ctx = props.ctx;
      const [expanded, setExpanded] = React.useState(false);
      const lang = useLocale(ctx);
      const t = lang.startsWith('zh') ? zh : (lang.startsWith('ru') ? ru : en);
      const [settingsStatus, setSettingsStatus] = React.useState('loading');
      const [draft, setDraft] = React.useState({ autoSnapshotEnabled: true, maxSnapshots: 20, autoHealPrompt: true });
      const [saving, setSaving] = React.useState(false);
      const [saveErr, setSaveErr] = React.useState('');

      const scope = React.useMemo(() => {
        try { return ctx.settingsScope ? ctx.settingsScope.bind({ namespace: NS }) : null; } catch { return null; }
      }, [ctx]);

      React.useEffect(() => { ensureStyles(); }, []);

      React.useEffect(() => {
        if (!scope) { setSettingsStatus('unavailable'); return; }
        let alive = true;
        const sync = () => {
          try {
            const snap = scope.getSnapshot ? scope.getSnapshot() : null;
            if (!snap) { if (alive) setSettingsStatus('loading'); return; }
            if (snap.status === 'loading') { if (alive) setSettingsStatus('loading'); return; }
            if (snap.status === 'unavailable') { if (alive) setSettingsStatus('unavailable'); return; }
            const val = snap.value || snap.data || {};
            if (alive) {
              setDraft({
                autoSnapshotEnabled: val.autoSnapshotEnabled ?? true,
                maxSnapshots: val.maxSnapshots ?? 20,
                autoHealPrompt: val.autoHealPrompt ?? true,
              });
              setSettingsStatus('ready');
            }
          } catch { if (alive) setSettingsStatus('unavailable'); }
        };
        sync();
        const unsub = scope.subscribe ? scope.subscribe(sync) : () => {};
        return () => { alive = false; try { unsub(); } catch {} };
      }, [scope]);

      const onSave = async () => {
        if (!scope) return;
        setSaving(true); setSaveErr('');
        try {
          const keys = ['autoSnapshotEnabled', 'maxSnapshots', 'autoHealPrompt'];
          const failures = [];
          for (const k of keys) {
            try { await scope.set(k, draft[k]); } catch (e) { failures.push(k + ': ' + String(e.message || e)); }
          }
          if (failures.length) setSaveErr(failures.join('; '));
        } catch (e) { setSaveErr(String(e.message || e)); }
        finally { setSaving(false); }
      };

      // Strict adherence to DSH Plugin Authoring: writable ONLY when ready
      const writable = settingsStatus === 'ready';

      return React.createElement('li', { className: 'tm-card' },
        React.createElement('button', { type: 'button', className: 'tm-head', 'aria-expanded': expanded, onClick: () => setExpanded(!expanded) },
          React.createElement('span', { className: 'tm-head-text' },
            React.createElement('span', { className: 'tm-title' }, t.title),
            React.createElement('span', { className: 'tm-sub' }, t.sub)
          ),
          React.createElement(Chevron, { className: 'tm-chev' + (expanded ? ' tm-chev-open' : '') })
        ),
        expanded ? React.createElement('div', { className: 'tm-body' },
          React.createElement('div', null,
            settingsStatus === 'loading' ? React.createElement('div', { className: 'tm-label' }, t.loading) : null,
            settingsStatus === 'unavailable' ? React.createElement('div', { className: 'tm-label', style: { color: 'var(--dsw-alias-state-warning-primary)' } }, t.unavailable) : null,
            React.createElement('div', { className: 'tm-field' },
              React.createElement('label', { className: 'tm-label' },
                React.createElement('input', { type: 'checkbox', checked: !!draft.autoSnapshotEnabled, disabled: !writable, onChange: (e) => setDraft(d => ({ ...d, autoSnapshotEnabled: e.target.checked })) }), ' ' + t.autoSnapshot
              ),
              React.createElement('label', { className: 'tm-label' }, t.maxSnapshots,
                React.createElement('input', { className: 'tm-input', type: 'number', value: draft.maxSnapshots, disabled: !writable, onChange: (e) => setDraft(d => ({ ...d, maxSnapshots: Number(e.target.value) || 20 })) })
              ),
              React.createElement('label', { className: 'tm-label' },
                React.createElement('input', { type: 'checkbox', checked: !!draft.autoHealPrompt, disabled: !writable, onChange: (e) => setDraft(d => ({ ...d, autoHealPrompt: e.target.checked })) }), ' ' + t.autoHeal
              )
            ),
            saveErr ? React.createElement('div', { className: 'tm-label', style: { color: 'var(--dsw-alias-state-error-primary)' } }, saveErr) : null,
            React.createElement('div', { className: 'tm-foot' },
              React.createElement('button', { className: 'tm-save', disabled: !writable || saving, onClick: onSave }, saving ? t.loading : t.save)
            )
          ),
          React.createElement('div', { className: 'tm-field' },
            React.createElement('div', { className: 'tm-label' }, t.list),
            React.createElement(Timeline, { t, ctx })
          )
        ) : null
      );
    }

    function TimeMachineTab(props) {
      const ctx = props.ctx;
      const lang = useLocale(ctx);
      const t = lang.startsWith('zh') ? zh : (lang.startsWith('ru') ? ru : en);
      return React.createElement('div', { className: 'tm-tab' },
        React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, t.tabTitle),
        React.createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 4 } }, t.sub),
        React.createElement(Timeline, { t, ctx })
      );
    }

    module.exports.inject = ['slots', 'locale'];
    module.exports.apply = function apply(ctx) {
      ensureStyles();
      try { ctx.locale && ctx.locale.register && ctx.locale.register(NS, { en, ru, zh }); } catch {}
      // declaration-safe settings registration (alpha2 SlotCore requires inject)
      let settingsRegistered = false;
      const doRegisterSettings = () => {
        if (settingsRegistered) return;
        try {
          ctx.slots.register({ name: 'settings.plugin.item', key: NS, locale: NS, inject: () => ({ ctx }) }, PluginCard);
          settingsRegistered = true;
        } catch (e) {
          const msg = String(e && e.message || e);
          if (msg.includes('not declared') || msg.includes('is not declared')) {
            // fallback to section if plugin.item not declared in this host build
            try {
              const t = (ctx.locale && ctx.locale.bind) ? ctx.locale.bind(NS) : (k) => k;
              ctx.slots.register({ name: 'settings.section', id: NS, order: 30, label: () => t('title'), inject: () => ({ ctx }) }, PluginCard);
              settingsRegistered = true;
            } catch (e2) {
              console.error('[dsh-time-machine] settings registration failed', e2);
            }
          } else {
            console.error('[dsh-time-machine] settings.plugin.item registration failed', e);
          }
        }
      };
      // wait for host declaration; if inject not available, try direct (older DSH)
      if (ctx.slots && typeof ctx.slots.inject === 'function') {
        try {
          ctx.slots.inject('settings.plugin.item', () => {
            doRegisterSettings();
          });
        } catch (e) {
          console.error('[dsh-time-machine] slots.inject failed', e);
          doRegisterSettings();
        }
      } else {
        doRegisterSettings();
      }
      // BetterSidebar: single declaration-aware path via ctx.inject
      let tabRegistered = false;
      const doRegisterTab = (bctx) => {
        if (tabRegistered) return;
        const svc = (bctx && bctx.betterSidebar) || (bctx && bctx.get && (()=>{ try{return bctx.get('betterSidebar')}catch{return null}})()) || ctx.betterSidebar;
        if (!svc || typeof svc.registerTab !== 'function') return;
        try {
          svc.registerTab({
            id: 'time-machine',
            title: () => {
              const a = (ctx.locale && ctx.locale.getSnapshot && ctx.locale.getSnapshot().active) || 'en';
              return a.startsWith('zh') ? '时光机' : (a.startsWith('ru') ? 'Машина времени' : 'Time Machine');
            },
            order: 30,
            single: true,
            icon: (size) => React.createElement('svg', { width: size||16, height: size||16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' },
              React.createElement('circle', { cx:12, cy:12, r:10 }),
              React.createElement('polyline', { points:'12 6 12 12 16 14' })
            ),
            component: (p) => React.createElement(TimeMachineTab, { ctx, ...p })
          });
          tabRegistered = true;
        } catch (e) {
          console.error('[dsh-time-machine] betterSidebar registerTab failed', e);
        }
      };
      if (ctx.inject) {
        try {
          ctx.inject(['betterSidebar'], (bctx) => {
            doRegisterTab(bctx);
            return () => {};
          });
        } catch (e) {
          if (String(e && e.message || '').includes('not declared')) {
            // service not declared in this host build - silently skip tab
          } else {
            console.error('[dsh-time-machine] betterSidebar inject failed', e);
          }
        }
      }
    };
    return module.exports;
  },
});