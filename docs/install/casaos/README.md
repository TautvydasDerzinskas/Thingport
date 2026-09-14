<div align="center">
<img src="icon.png" alt="Thingport" width="96">
</div>

# Running Thingport on CasaOS

Thingport is a 4-container stack (Postgres, FlareSolverr, backend, frontend) that talk to
each other by container name -- the frontend's nginx config, for example, proxies `/api/*`
straight to `http://backend:8000`. CasaOS's App Store is built around single-container
"customized apps" with a compose editor underneath, so the easiest paths are either pasting
the full stack into that editor or running compose yourself over SSH.

## Option A: Install a customized app

1. **App Store** -> **Install a customized app** (the "+" / custom install button, wording
   varies slightly by CasaOS version) -> switch to the **Docker Compose** / YAML editor.
2. Paste in [`docker-compose.yml`](docker-compose.yml) from this folder.
3. Copy [`.env.example`](.env.example) into the environment variables section and fill in:
   - `AUTH_SECRET` -- any random string, e.g. `openssl rand -hex 32` from a terminal
   - `INITIAL_ADMIN_EMAIL` -- the email you'll register with; that account becomes admin
   - `POSTGRES_PASSWORD` -- any password
4. Install/submit the form.

## Option B: Plain `docker compose` over SSH

1. SSH into CasaOS and create a folder for the stack, e.g. under `/DATA/AppData/thingport`.
2. Copy [`docker-compose.yml`](docker-compose.yml) and [`.env.example`](.env.example) into
   it, renaming the latter to `.env` and filling in the same values listed in Option A.
3. From inside that folder, run:
   ```bash
   docker compose up -d
   ```

Either way, Thingport creates two folders on first start:
`/DATA/AppData/thingport/postgres` (database) and `/DATA/AppData/thingport/storage` (your
imported models) -- CasaOS's conventional appdata location, so they show up in the Files
app alongside your other apps' data.

## Open it

Once all 4 containers show healthy/running, open `http://<your-casaos-ip>:<WEB_PORT>`
(default port 80). If you used Option A, CasaOS should also pick up the exposed port and
add a dashboard tile for it automatically; if not, add one manually from the app's
settings.

## Notes

- **Do not rename the `backend` service/container.** The frontend's nginx config resolves
  it by that exact name over the compose network; renaming it breaks `/api/*` requests.
- If the backend can't write to `/DATA/AppData/thingport/storage`, check that folder's
  owning uid/gid and set `PUID`/`PGID` in your `.env` to match.
- Provider setup (MakerWorld / Thingiverse credentials) works the same as any other install
  -- see [`docs/PROVIDER_SETUP.md`](../../PROVIDER_SETUP.md) in the main repo.
- To pin a specific build instead of `:latest`, see the tagging note in
  [`docker-compose.deploy.yml`](../../../docker-compose.deploy.yml) and set `BACKEND_IMAGE`/
  `FRONTEND_IMAGE` accordingly (add those two env vars to the stack and swap the `image:`
  lines to `${BACKEND_IMAGE:-...}` / `${FRONTEND_IMAGE:-...}` if you want that flexibility).
