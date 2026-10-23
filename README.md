# MyTimetablePal

A multi-school management web app for schools in Jordan. Any school can sign up, try it free for 30 days and run:

- **Timetables** — an OR-Tools CP-SAT optimizer (no clashes, qualifications, availability, labs, room sizes, locked lessons, teacher limits; weighted preferences for spread, double periods, gaps, morning heavy subjects, home rooms), background jobs with progress, a quality score, plain-language reasons when a timetable is impossible, partial regeneration, a drag-and-edit grid and PDF export.
- **People** — students, parents/guardians, teachers, staff, invitations, Excel import/export.
- **Communication** — announcements with read receipts, calendar, FAQ, messages; in-app, web push and email notifications (SMS/WhatsApp ready but not connected).
- **Daily** — attendance (per day or per lesson) with absence alerts, absence reports from parents, teacher absences with suggested substitutes, pickup/dismissal notices.
- **Learning** — homework, grades, report cards (PDF with the school logo), at-risk flags, exam scheduling with OR-Tools.
- **Office** — fees in JOD (plans, installments, payments, reminders), admissions pipeline, dashboards per role, audit log.
- **Transport** — bus route optimizer (OR-Tools CVRPTW over real road distances), Leaflet maps, a driver PWA with GPS, parent live bus ETA and notifications, location history retention.
- **Platform** — school self-signup with a setup checklist, strict separation between schools, plans (trial / basic / standard / premium) with student limits and module switches, owner panel, per-school branding (logo, colour, working days, terms, grading, currency), people in several schools switch between them.
- **Arabic and English** with full right-to-left layout, Jordan dates and numbers, mobile-first installable PWA.

| Part | Folder | Stack |
|---|---|---|
| Backend API | [`backend/`](backend) | Python 3.12, Django 5.2 LTS, DRF, SimpleJWT, OR-Tools, PostgreSQL (SQLite locally), WhiteNoise, gunicorn |
| Frontend | [`frontend/`](frontend) | React 19, Vite, Tailwind CSS, React Router, i18next, react-leaflet, vite-plugin-pwa |

**Live demo:** https://mytimetablepal.vercel.app (API: https://backend-production-6fd2b.up.railway.app/api/health/)

## Demo accounts

Created by `python manage.py seed_demo`. All use the password **`DemoSchool-2026`** (change with `DEMO_PASSWORD` before seeding).

| Role | Email | What to look at |
|---|---|---|
| School admin (Amman, Premium plan) | `admin@demo.mytimetablepal.com` | Dashboard, timetables, students, fees, transport, settings & branding, audit log |
| Staff (Amman) | `staff@demo.mytimetablepal.com` | Attendance, covers, admissions, fees |
| Teacher (Amman) | `teacher@demo.mytimetablepal.com` | My timetable, attendance sheet, homework, grades |
| Parent (both schools) | `parent@demo.mytimetablepal.com` | Children, live bus, fees, absence report, pickup; school switcher |
| Bus driver (Amman) | `driver@demo.mytimetablepal.com` | Today's routes, start route, mark children picked up / dropped off |
| School admin (Irbid, Standard plan) | `admin.irbid@demo.mytimetablepal.com` | A second school: green branding, no fees/transport modules |

Two demo schools: **Amman Demo School** (30 groups, 55 teachers, 15 subjects, 35 rooms, 825 students, 10 buses, homes spread around Amman, Sunday–Thursday with 7 lessons a day) and **Irbid Demo School** (smaller, different plan and colours). The demo parent has a child in each, to show the school switcher.

The platform owner logs in with the email/password set in `PLATFORM_OWNER_EMAIL` / `PLATFORM_OWNER_PASSWORD` and sees the owner panel (schools, status, plan, student counts, suspend) — totals only, never children's data.

> These are demo credentials for demo schools, published on purpose. Don't store real data under them.

## Run locally

Requirements: Python 3.12, Node.js 20+.

### Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate          # Windows (Git Bash: source .venv/Scripts/activate)
# source .venv/bin/activate     # macOS / Linux
pip install -r requirements.txt
cp .env.example .env            # DEBUG=True is fine locally
python manage.py migrate
python manage.py seed_demo      # about 3 minutes (runs the optimizers); add --skip-solvers for a quick seed
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

Open http://localhost:5173 and log in with a demo account.

### Tests

