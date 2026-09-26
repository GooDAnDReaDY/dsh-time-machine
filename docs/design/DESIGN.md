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
- 2026-09-26 — Строгая политика защиты HTTP-маршрутов и запрет same-site запросов (Gitea #38):
  1) Функция `isTrustedSettingsRequest` переведена на строгий fail-closed режим с обязательным отклонением `sec-fetch-site: same-site` и `sec-fetch-site: cross-site`, что исключает возможность несанкционированных запросов с соседних поддоменов.
  2) Для запросов не с loopback требуется обязательное совпадение `Origin` или `Referer` с заголовками `Host` / `X-Forwarded-Host`. Запросы от сторонних хостов без доверенных заголовков или с несовпадающим origin отклоняются со статусом 403 Forbidden.
  3) Запросы с локального loopback (`127.0.0.1`, `::1`) без Origin/Referer (внутренние CLI-вызовы) разрешены при отсутствии запрещающих `sec-fetch-site`.
  4) Все мутирующие маршруты (`/create`, `/delete`, `/prune`, `/rollback`, `/rollback-file`) строго ограничены методом `POST` (ответ `405 Method Not Allowed` для других методов), а деструктивные действия требуют явного подтверждения (`confirm: true`).
- 2026-09-17 — Контракт вывода инструментов DSH и runtime-лимит снимков (Gitea #47, #48, GitHub #3, #4, PR #5):
  1) Внедрен обязательный контракт вывода `output: TM_OUTPUT` для всех 7 зарегистрированных инструментов рабочей области (`time_machine_checkpoint_create`, `time_machine_checkpoint_list`, `time_machine_checkpoint_rollback`, `time_machine_file_rollback`, `time_machine_diff`, `time_machine_checkpoint_delete`, `time_machine_checkpoint_prune`). Схема контракта объявлена открытой (`{ type: 'object', properties: { success: { type: 'boolean' } } }` без `additionalProperties: false`), а функция `render` возвращает канонический массив текстовых блоков DSH (`[{ type: 'text', text }]`), что гарантирует успешную регистрацию инструментов в `@deepseek-ai/dsh-tools`.
  2) Восстановлен метод `setMax(maxSnapshots, targetCwd)` в классе `ShadowSnapshotEngine` с вызовом через асинхронную очередь `_enqueue` и обрезкой `_trimFor(sessionId, targetCwd)`. Обеспечено корректное ограничение значений (`Math.max(1, Number(maxSnapshots) || 20)`), удаление вытесненных ссылок Git (`git update-ref -d`) и бесперебойная работа наблюдателя `scope.watch(syncMax)`.
- 2026-09-16 — Комплексное закрытие аудита (v0.1.17, Gitea #39, #40, #41, #42, #43, #44):
  1) Добавлен встроенный модуль автообновления (`lib/updater.js` + маршрут `/api/dsh-time-machine/update` + UI-блок `PluginUpdaterBox` в карточке настроек).
  2) Устранены все hardcoded rgba-цвета (11 вхождений заменены на системные переменные темы `--dsw-alias-*`).
  3) Локализация очищена от прямых ссылок на необъявленный `ru` в бандле клиентской половины, регистрация словарей обёрнута в `ctx.effect`.
  4) В `package.json` объявлены явные зависимости слотов в `dsh.client.inject` (`@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-ui-settings`, `@deepseek-ai/dsh-client-ui-sidebar`), исключены служебные файлы из git-отслеживания и npm-пакета.
  5) Движок снапшотов защищён от тихого глушения ошибок: при падении `read-tree` восстанавливаемого staged area выбрасывается явное исключение.
- 2026-09-16 — Усиление безопасности API (Gitea #38) и дедупликация регистрации сайдбара (GitHub #2):
  1) Функция `isTrustedSettingsRequest` переведена на строгий fail-closed режим (проверка loopback `127.0.0.1`/`::1`/`::ffff:127.0.0.1`, `sec-fetch-site` строго `same-origin`/`none`, сверка `origin` с `host`, поддержка Bearer-токена и cookie).
  2) На всех пяти мутирующих HTTP-маршрутах (`/create`, `/delete`, `/prune`, `/rollback`, `/rollback-file`) внедрена обязательная проверка `req.method === 'POST'` с ответом `405 Method Not Allowed`, а на маршрутах чтения (`/snapshots`, `/diff`) — проверка `req.method === 'GET'`.
  3) Разрешён конфликт одновременной регистрации вкладки сайдбара в DSH >= 0.1.6-alpha.1 при сосуществовании `sidebarRightTabs` и `betterSidebar`: введён единый разделяемый маркер `tabRegistered` с приоритетом нативного сайдбара ядра и безопасным подавлением ошибок вида `already registered`.
- 2026-09-13 — Селективный откат файлов (rollbackFile) и защита пользовательского staging (stagedTreeHash): точечное восстановление файла из дерева коммита снапшота без перезаписи рабочего дерева всего проекта; фиксация хэша дерева staging при создании снапшота; пофайловая навигация в Diff Modal и автоматические чекпоинты перед рискованными вызовами инструментов (pre-tool checkpoints); устранение локальной русификации в бандле плагина (строго en/zh локали, внешняя русификация через dsh-russian-lang).
- 2026-09-02 — Откат выполняется через `read-tree` + `checkout-index -a -f` + `clean -fd` для абсолютной защиты истории коммитов и указателя `HEAD`.
- 2026-09-02 — Настройки регистрируются в слоте `settings.plugin.item` ядра DSH, форма активна строго в статусе `ready`.
- 2026-09-06 — Единая шина событий: нативная `session/event` шина имеет приоритет; legacy `ctx.events` подключается только как fallback при отсутствии `ctx.on` во избежание двойного срабатывания авто-снапшотов.
- 2026-09-09 — Двухканальная адаптация сайдбаров: поддержка нативного DSH Right Sidebar (`sidebarRightTabs.register` + `sidebar.right.pane.tab`) для DSH >= 0.1.5-alpha.1 с сохранением обратной совместимости с `betterSidebar.registerTab` для устаревших сборок; отсутствие обеих поверхностей безопасно откатывается на карточку настроек.
- 2026-09-10 — Устранена регистрация top-level раздела `settings.section` из fallback: согласно регламенту DSH, настройки плагина регистрируются исключительно карточкой `settings.plugin.item` без захвата глобального сайдбара настроек; разрешение сервиса настроек переведено на безопасный `ctx.get('settingsScope')`.
- 2026-09-10 — Гармонизация интерфейса со стандартом dsh-clinebot: внедрены нативные дизайн-токены (--dsw-alias-*), интерактивные статусные бейджи (tm-badge-ok/warn/bad), дифференциация кнопок (.tm-btn-primary, .tm-btn-danger) и CSRF-защита мутирующих маршрутов (isTrustedSettingsRequest). Автоочистка временных индексов подключена к стартовой инициализации.

