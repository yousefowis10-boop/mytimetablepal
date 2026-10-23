# MyTimetablePal

A school management web app. Today it builds and edits **weekly school timetables**: school setup, subjects, teachers (with per-period availability), classrooms, student groups and their weekly subject requirements, bell schedules, an automatic timetable generator, a drag-and-edit visual timetable with cover teachers, and PDF export per group, teacher or room.

Planned next (see the project brief): an OR-Tools timetable optimizer, roles (admin, staff, teacher, parent, driver), attendance, substitutes, announcements, homework, grades, fees, admissions, pickup, and a school-bus route optimizer with live tracking.

| Part | Folder | Stack |
|---|---|---|
| Backend API | [`backend/`](backend) | Django 5.2 LTS, Django REST Framework, SimpleJWT, PostgreSQL (SQLite locally), WhiteNoise, gunicorn |
| Frontend | [`frontend/`](frontend) | React 19, Vite, Tailwind CSS, React Router, axios |

## Demo accounts

Created by `python manage.py seed_demo` (password can be changed with the `DEMO_PASSWORD` env var before seeding).

| Role | Email | Password |
|---|---|---|
| School admin | `admin@demo.mytimetablepal.com` | `DemoSchool-2026` |

The demo school is "Amman Demo School": 30 class groups (Grades 1–10, sections A–C), 55 teachers, 15 subjects, 35 rooms (incl. science/computer labs and a sports hall), a Sunday–Thursday week with 7 lessons a day and 2 breaks, and one timetable ready to generate.
Teacher, parent and driver demo accounts will be added together with the roles feature.

> These are demo credentials for a demo school, published on purpose. Don't store real data under the demo account.

## Run locally

Requirements: Python 3.12, Node.js 20+.

### Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate          # Windows (Git Bash: source .venv/Scripts/activate)
# source .venv/bin/activate     # macOS / Linux
pip install -r requirements.txt
cp .env.example .env            # then edit if needed; DEBUG=True is fine locally
python manage.py migrate
python manage.py seed_demo
python manage.py runserver 8000
```

API at http://localhost:8000/api/, health check at http://localhost:8000/api/health/.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local      # VITE_API_URL=http://localhost:8000/api
npm run dev
```

Open http://localhost:5173 and log in with the demo admin.

### Tests

```bash
cd backend && python manage.py test api
cd frontend && npm run lint && npm run build
```

GitHub Actions runs both on every push (`.github/workflows/ci.yml`).

## Environment variables

### Backend (`backend/.env`, or Railway service variables)

| Variable | Required | Example / default | Notes |
|---|---|---|---|
| `SECRET_KEY` | **yes** in production | – | Long random string. Generate: `python -c "from django.core.management.utils import get_random_secret_key as k; print(k())"` |
| `DEBUG` | no | `False` | Only `True` on your own machine. |
| `DATABASE_URL` | yes in production | `postgres://user:pass@host:5432/db` | Empty → local SQLite file. On Railway use `${{Postgres.DATABASE_URL}}`. |
| `ALLOWED_HOSTS` | yes | `api.example.com` | Comma-separated. The Railway domain is added automatically. |
| `CORS_ALLOWED_ORIGINS` | yes | `https://mytimetablepal.vercel.app` | The frontend URL(s), comma-separated, with `https://`, no trailing slash. |
| `CSRF_TRUSTED_ORIGINS` | no | `https://api.example.com` | Only needed for the Django admin on a custom domain. |
| `DEMO_PASSWORD` | no | `DemoSchool-2026` | Password used by `seed_demo`. |
| `SEED_DEMO` | no | `true` | On deploy, create the demo school if it is missing. |
| `JWT_ACCESS_HOURS` / `JWT_REFRESH_DAYS` | no | `12` / `7` | Login token lifetimes. |

### Frontend (`frontend/.env.local`, or Vercel project env vars)

| Variable | Example | Notes |
|---|---|---|
| `VITE_API_URL` | `https://mytimetablepal-api.up.railway.app/api` | Backend API base URL, no trailing slash. Baked in at build time — redeploy after changing it. |

## Deploy

### Backend + database on Railway

1. railway.com → **New Project** → **Deploy from GitHub repo** → pick `mytimetablepal`.
2. Open the new service → **Settings** → **Root Directory** = `backend`. Railway then uses `railway.json` at the repo root (Railway reads it from there even with a root directory set): it collects static files at build time; on start it runs `migrate` and `seed_demo --if-missing`, then gunicorn, and health-checks `/api/health/`.
3. In the project canvas: **+ Create** → **Database** → **PostgreSQL**.
4. Service → **Variables**: add `SECRET_KEY` (new random value), `DEBUG=False`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `CORS_ALLOWED_ORIGINS=<your Vercel URL>`.
5. Service → **Settings** → **Networking** → **Generate Domain**.
6. Demo data: set `SEED_DEMO=true` and the start command runs `seed_demo --if-missing` (creates the demo school only if it does not exist yet).

### Frontend on Vercel

1. vercel.com → **Add New… → Project** → import `mytimetablepal`.
2. **Root Directory** = `frontend` (framework is detected as Vite).
3. **Environment Variables**: `VITE_API_URL=https://<railway-domain>/api`.
4. **Deploy**. `frontend/vercel.json` rewrites all routes to the SPA.
5. Put the Vercel URL into the backend's `CORS_ALLOWED_ORIGINS` (Railway redeploys automatically).

## Project layout

```
backend/
  api/                     models, serializers, views, urls, tests
  api/management/commands/seed_demo.py
  rest_app/settings.py     all config from environment variables
  Procfile                 start command (Railway uses /railway.json)
frontend/
  src/config/api.js        reads VITE_API_URL
  src/services/api.js      REST client used by the pages
  src/pages/               one file per screen
```

## Security notes

- Every API endpoint requires a login and only returns data from schools the logged-in user owns; IDs from another school are rejected (`api/tests/test_phase1_security.py`).
- No secrets are in the repository. The old hard-coded `SECRET_KEY` from the original code was never committed here and must not be reused.
- Production runs with `DEBUG=False`, HTTPS redirect, secure cookies and HSTS.
