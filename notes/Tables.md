| Часть | Стек | Зачем |
|---|---|---|
| iPad — основной продукт | Swift + SwiftUI + UIKit/PencilKit | Нормальная работа Apple Pencil, low-latency canvas, нативные жесты, sidebar и iPad UX |
| Браузерный прототип | Next.js + React + TypeScript + Tailwind | Быстро проверить flow: выделил → спросил AI → получил ответ сбоку |
| Windows-тест | C# / .NET 8, маленькое tray-приложение | Получает Sync Clip и кладёт его в Windows clipboard; полноценный Windows Notability пока не нужен |
| Сервер | Python + FastAPI | AI, распознавание, синхронизация, обработка изображений — Python здесь удобнее всего |
| Данные | PostgreSQL + pgvector, сначала через Supabase | Пользователи, заметки, метаданные, материалы курса и будущий RAG без отдельной vector DB |
| Файлы | S3-совместимое object storage, например Cloudflare R2 | PDF, изображения страниц, экспорт canvas; не хранить тяжёлые файлы в Postgres |
| AI | OpenAI Responses API за FastAPI | Отправляем crop выделения + вопрос + контекст и получаем ответ либо структурированный JSON |