```bash
cd backend
python manage.py test api ops transport            # permissions, isolation between schools, modules, solver, routes, i18n
python manage.py benchmark_solver --sizes 30x55 60x100 --time-limit 60
python scripts/i18n.py check                       # every server message has Arabic

cd frontend
npm run lint && node scripts/i18n-check.mjs && npm test && npm run build
```

GitHub Actions runs all of this on every push ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

### Translations

- Frontend: the English text is the key; Arabic lives in [`frontend/src/i18n/ar.json`](frontend/src/i18n/ar.json). `node scripts/i18n-check.mjs` lists anything missing.
- Backend: messages use Django gettext; Arabic is in `backend/locale/ar_translations.py` → from `backend/` run `python scripts/i18n.py extract && python locale/ar_translations.py && python scripts/i18n.py compile` to update `locale/ar/LC_MESSAGES/django.po/.mo` (no GNU gettext needed). Notifications are rendered in each recipient's language.

## Environment variables

### Backend (`backend/.env`, or Railway service variables)

| Variable | Required | Example / default | Notes |
|---|---|---|---|
| `SECRET_KEY` | **yes** in production | – | Long random string: `python -c "from django.core.management.utils import get_random_secret_key as k; print(k())"` |
| `DEBUG` | no | `False` | Only `True` on your own machine. |
| `DATABASE_URL` | yes in production | `postgres://user:pass@host:5432/db` | Empty → local SQLite. On Railway: `${{Postgres.DATABASE_URL}}`. |
| `ALLOWED_HOSTS` | yes | `api.example.com` | Comma-separated. The Railway domain is added automatically. |
| `CORS_ALLOWED_ORIGINS` | yes | `https://mytimetablepal.vercel.app` | Frontend URL(s), with `https://`, no trailing slash. |
| `CSRF_TRUSTED_ORIGINS` | no | `https://api.example.com` | Only for the Django admin on a custom domain. |
| `FRONTEND_URL` | yes | `https://mytimetablepal.vercel.app` | Used for links in emails, push notifications and invitations. |
| `PLATFORM_OWNER_EMAIL` / `PLATFORM_OWNER_PASSWORD` | yes | – | `ensure_owner` creates/updates the platform owner account on every start. |
| `SEED_DEMO` | no | `true` | On start, create the demo schools if they are missing. |
| `DEMO_PASSWORD` | no | `DemoSchool-2026` | Password of the demo accounts. |
| `RUN_SCHEDULER` | no | `1` | Runs the periodic jobs (fee reminders, absence alerts, location-history cleanup) in one web process. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | for web push | `mailto:you@example.com` | Generate once with `npx web-push generate-vapid-keys`. |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL` | for email | port `587` | Any SMTP service. Email is skipped while `EMAIL_HOST` is empty. |
| `ROUTING_OSRM_URL` | no | `https://router.project-osrm.org` | Road distances for bus routes. Point this at your own OSRM server in production. |
| `ROUTING_ORS_KEY` / `ROUTING_GOOGLE_KEY` | no | – | Only if a school picks OpenRouteService or Google as its routing provider. |
| `JWT_ACCESS_HOURS` / `JWT_REFRESH_DAYS` | no | `12` / `7` | Login token lifetimes. |
| `LOG_LEVEL` | no | `INFO` | |

### Frontend (`frontend/.env.local`, or Vercel project env vars)

| Variable | Example | Notes |
|---|---|---|
| `VITE_API_URL` | `https://backend-production-6fd2b.up.railway.app/api` | Backend API base URL, no trailing slash. Baked in at build time — redeploy after changing it. |

## Deploy

### Backend + database on Railway

1. railway.com → **New Project** → **Deploy from GitHub repo** → pick `mytimetablepal`.
2. Service → **Settings** → **Root Directory** = `backend`. Railway uses [`railway.json`](railway.json) at the repo root: it collects static files at build time; on start it runs `migrate`, `ensure_owner`, `seed_demo --if-missing` (in the background), then gunicorn, and health-checks `/api/health/`.
3. Project canvas: **+ Create** → **Database** → **PostgreSQL**.
4. Service → **Variables**: the backend variables above.
5. Service → **Settings** → **Networking** → **Generate Domain**.

### Frontend on Vercel

