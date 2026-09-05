# AIbook

Цель продукта — приложение для ведения заметок с ИИ, встроенным в холст. ИИ должен анализировать записи и выделенные области, отвечать и объяснять прямо на холсте. Чат — одна из функций.

## Как работаем

- Пользователь работает на этом Windows-ноутбуке. Здесь редактируются исходники и запускается локальный Docker для проверки работы приложения.
- Помощник работает на Mac, где собирается iPad-версия. Изменения iPad нужно пушить в Git без предварительной сборки и тестов на Windows. Затем на Mac запускается build и исправляются ошибки.
- Основной проект: `C:\work\vibecodedshit\aibook` — [GitHub](https://github.com/splf-jojo/Aibook).
- iPad: `C:\work\vibecodedshit\aibook-ipad\I-am-a-borad` — [GitHub](https://github.com/supanailkitt/I-am-a-borad).

## Сервер

Alibaba Cloud ECS, Hong Kong: `8.218.46.154`, 2 vCPU, 2 ГБ RAM, Ubuntu 24.04. Проект на сервере: `/opt/aibook`.

Подключение из терминала через настроенный Workbench CLI:

```powershell
workbench connect -i i-j6c9ch8it9zx4eziq5pi --new
```

Docker-образы собираются на ноутбуке для `linux/amd64`, затем передаются на ECS. На сервере тяжёлую сборку не запускать.

Подробные правила: [AGENTS.md](AGENTS.md). Деплой: [DEPLOYMENT.md](DEPLOYMENT.md). Контракт API: [API.md](API.md).
