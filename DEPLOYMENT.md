# Развёртывание приложения на Alibaba ECS

## Что получится

- Web и API доступны через один адрес, например `https://app.example.com`.
- Caddy принимает HTTP/HTTPS, автоматически получает и обновляет TLS-сертификат.
- Next.js, FastAPI и PostgreSQL не публикуют свои порты наружу.
- Данные PostgreSQL и сертификаты сохраняются в Docker volumes.
- Перед запуском API автоматически применяются миграции БД.

## До запуска

1. На ECS должны быть установлены Docker Engine и Docker Compose.
2. DNS-запись типа `A` для API-домена должна указывать на Elastic IP сервера.
3. В Alibaba Security Group должны быть открыты входящие TCP-порты `22`, `80` и `443`. UDP `443` можно открыть для HTTP/3, но это необязательно.
4. Порты `5432` и `8000` открывать нельзя.

## Конфигурация

Скрипт автоматически заполнит весь файл и сгенерирует пароль PostgreSQL и JWT-secret. `API_KEY` для Qwen намеренно останется пустым.

Временная проверка через IP `8.218.46.154` без HTTPS:

```bash
python3 scripts/init-production-env.py --public-url 8.218.46.154
```

Production-запуск с доменом и HTTPS:

```bash
python3 scripts/init-production-env.py \
  --public-url app.example.com \
  --acme-email admin@example.com
```

Если `.env.production` уже существует, скрипт остановится. Флаг `--force` заменит пароль PostgreSQL и JWT-secret, поэтому используйте его только осознанно. Уже введённый `API_KEY` Qwen при этом сохраняется. После первой генерации вручную заполните только `API_KEY`, если AI-функции нужны.

## Запуск

```bash
docker compose --env-file .env.production -f docker-compose.production.yml config --quiet
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build --wait --wait-timeout 120
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

Проверка после выпуска сертификата:

```bash
curl https://app.example.com/health
```

Ожидаемый ответ:

```json
{"status":"ok"}
```

Скачать публичный OpenAPI-контракт для Swift:

```bash
curl https://app.example.com/openapi.json -o openapi.json
```

## Логи и обновление

```bash
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail 200 web api caddy
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

## Обновление API без сборки на ECS

Для сервера с 2 ГБ памяти собирайте образ на ноутбуке. Текущий ECS имеет
архитектуру `linux/amd64`. Например, в PowerShell из корня проекта:

```powershell
New-Item -ItemType Directory -Force .runtime/api-release | Out-Null
docker build --platform linux/amd64 -t aibook-api:release ./backend
docker image save -o .runtime/api-release/api-image.tar aibook-api:release
workbench upload .runtime/api-release/api-image.tar /tmp/ -i i-j6c9ch8it9zx4eziq5pi -f
workbench connect -i i-j6c9ch8it9zx4eziq5pi --new
```

В терминале сервера загрузите образ, сохраните тег предыдущего образа для
отката и пересоздайте только API:

```bash
cd /opt/aibook
docker load -i /tmp/api-image.tar
docker tag aibook-api:local aibook-api:previous
docker tag aibook-api:release aibook-api:local
docker compose --env-file .env.production -f docker-compose.production.yml up -d --no-build --no-deps --wait --wait-timeout 60 api
```

Этот путь подходит для обновления без новых миграций. Если релиз добавляет
миграции, примените их новым образом до перезапуска API. Вместе с образом
обновляйте серверную копию `backend/` из того же коммита, чтобы последующая
сборка из исходников не вернула старую версию. Секреты остаются в существующем
`.env.production`; их не нужно включать в образ или архив исходников.

После обновления проверяйте и `/health`, и наличие маршрутов, необходимых
клиенту. Успешный healthcheck старого API не гарантирует совместимость с новым
iPad-приложением:

