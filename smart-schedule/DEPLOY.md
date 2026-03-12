# Deployment Runbook

## Release Gates

Deploy only after all CI gates pass:
- `npm --prefix smart-schedule run lint`
- `npm --prefix smart-schedule run typecheck`
- `npm --prefix smart-schedule run build`
- `npm --prefix smart-schedule test --if-present`
- `npm --prefix smart-schedule run e2e:smoke`

## Environment Requirements

Set runtime environment variables:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SITE_ADDRESS` (edge proxy host for Caddy)

## Build and Publish

1. Build frontend assets:
   ```bash
   npm --prefix smart-schedule ci
   npm --prefix smart-schedule run build
   ```
2. Build and publish frontend container:
   ```bash
   docker build -f smart-schedule/docker/frontend/Dockerfile -t smart-schedule-frontend:latest smart-schedule
   ```
3. Deploy updated frontend image and restart edge services (`frontend`, `caddy`, `postgrest`, `gotrue`, `realtime`).

## Post-Deploy Verification

1. Confirm health endpoint:
   ```bash
   curl --fail https://<your-host>/healthz
   ```
2. Confirm app loads:
   - `/login` returns 200 and renders sign-in UI.
   - `/callback` redirects authenticated users to `/schedule`.
   - `/schedule` renders page header and data requests complete.
3. Confirm realtime channel status from UI header and browser logs.
4. Confirm frontend error logs are structured (`[frontend_error]` entries in console/log sink).

## Rollback

1. Re-deploy previous known-good frontend image tag.
2. Restart frontend and edge proxy services.
3. Re-run health and schedule-page checks.
4. Record incident details and failing checks before reattempting rollout.

## Operational Notes

- Health checks are exposed at `/healthz` in both static frontend and edge proxy layers.
- Realtime subscriptions use automatic reconnect with exponential backoff.
- Unhandled frontend errors and React Query failures are logged in structured format.
