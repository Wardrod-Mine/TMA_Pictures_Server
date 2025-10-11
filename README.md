Запуск Backend (Node.js) — инструкции

Локально (PowerShell):

1) Установите зависимости:

```powershell
cd Backend
npm install
```

2) Создайте файл `.env` (см. `.env.example`) и заполните значения: `BOT_TOKEN`, `ADMIN_CHAT_IDS`, `APP_URL`, `FRONTEND_URL` и т.д.

3) Запустите сервер:

```powershell
npm start
# или
node index.js
```

По умолчанию сервер слушает порт в переменной `PORT` (или 3000).

Настройка Render (коротко):
- Создайте новый сервис Web в Render, укажите репозиторий.
- В качестве команды сборки/старта используйте `npm install` и `npm start`.
- В разделе Environment -> Environment Variables добавьте значения из `.env` (BOT_TOKEN, ADMIN_CHAT_IDS, APP_URL, FRONTEND_URL и т.д.).
- Укажите порт (Render автоматически задаёт `PORT`), но приложение читает `process.env.PORT`.

Caveats:
- Не храните реальные токены в публичном репозитории.
- Убедитесь, что `FRONTEND_URL` указывает на ваш фронтенд (например: https://your-site/render/Front/index.html) и что CORS разрешает этот origin.