```bash
python3 - <<'PY'
import json, urllib.request
with urllib.request.urlopen('http://127.0.0.1/openapi.json') as response:
    paths = json.load(response)['paths']
assert 'get' in paths['/api/ai/chats/{chat_id}']
assert 'post' in paths['/api/ai/chats/{chat_id}/reply']
print('iPad chat routes are available')
PY
```

Для функциональной проверки отправьте в чат PNG и `solve`, продолжите диалог
без нового изображения, затем загрузите историю. Повтор с тем же `request_id`
должен вернуть сохранённую пару сообщений без дубликатов.

## Резервная копия БД

```bash
mkdir -p backups
docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "backups/aibook-$(date +%F-%H%M%S).sql.gz"
```

Файл `.env.production` нельзя добавлять в Git. Разработчику передаются базовый HTTPS URL и скачанный контракт OpenAPI; пользовательские запросы выполняются с JWT после входа.

## Общий релиз web, API и почерка

### Подключение с Windows через Workbench

Для используемого международного аккаунта проверен Workbench CLI 1.0.1 с
`workbench_endpoint: "ecs-workbench-intl.aliyuncs.com"` внутри активного профиля
`%USERPROFILE%\.workbench\config.json`. Корневое одноимённое поле CLI не использует.
Не заменять файл конфигурации шаблоном: он содержит существующие credentials.

Проверенный запуск при проблеме TLS-рукопожатия этой версии CLI:

```powershell
$env:GODEBUG = "http2client=0,tlsmlkem=0,tlskyber=0"
workbench exec -i i-j6c9ch8it9zx4eziq5pi --command "docker ps" --output json
```

Настройка среды относится к текущей PowerShell-сессии. Session Manager включён
пользователем для всех регионов аккаунта 7 сентября; это дополнительный канал,
а не замена правильному endpoint. Во время диагностики общий китайский endpoint
ожидал около 15 секунд и переходил к Session Manager; международный открывал
обычный SSH-сеанс примерно за 6–7 секунд. HTTP и контейнеры ECS при этом работали.
Перед перезапуском ECS отличать сбой подключения CLI от недоступности сервера.

### Сборка и запуск

Local и prod используют одну Compose-конфигурацию, но разные базы и секреты.
`handwriting-worker` берёт задания из PostgreSQL по одному; образ общий с web.
Лимит памяти — 768 MiB, V8 — 512 MiB. Web получает PGHOST, PGDATABASE, PGUSER,
PGPASSWORD из существующих параметров БД. Файловый bind mount для датасетов больше
не нужен. Caddy направляет `/api/handwriting/*` в web, остальные `/api/*` — в API.

Собирать на ноутбуке из чистого коммита, на ECS запускать готовые образы:

```powershell
$releaseRevision = git rev-parse HEAD
docker build --platform linux/amd64 --build-arg REVISION=$releaseRevision -t aibook-api:$releaseRevision ./backend
docker build --platform linux/amd64 --build-arg REVISION=$releaseRevision --build-arg NEXT_PUBLIC_API_URL= -t aibook-web:$releaseRevision ./web
docker image save -o .runtime/release-images.tar aibook-api:$releaseRevision aibook-web:$releaseRevision
git archive --format=tar.gz -o .runtime/release-source.tar.gz $releaseRevision
workbench upload .runtime/release-images.tar /tmp/ -i i-j6c9ch8it9zx4eziq5pi -f
workbench upload .runtime/release-source.tar.gz /tmp/ -i i-j6c9ch8it9zx4eziq5pi -f
```

На сервере сначала сохранить pg_dump, исходники и теги предыдущих образов в
`/opt/aibook-backups/<release>`. Затем загрузить образы, распаковать git-архив в
`/opt/aibook`, сохранив `.env.production`, и назначить теги `aibook-api:local` /
`aibook-web:local`. В git-архиве нет локальных секретов и датасетов. Проверить
SHA-256 файлов и `org.opencontainers.image.revision` у обоих образов.

