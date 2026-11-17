# AI Receptionist

The first build provides a Next.js owner workspace, a NestJS API, PostgreSQL migrations and tenant isolation, and Redis-backed sign-in limits. The two seeded Canadian businesses let you sign in, edit each business profile separately, and sign out. See [PLAN.md](PLAN.md) for the SRS delivery sequence.

## Run locally

Use Node.js 24 or 26 and Docker Compose. Existing local PostgreSQL and Redis services also work. Apply `db/local-init.sql` as the migration user for a disposable local database if you are using your own PostgreSQL instance.

```powershell
Copy-Item .env.example .env
npm ci
docker compose up -d --wait
npm run db:migrate
```

Set `DEMO_PASSWORD` in `.env` to a local password of at least 14 characters, then run `npm run db:seed`. Re-running the seed updates the demo passwords and revokes their sessions while preserving business profiles.

Start the apps in two terminals.

```powershell
npm run dev:api
npm run dev:web
```

Open [http://localhost:3000](http://localhost:3000) and sign in as `owner@cedar-auto.example` or `owner@harbour-garage.example` with your `DEMO_PASSWORD`. The API readiness route is `http://127.0.0.1:4000/health/ready`. Restart the API after backend source changes.

## Checks

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

The integration test requires migrated development databases and Redis. It creates its own disposable tenants and checks isolation over HTTP and directly through the restricted PostgreSQL role. Run it only with local or CI service URLs.

## Runtime configuration

The API uses `DATABASE_URL` for the restricted `phone_app` role and `REDIS_URL` for rate limits. Keep `MIGRATION_DATABASE_URL` available to migration jobs only. Use an HTTPS `WEB_ORIGIN` in production and set `API_ORIGIN` to the NestJS service address at Next.js build and runtime. The API defaults to loopback; use `API_HOST` when deploying behind private ingress. Apply ingress rate limits at the trusted edge where the original client IP is available.

This build uses seeded verified owners. Signup, email verification, password recovery, agent publishing, voice, billing, and deployment hardening follow the delivery plan.
