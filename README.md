# MeetSpace

Готовый MVP сайта видеоконференций на Next.js + LiveKit.

## Возможности

- создание комнаты по уникальной ссылке;
- подключение нескольких участников;
- камера и микрофон;
- демонстрация экрана;
- текстовый чат;
- список участников;
- адаптивный интерфейс.

## 1. Что установить

Нужны:

- Node.js 20+
- npm
- аккаунт LiveKit Cloud или собственный LiveKit Server.

## 2. Установка

```bash
npm install
```

Скопируйте `.env.example` в `.env.local`.

```bash
cp .env.example .env.local
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

В `.env.local` укажите:

```env
LIVEKIT_API_KEY=ваш_api_key
LIVEKIT_API_SECRET=ваш_api_secret
NEXT_PUBLIC_LIVEKIT_URL=wss://ваш-проект.livekit.cloud
```

## 3. Запуск

```bash
npm run dev
```

Откройте:

http://localhost:3000

Создайте комнату и откройте полученную ссылку в другом браузере/на другом устройстве.

## Важно

Этот проект — MVP. Авторизация пользователей, база данных, права организатора, запись конференций, модерация и защита от злоупотреблений пока не добавлены.

Для production рекомендуется:

1. добавить регистрацию и авторизацию;
2. хранить пользователей/встречи в PostgreSQL;
3. сделать серверную проверку прав на комнаты;
4. ограничить частоту выдачи токенов;
5. добавить HTTPS;
6. настроить домен;
7. добавить TURN/сетевую конфигурацию при самостоятельном размещении LiveKit;
8. добавить страницу политики конфиденциальности и условия использования.

## Структура

```text
app/
  api/token/route.ts       # выдаёт LiveKit JWT
  room/[room]/page.tsx     # страница комнаты
  room/[room]/room-client.tsx
  home-client.tsx
  page.tsx
  layout.tsx
  globals.css
```
