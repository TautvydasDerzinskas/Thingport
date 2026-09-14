<div align="center">
<img src="icon.png" alt="Thingport" width="96">
</div>

# Running Thingport on Unraid

Thingport is a 4-container stack (Postgres, FlareSolverr, backend, frontend) that talk to
each other by container name -- the frontend's nginx config, for example, proxies `/api/*`
straight to `http://backend:8000`. Unraid's Community Applications store only installs one
container per template with no built-in way to wire multiple templates together on a shared
network, so Thingport is **not searchable in the CA app store**. Instead, install it as a
Docker Compose stack, which Unraid supports natively (7.2+) or via a Community Applications
plugin.

## 1. Get a Compose stack manager

- **Unraid 7.2+**: the Docker tab has a built-in **Compose** section -- skip to step 2.
- **Older Unraid**: install **Compose Manager Plus** (or **Compose Manager**) from
  Community Applications (Apps tab -> search "Compose Manager").

## 2. Create the stack

1. Docker tab -> **Compose** -> **Add New Stack**, name it `thingport`.
2. Open the stack's compose file and paste in [`docker-compose.yml`](docker-compose.yml)
   from this folder (or point the plugin's "Import from URL" at the raw GitHub URL for
   that file, if it supports it).
3. Copy [`.env.example`](.env.example) into the stack's environment variables (Compose
   Manager exposes an `.env` editor per stack) and fill in:
   - `AUTH_SECRET` -- any random string, e.g. `openssl rand -hex 32` from a terminal
   - `INITIAL_ADMIN_EMAIL` -- the email you'll register with; that account becomes admin
   - `POSTGRES_PASSWORD` -- any password
4. **Compose Up**.

Thingport creates two appdata folders on first start:
`/mnt/user/appdata/thingport/postgres` (database) and
`/mnt/user/appdata/thingport/storage` (your imported models). Back these up like any other
appdata share.

## 3. Open it

Once all 4 containers show healthy/running, open `http://<your-unraid-ip>:<WEB_PORT>`
(default port 80). The frontend and backend containers also get a WebUI button and the
Thingport icon in the Docker tab, via the `net.unraid.docker.*` labels already set in the
compose file.

## Notes

- **Do not rename the `backend` service/container.** The frontend's nginx config resolves
  it by that exact name over the compose network; renaming it breaks `/api/*` requests.
- Provider setup (MakerWorld / Thingiverse credentials) works the same as any other install
  -- see [`docs/PROVIDER_SETUP.md`](../docs/PROVIDER_SETUP.md) in the main repo.
- To pin a specific build instead of `:latest`, see the tagging note in
  [`docker-compose.deploy.yml`](../docker-compose.deploy.yml) and set `BACKEND_IMAGE`/
  `FRONTEND_IMAGE` accordingly (add those two env vars to the stack and swap the `image:`
  lines to `${BACKEND_IMAGE:-...}` / `${FRONTEND_IMAGE:-...}` if you want that flexibility).