1. vercel.com → **Add New… → Project** → import `mytimetablepal`.
2. **Root Directory** = `frontend` (Vite is detected).
3. **Environment Variables**: `VITE_API_URL=https://<railway-domain>/api`.
4. **Deploy**. [`frontend/vercel.json`](frontend/vercel.json) rewrites all routes to the app.
5. Put the Vercel URL into the backend's `CORS_ALLOWED_ORIGINS` and `FRONTEND_URL`.

## Project layout

```
backend/
  rest_app/settings.py          all config from environment variables
  api/                          schools, platform (signup, plans, owner panel), memberships & access rules,
                                timetable models/views, notifications, audit log, i18n
  api/scheduling/solver.py      CP-SAT timetable solver (pure Python, no Django)
  api/scheduling/exams.py       CP-SAT exam scheduler
  api/timetable_jobs.py         background solver jobs with progress
  ops/                          students, guardians, communication, attendance, covers, homework, grades,
                                exams, fees, admissions, pickup, dashboards, Excel/PDF import/export
  transport/                    buses, route optimizer (optimizer.py), road-distance providers (routing.py),
                                driver runs, live location and ETAs
  locale/                       Arabic translations
frontend/
  src/pages/                    screens grouped by area (timetables, daily, learning, office, transport, admin…)
  src/components/               layout, shared UI, generic list/form page, maps
  src/i18n/ar.json              Arabic text
  src/sw.js                     service worker (offline shell, web push)
```

## Security and privacy

- Every request is checked against the user's membership and role in that school. Other schools' records answer 404; wrong role answers 403. Tests cover separation of every module, PDFs, notifications and bus tracking between two schools (`ops/tests/test_isolation.py`, `ops/tests/test_platform.py`, `transport/tests.py`).
- After a trial ends or a school is suspended, the school becomes read-only; modules not in the plan are switched off on the server, not just hidden.
- Parents only see their own children, their own bus and only while it is on a run. Drivers only see their own bus's runs. Bus GPS history is deleted after the school's retention period (default 7 days).
- The platform owner panel shows totals only (schools, status, plan, number of students).
- Important changes are written to the audit log (who, what, before/after).
- No secrets in the repository. Production runs with `DEBUG=False`, HTTPS redirect, secure cookies and HSTS.

## Services that cost money (not connected)

These are ready in code but need an account and a decision from the school/owner. Prices are rough estimates — check current pricing before choosing.

**SMS / WhatsApp** (`api/notify.py` has the channel stubs):

| Option | Rough cost | Notes |
|---|---|---|
| Local Jordanian SMS aggregators (e.g. through Zain/Orange/Umniah bulk SMS resellers) | ~0.02–0.04 JOD per SMS | Need a registered sender name; cheapest for Jordan only. |
| Unifonic | ~0.03–0.05 USD per SMS to Jordan | Regional provider, Arabic support, also offers WhatsApp. |
| Twilio | ~0.15–0.25 USD per SMS to Jordan | Easiest API, expensive for Jordan. |
| WhatsApp Business Platform (Meta, via Twilio/360dialog/Unifonic) | ~0.01–0.03 USD per "utility" template message + provider fee | Needs a verified Meta business and approved message templates. |

**Road distances for bus routes** (`transport/routing.py`): the public OSRM demo server is used now (free, fair-use only, no guarantee). Options: self-hosted OSRM with the Jordan map (~10–20 USD/month small server, unlimited), OpenRouteService (free tier with daily limits), Google Routes API (~5 USD per 1,000 matrix elements; a 60-stop matrix is 3,600 elements, but results are cached).

**Online fee payments in Jordan** (not connected; the app records payments by cash, bank transfer, cheque or card manually):

- **eFAWATEERcom** — the national bill-payment system; parents pay from any Jordanian bank app. Needs the school onboarded as a biller through a bank.
- **CliQ** (JoPACC instant transfers) — parents send to the school's CliQ alias; can be reconciled by reference.
- **Payment gateways for cards**: HyperPay, PayTabs, Amazon Payment Services (formerly PayFort), Network International / MEPS. Typical cost ~2–3% per card payment plus setup.
- Stripe does not onboard Jordanian merchants directly.

**Hosting** (current): Railway (Hobby plan from ~5 USD/month incl. usage credit; a real deployment with Postgres is roughly 10–25 USD/month) and Vercel (Hobby is free but for non-commercial use; Pro is 20 USD/user/month for a commercial product).
