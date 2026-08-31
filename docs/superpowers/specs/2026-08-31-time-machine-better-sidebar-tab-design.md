# Design: dsh-time-machine — Better Sidebar Tab (Approach A)

**Date:** 2026-08-31
**Plugin:** `@goodandready-private/dsh-time-machine` (`dhsplugins/dsh-time-machine`)
**Approach:** A (single tab via `ctx.betterSidebar.registerTab`, settings card unchanged)

## 1. Goal
Вынести ленту чекпоинтов из скрытой карточки `Settings → Plugins` в боковую панель `dsh-better-sidebar`, чтобы во время сессии агент и пользователь видели timeline рядом с чатом. Сохранить фолбэк если `betterSidebar` отсутствует.

## 2. Context
- Текущая лента `lib/client.js:140` — `settings.plugin.item` `key=NS`, collapsed, `tm-*` стили. Удобна для настроек, но не видна в сессии.
- `dsh-better-sidebar` `0.18.0-alpha.0` предоставляет `ctx.betterSidebar` `lib/types/client/service.d.ts:291` — `registerTab(descriptor)` → disposer, сервис через `ctx.get('betterSidebar')` или `ctx.betterSidebar`, `inject:['betterSidebar']` опционально.
- Пример `dsh-live-canvas/lib/client.js:707` — `service.registerTab({id:'live-canvas', title, order:25, single:true, icon, component})` + `ctx.inject(['betterSidebar'], ...)`.
- Host `lib/index.js:1` уже имеет `ShadowSnapshotEngine` и 4 tools + `webServer` `/dsh-time-machine/*` — таб переиспользует те же HTTP эндпоинты.

## 3. Architecture

```
[Host] lib/index.js
  ShadowSnapshotEngine + tools + webServer (/snapshots /diff /create /rollback)
       ^
       | fetch
[Client] lib/client.js
  PluginCard (settings.plugin.item)  ← existing, keeps autoSnapshot/maxSnapshots
  TimeMachineTab (betterSidebar tab) ← new, timeline + diff + rollback
       |
  ctx.betterSidebar.registerTab() via ctx.effect + inject fallback
```

- Host не зависит от sidebar: `inject` включает `betterSidebar` как optional, отсутствие — no-op.
- Client регистрирует таб в `ctx.effect`, возвращает disposer для HMR.

## 4. Components

### 4.1 TimeMachineTab
- Props: `TabComponentProps` `lib/types/client/service.d.ts:TabComponentProps` — `{ctx, store, scope, tab, visible}`
- State: `snapshots[]`, `loading`, `busy`, `error`, `label`, `diffText|null`
- Data flow: `GET /dsh-time-machine/snapshots` on `visible` + `turn/end` event (optional poll 15s), `POST /create`, `POST /rollback` with `confirm:true`, `GET /diff?from=&to=`
- UI: header `Create [input + button]`, list `tm-row` per snapshot (label·id·time·commit7 + Diff + Rollback), diff modal `tm-modal`, error line `var(--dsw-alias-state-error-primary)`
- Hooks: all `useState/useEffect` before any return (React 310 guard)

### 4.2 PluginCard (existing)
- Без изменений, остаётся для настроек. Проверяет `scope.getSnapshot().status` (`loading/unavailable/ready`) `lib/client.js:50`.

### 4.3 registerBetterSidebar(ctx)
- `const svc = (ctx.get && ctx.get('betterSidebar')) || ctx.betterSidebar`
- `if (!svc?.registerTab) return`
- `svc.registerTab({id:'time-machine', title: () => locale==='ru'?'Машина времени':'Time Machine', order:30, single:true, icon: (s)=> ClockSVG, component: TimeMachineTab})` — `component` как в live-canvas `lib/client.js:739`
- `ctx.effect(() => svc.registerTab(...), 'time-machine: betterSidebar tab')` + `ctx.inject(['betterSidebar'], () => registerBetterSidebar(ctx))` — двойная регистрация для уже-поднятого сервиса и для ленивого inject.

## 5. Data Flow
1. Agent/User создает чекпоинт via tool или UI `POST /create {label}` → engine `createSnapshot` → `refs/dsh-time-machine/<id>`
2. Tab `GET /snapshots` → render list
3. Diff click → `GET /diff?from=id` → modal
4. Rollback click → `window.confirm` → `POST /rollback {id, confirm:true}` → engine `reset --hard` → `GET /snapshots` refresh

## 6. Error Handling
- `betterSidebar` отсутствует: `try/catch` + ранний `return`, не ломает settings card
- Fetch ошибки: `error` state, `var(--dsw-alias-state-error-primary)`, не падает
- Rollback без `confirm:true`: host возвращает `400 {code:'CONFIRM_REQUIRED'}`, tab показывает ошибку
- Двойная регистрация `id:'time-machine'`: guard `tabs.has(descriptor.id)` в betterSidebar — наш `try/catch` глотает `already registered`

## 7. Testing
- `node --test test/*.test.mjs` — добавить static check: `lib/client.js` содержит `registerTab` + `time-machine` + `TimeMachineTab` + `betterSidebar`
- Unit engine уже 6 тестов `test/dsh-time-machine.test.mjs:1` — без изменений
- Manual: DSH `~/.dsh/profiles/web` с `dsh-better-sidebar` установленным — проверить вкладка появляется в `+` меню, клик Diff/Rollback работает, без betterSidebar — только Settings карточка

## 8. Style & A11y
- Префикс `tm-` для всех классов, только `var(--dsw-alias-*)`, `border-radius:12px`, свёрнута по умолчанию (settings), таб открыт по `visible`
- Кнопки `type="button"`, `aria-expanded`, клавиатурный доступ

## 9. Non-Goals (YAGNI)
- `registerFileViewer` для diff файлов — отложено до запроса
- Авто-открытие таба на `turn/end` — шумно, не делаем
- Хранение снапшотов на диск вне git — engine остаётся in-memory + git refs

## 10. Verification Checklist
- [ ] `grep -c "registerTab" lib/client.js` ≥1, `id:'time-machine'` present
- [ ] `package.json` name === `cordis.patch.yml` name === `client.js` id (private route)
- [ ] `npm test` 7/7 pass (6 existing + 1 new static)
- [ ] В DSH с betterSidebar: вкладка `Time Machine` в списке, Diff/Rollback работают; без betterSidebar: только Settings карточка, без ошибок
