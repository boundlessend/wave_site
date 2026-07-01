# AUDIT - Длина волны

Полный аудит проекта + пентест прода (2026-07-01). Важность: crit/high/med/low/nit.

Статус: все пункты 1-27 сделаны (2026-07-01), закоммичены волнами. Оговорки по модели
общего секрета (приглашённые доверены by design, серверной авторизации нет):
- 4: actorId привязан к отправителю по подписанной presence — отсекает чужого без секрета;
  приглашённого griefer'а с секретом полностью не остановить без per-device ключей (принято).
- 7: клампы длины имени/подсказки на хосте есть; авторизация лобби-действий
  (reset/toLobby/setMode) для приглашённых не вводилась — в пределах доверия комнаты.
- 8: connect-src запинен на поддомен проекта; style-src 'unsafe-inline' оставлен
  (нужен инлайн-стилям React, XSS-поверхности нет).

## Безопасность (realtime-модель)

Канал Supabase `room-${code}` не приватный + publishable-ключ в бандле: зная только код,
можно подписаться на канал, читать broadcast и переигрывать сообщения. HMAC даёт целостность,
но не доступ и не конфиденциальность.

- [x] 1 [med-high] Нет `default` в `reduce` → неизвестный `type` обнуляет `state`; replay подписанного сообщения как `action` роняет комнату (нужен только код). engine.ts. Фикс: `default: return state` + валидация типа.
- [x] 2 [med] HMAC подписывает только payload, не тип события/канал; нет nonce/seq/времени → подмена `state`↔`action`, replay. supabase.ts. Фикс: подписывать `event|code|seq|nonce|payload`, хранить last-seen seq.
- [x] 3 [med] Presence-auth подписывает только `clientId` → спуф присутствия (фантомы, выбивание игрока, влияние на хоста). supabase.ts. Фикс: подписывать весь presence-рекорд.
- [x] 4 [med] `actorId` задаётся клиентом, не привязан к подписавшему → приглашённый шлёт действия за чужую роль. engine.ts + useRoom.ts + supabase.ts. Фикс: карта `clientId→playerId` из подписанного presence, проверка на хосте.
- [x] 5 [low-med] Нет rate-limit на входящие; `hello`→полный `state` = амплификация → выжигание realtime-квоты / CPU-DoS. supabase.ts. Фикс: троттлинг входящих, debounce ответа на `hello`.
- [x] 6 [low] `genCode` на `Math.random()`; broadcast не шифруется → знающий код читает трафик. App.tsx. Фикс: `crypto.getRandomValues`.
- [x] 7 [low] Лобби-действия (`reset`/`toLobby`/`setMode`/`join`) и длина строк не валидируются на хосте → griefing. engine.ts. Фикс: клампы длины/набора, авторизация лобби-действий.
- [x] 8 [nit] CSP: `unsafe-inline` в style-src, wildcard `*.supabase.co` в connect-src. vercel.json. Фикс: запинить конкретный поддомен проекта.

## Корректность / логика

- [x] 9 [med] Coop-софтлок: все на «right» → `activeTeam='right'`, а `startGame` переносит всех в «left» → раунд залипает. useRoom.ts + engine.ts. Фикс: для coop форсировать `activeTeam='left'`.
- [x] 10 [med] Уход всей второй команды в фазе `leftright` вешает раунд (авто-скип ловит только выход телепата). useRoom.ts. Фикс: проверять наличие игроков во второй команде.
- [x] 11 [low-med] Секрет мишени не пересоздаётся между играми (дедуп по `roundNo`, он обнуляется при `reset`). useRoom.ts. Фикс: сбрасывать `secretRound=-1`/`secret=null` при входе в лобби.
- [x] 12 [low] `parseInvite` принимает ссылку без `#k` (secret=`''`) → тихий вечный «Подключение…». App.tsx. Фикс: `return null` при пустом секрете.
- [x] 13 [low] `checkWinner` при равенстве ≥10 даёт `'tie'`→gameover вопреки комментарию «доигрываем». rules.ts. Фикс: согласовать комментарий/поведение.
- [x] 14 [low] `moveNeedle` не клампит `pos` 0..100; `submitClue` принимает пустую строку. engine.ts. Фикс: клампы/гарды в reduce.
- [x] 15 [low] Копирование ссылки: «скопировано» показывается даже при отказе `clipboard.writeText`. Game.tsx. Фикс: обрабатывать промис.

