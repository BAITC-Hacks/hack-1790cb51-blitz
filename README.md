# Blitz

Монорепозиторий с React-клиентом, Python/FastAPI API и PostgreSQL.

## Быстрый запуск в Docker

```bash
copy .env.example .env
docker compose up --build
```

- приложение: http://localhost:5173
- API: http://localhost:8000/api/health
- документация API: http://localhost:8000/docs

## Локальная разработка

Backend:

```bash
cd backend
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend (в отдельном терминале):

```bash
cd frontend
npm install
npm run dev
```

Vite перенаправляет запросы к `/api` на backend `http://localhost:8000`.
