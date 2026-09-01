# Browser Canvas → Windows

Минимальный вертикальный MVP: пользователь рисует в браузере, выделяет область и отправляет её в Electron-клиент под тем же аккаунтом.

## Состав

- `backend` — FastAPI, PostgreSQL, JWT-аутентификация и персональный WebSocket-канал.
- `web` — Next.js/React/TypeScript/Tailwind + React-Konva canvas формата A4 с кистью, двумя режимами ластика, групповым выделением и переносом объектов, отправкой, настройками рабочей области и двумя демонстрационными AI-режимами.
- `electron` — Windows-клиент с временным сохранением PNG, миниатюрами, просмотром и реальными метаданными.
- `docker-compose.yml` — локальный PostgreSQL.

Изображение находится в PostgreSQL только до подтверждённого скачивания Electron-клиентом. После сохранения во временную папку запись удаляется с сервера.

## Локальный запуск

Весь стек одной командой:

```powershell
.\start-all.cmd
```

Скрипт подготовит зависимости, при необходимости запустит Docker Desktop, поднимет PostgreSQL на `localhost:5433`, запустит API, браузерный клиент и Electron, а затем откроет `http://localhost:3000`. Для остановки всего стека нажмите `Ctrl+C`. Логи находятся в `.runtime`.

Ручной запуск:

1. Создайте конфигурацию и запустите PostgreSQL:

   ```powershell
   Copy-Item .env.example .env
   docker compose up -d postgres
   ```

2. Запустите API:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r backend\requirements-dev.txt
   Set-Location backend
   uvicorn app.main:app --reload
   ```

3. В отдельном терминале запустите браузерный клиент:

   ```powershell
   Set-Location web
   Copy-Item .env.example .env.local
   npm install
   npm run dev
   ```

4. В отдельном терминале запустите Windows-клиент:

   ```powershell
   Set-Location electron
   npm install
   npm start
   ```

Зарегистрируйтесь в браузере кнопкой с иконкой пользователя, затем войдите в Electron теми же логином и паролем. В браузере выберите иконку монитора, протяните рамку по canvas и отпустите кнопку мыши.

## Проверки

```powershell
Set-Location backend
pytest

Set-Location ..\web
npm run typecheck
npm run build

Set-Location ..\electron
npm run check
```
