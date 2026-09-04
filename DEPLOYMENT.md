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
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build --wait --wait-timeout 120
```

## Резервная копия БД

```bash
mkdir -p backups
docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "backups/aibook-$(date +%F-%H%M%S).sql.gz"
```

Файл `.env.production` нельзя добавлять в Git. Разработчику передаются базовый HTTPS URL и скачанный контракт OpenAPI; пользовательские запросы выполняются с JWT после входа.