```bash
cd /opt/aibook
docker compose --env-file .env.production -f docker-compose.production.yml run --rm --no-deps migrate
docker compose --env-file .env.production -f docker-compose.production.yml up -d --no-build --no-deps --wait --wait-timeout 120 api web handwriting-worker
```

Если менялся `Caddyfile`, сравнить SHA-256 файла на хосте и внутри Caddy.
При распаковке tar файл может получить новый inode, а bind mount работающего
контейнера останется на старом. При несовпадении требуется пересоздать Caddy:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d --no-build --no-deps --force-recreate --wait --wait-timeout 60 caddy
```

Если обе копии совпадают, достаточно `caddy reload --config /etc/caddy/Caddyfile
--adapter caddyfile` внутри контейнера. Одна только успешная команда reload не
доказывает, что новые правила действительно прочитаны; проверить маршруты HTTP.

Миграция `20260907_0005` добавляет роли, источники, бинарные assets, очередь и
публикации. Заметки и аккаунты сохраняются; старые аккаунты получают роль user.
Выбранному существующему аккаунту администратора назначить роль отдельно.
По указанию владельца проекта в production роль dev назначена аккаунту `aman`:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec -T api python -m app.manage grant-dev aman
```

Имя dev само по себе не даёт привилегий; регистрация не назначает роль.

### Перенос старой библиотеки

Архивировать исходный `data/handwriting/datasets`. Передать архив на сервер и
распаковать в отдельный временный каталог. Владельцем становится указанный
dev-аккаунт production; локальные пароли, пользователи и заметки не переносятся.

```bash
docker cp /tmp/datasets aibook-production-web-1:/tmp/legacy-datasets
docker compose --env-file .env.production -f docker-compose.production.yml exec -T web node dist/handwriting-migrate.mjs /tmp/legacy-datasets aman
```

Импорт проверяет отпечатки и решения, сохраняет образцы, историю, одобрение и
актуальный анализ. Повторный запуск пропускает существующие наборы. Публикация —
отдельное действие Publish в `/dev`: перенос не публикует исходники автоматически.
Сравнить число образцов/решений и статусы; сохранить исходный архив.

### Проверка и откат

Проверить `/health`, маршруты групп и чатов в `/openapi.json`, вход `/dev` с
dev-ролью и `/handwriting` с обычным аккаунтом. Без токена запрос
`/api/handwriting/datasets` должен вернуть 401, а не FastAPI 404. Проверять
загрузку, изоляцию, очередь и публикацию на синтетических образцах, не одобрять
личные данные ради теста. Версию образов проверять по Docker label.

Для отката остановить worker, восстановить предыдущие исходники, Caddy и теги
образов. Добавленные таблицы совместимы со старым приложением: не выполнять
alembic downgrade и не удалять PostgreSQL volume. При восстановлении pg_dump
отдельно учитывать данные, записанные после резервной копии.

### Проверенный деплой 7 сентября 2026

- ECS запущен на образах web/API `204ed5d8d298d108c228dfd193a32f7d3a05ac6c`,
  собранных на Windows под linux/amd64; worker использует тот же web-образ.
- Перед обновлением сохранены БД и исходники в
  `/opt/aibook-backups/handwriting-204ed5d-20260907-031334`; предыдущие образы
  отмечены `aibook-api:rollback-204ed5d` и `aibook-web:rollback-204ed5d`.
- На `aman` перенесены 2 набора: 20 и 312 образцов, всего 316 принятых.
  Сохранены решения и 2 завершённых анализа. Повторный импорт не создаёт дублей.
- Проверены публичные `/health`, `/`, `/dev`, `/handwriting`, маршруты групп/
  чатов и 401 на handwriting API без авторизации. Изолированный интеграционный
  тест на ECS проверил загрузку, роли, владельцев, гонки, worker и неизменяемую
  публикацию; его аккаунты и данные удалены по точным ID.
- Реальные наборы автоматически не публиковались. Их публикация для общего
  каталога выполняется действием Publish в `/dev`.
