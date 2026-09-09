# DESIGN.md — @goodandready/dsh-time-machine

## Product / Purpose
- Назначение: Автоматические теневые Git-снапшоты, инспекция различий (Diff) и безопасный откат рабочего пространства агента без повреждения истории веток Git.
- Аудитория: Пользователи DeepSeek Harness, автономные агенты, разработчики плагинов.
- Статус: Production.

## User Surfaces
- Web/UI: Вкладка "Time Machine" в нативном DSH Right Sidebar (`sidebarRightTabs.register` + слот `sidebar.right.pane.tab`), вкладка в legacy BetterSidebar (`betterSidebar.registerTab`), карточка настроек `settings.plugin.item` в настройках плагинов DSH Web UI.
- DSH UI / settings / slots: нативный Sidebar (`sidebarRightTabs`, слот `sidebar.right.pane.tab`, key: `@goodandready/dsh-time-machine`), слот `settings.plugin.item` (NS: `@goodandready/dsh-time-machine`), legacy сервис `betterSidebar` (вкладка `time-machine`).
- API: HTTP WebServer endpoints (`/dsh-time-machine/snapshots`, `/dsh-time-machine/diff`, `/dsh-time-machine/create`, `/dsh-time-machine/delete`, `/dsh-time-machine/rollback`, `/dsh-time-machine/prune`).
- CLI: Агентские инструменты DSH:
  - `time_machine_checkpoint_create`
  - `time_machine_checkpoint_list`
  - `time_machine_checkpoint_rollback`
  - `time_machine_diff`
  - `time_machine_checkpoint_delete`
  - `time_machine_checkpoint_prune`
- Документация: `README.md`, `README.ru.md`, `README.zh.md`.

## Visual Direction
- Атмосфера: Строгий, лаконичный нативный интерфейс DeepSeek Harness (тёмная тема, минималистичные контролы).
- Утверждённые референсы: Карточки настроек ядра DSH («Консоль», «Цикл агента»), дизайн-токены `--dsw-alias-*`.
- Не копировать: Чужие брендовые элементы, кастомные несогласованные цветовые схемы, тяжелые градиенты и тени.

## Foundations
- Цвета и роли:
  - Фон карточки: `var(--dsw-alias-bg-layer-3)`
  - Границы: `var(--dsw-alias-border-l2)`
  - Основной текст: `var(--dsw-alias-label-primary)`
  - Второстепенный текст / подсказки: `var(--dsw-alias-label-secondary)`
  - Ошибки: `var(--dsw-alias-state-error-primary)`
  - Предупреждения: `var(--dsw-alias-state-warning-primary)`
- Типографика: Системный стек шрифтов DSH UI (15px заголовок карточки, 13px текст полей и списков, 11px метаданные даты и хеша).
- Сетка, отступы, responsive: Карточка списка настроек `li.tm-card` с `border-radius: 12px`, padding 14px 16px в заголовке, внутренние отступы 12px.
- Accessibility: `button[aria-expanded]`, `aria-hidden` для декоративных SVG-иконок, контрастные лейблы для чекбоксов и числовых полей, видимый фокус-контур `outline: 2px solid var(--dsw-alias-state-business-primary)`.

## Components And States
- Компоненты:
  - `PluginCard`: Сворачиваемая карточка с заголовком, шевроном, настройками (`autoSnapshotEnabled`, `maxSnapshots`, `autoHealPrompt`), кнопкой сохранения и лентой чекпоинтов.
  - `Timeline`: Интерактивный список чекпоинтов с полем создания новой метки и кнопками действий: «Diff», «Rollback», «Delete».
  - `TimeMachineTab`: Контейнер для боковой панели BetterSidebar.
  - `DiffModal`: Модальное окно с отображением пофайлового diff в monospace.
- Loading / empty / error / success:
  - Loading: текст «Загрузка…» / «Loading…» / «加载中…» в карточке и списке.
  - Empty: сообщение «Чекпоинтов пока нет» / «No checkpoints yet».
  - Error: вывод текста ошибки красным цветом `var(--dsw-alias-state-error-primary)`.
  - Success: индикатор «Сохранено» / «Saved».
- Формы, валидация и действия:
  - Редактирование настроек разрешено строго в статусе `ready` (`writable = settingsStatus === 'ready'`).
  - Разрушающие действия (`Rollback`, `Delete`) запрашивают явное подтверждение через диалог браузера или флаг `confirm: true`.

## User Flows
- Критические сценарии:
  1. Автоматическое снятие теневого чекпоинта перед началом хода агента (`turn/start`) или запросом подтверждения (`approval/asked`).
  2. Ручное создание именованного чекпоинта пользователем перед рискованным действием.
  3. Просмотр Diff текущего рабочего каталога относительно выбранного чекпоинта.
  4. Безопасный откат рабочего каталога до выбранного чекпоинта без перезаписи указателя ветки `HEAD`.
  5. Автоматическое прореживание чекпоинтов до 3 при успешном завершении хода (`turn/end`).

## Do / Don't
- Do:
  - Использовать `GIT_INDEX_FILE` для изоляции staging area пользователя при создании снапшотов.
  - Использовать `read-tree` + `checkout-index` + `clean -fd` для отката без сдвига `HEAD`.
  - Использовать единую шину `session/event` DSH с fallback на `ctx.events` только при отсутствии нативной шины.
- Don't:
  - Никогда не использовать `git reset --hard` для отката снапшотов.
  - Не модифицировать пользовательский `.git/index` при теневых операциях.
  - Не оставлять «висячие» ссылки `refs/dsh-time-machine/...` в Git при вытеснении чекпоинтов.

## Locked Design Decisions
- 2026-09-02 — Откат выполняется через `read-tree` + `checkout-index -a -f` + `clean -fd` для абсолютной защиты истории коммитов и указателя `HEAD`.
- 2026-09-02 — Настройки регистрируются в слоте `settings.plugin.item` ядра DSH, форма активна строго в статусе `ready`.
- 2026-09-06 — Единая шина событий: нативная `session/event` шина имеет приоритет; legacy `ctx.events` подключается только как fallback при отсутствии `ctx.on` во избежание двойного срабатывания авто-снапшотов.- 2026-09-09 — Двухканальная адаптация сайдбаров: поддержка нативного DSH Right Sidebar (`sidebarRightTabs.register` + `sidebar.right.pane.tab`) для DSH >= 0.1.5-alpha.1 с сохранением обратной совместимости с `betterSidebar.registerTab` для устаревших сборок; отсутствие обеих поверхностей безопасно откатывается на карточку настроек.