## Производительность / бандл

- [x] 16 [high, главный рычаг] ~680 КБ неиспользуемых частей `@supabase/supabase-js` в главном чанке; нужен только Realtime. Переход на `@supabase/realtime-js` ≈ −40-55 КБ gzip. supabase.ts.
- [x] 17 [low] Нет vendor-чанка → любая правка кода сбрасывает кэш всего 561 КБ чанка. vite.config.ts. Фикс: `manualChunks`.
- [x] 18 [med] Scene3D без ограничения FPS + пересчёт всей геометрии каждый кадр, `antialias:true`. Scene3D.tsx. Фикс: троттлить ~30 fps, `antialias:false`, цвет `dots` реже.
- [x] 19 [med] Шрифты: синхронный Google Fonts CSS блокирует рендер, ~12 начертаний, без fallback-метрик. index.html/index.css. Фикс: сократить веса, preload/async, `size-adjust`.

## Доступность (эдиториал)

- [x] 20 [med] Контраст: синее число на активном тёмном табло 2.17:1 (провал); также placeholder 2.96:1, красный текст ошибки 4.33:1. game.css. Фикс: осветлить командный цвет на `.score.active`, затемнить placeholder/ошибку.
- [x] 21 [med] framer-motion игнорирует `prefers-reduced-motion`. Фикс: `<MotionConfig reducedMotion="user">` на корне.
- [x] 22 [med] BgPicker: нет Escape/фокус-менеджмента/ARIA; триггер 40px (<44px). BgPicker.tsx. Фикс: Escape+фокус, `role=menu`/`aria-*`, 44px.
- [x] 23 [low] Нет единого `:focus-visible`; `.field:focus` снимает outline. game.css. Фикс: общий `:focus-visible`.
- [x] 24 [low] Тач-таргеты чипов ~38px (<44px) на мобильном. game.css. Фикс: больше вертикального паддинга на мобильном.

## Конфиг / качество

- [x] 25 [high, дёшево] `strict` в TS фактически выключен (нет `"strict"` в tsconfig). `tsc --strict` уже зелёный. tsconfig.*.json. Фикс: `"strict": true`.
- [x] 26 [nit] CI дважды гоняет `tsc`. ci.yml. Фикс: убрать дубль.
- [x] 27 [nit] `robots.txt` 404. Фикс: добавить `public/robots.txt`.

## Пентест-позитив (подтверждено, не проблемы)

Полный CSP, HSTS preload, X-Frame DENY, nosniff, Referrer/Permissions-Policy; source maps не отдаются;
Supabase REST 401 и таблиц нет; signup отключён; `npm audit` 0 уязвимостей; XSS нет; секрет в hash не утекает.

## План работ (волны: легче → сложнее; коммиты lowercase en)

- Волна 1 (config): 25, 8, 26, 27
- Волна 2 (лёгкие правки): 1, 13, 14, 12, 15, 6
- Волна 3 (логика): 9, 10, 11
- Волна 4 (a11y/css): 20, 23, 24, 21, 22
- Волна 5 (перф): 17, 18, 19
- Волна 6 (security realtime): 2, 3, 5, 7, 4
- Волна 7 (главный рычаг): 16

Параллельность: внутри волны правки в разных файлах делаются вместе; общий файл
(supabase.ts, game.css) правится согласованно одним проходом. Каждая волна: check + lint + build,
затем коммит.
