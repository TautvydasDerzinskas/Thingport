<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/logos/thingport-lockup-compact-on-dark.svg">
  <img src="frontend/src/assets/logos/thingport-lockup-compact-color.svg" alt="Thingport" width="320">
</picture>

<h3>Your personal 3D model library.</h3>

<p>
Collect, organize, preview, and manage your 3D printing models<br>
from the places where you discover them.
</p>

<p>
  <a href="https://thingport.net/"><b>Website</b></a> ·
  <a href="https://thingport.net/docs/">Docs</a> ·
  <a href="https://thingport.net/features/">Features</a> ·
  <a href="https://thingport.net/blog/">Blog</a>
</p>

<p>
  <a href="https://thingport.net/"><img src="https://github.com/TautvydasDerzinskas/Thingport/actions/workflows/web-pages.yml/badge.svg" alt="Website build"></a>
  <img src="https://github.com/TautvydasDerzinskas/Thingport/actions/workflows/frontend-image.yml/badge.svg" alt="Frontend">
  <img src="https://github.com/TautvydasDerzinskas/Thingport/actions/workflows/backend-image.yml/badge.svg" alt="Backend">
  <img src="https://github.com/TautvydasDerzinskas/Thingport/actions/workflows/bridge-release.yml/badge.svg" alt="Slicer Bridge">
  <img src="https://github.com/TautvydasDerzinskas/Thingport/actions/workflows/extension-release.yml/badge.svg" alt="Thingport Grab">
  <a href="https://github.com/TautvydasDerzinskas/Thingport/actions/workflows/regression.yml"><img src="https://github.com/TautvydasDerzinskas/Thingport/actions/workflows/regression.yml/badge.svg" alt="Regression pack"></a>
</p>

</div>

## About

To put it simply, if you're into 3D printing, you probably look for models across multiple platforms, with **MakerWorld, Printables, Thingiverse, and MyMiniFactory** being some of the most popular ones. And, if you're anything like me, you've probably built up quite a collection of bookmarked models across these sites.

But there's a problem.

Sometimes, authors remove their models, and when you come back looking for something you bookmarked months ago, it's simply gone. Other times, authors update their models, and you discover that you actually preferred the older version.

And sometimes... the internet goes down. 🙃

Wouldn't it be nice to have your entire collection available locally, even when you're offline?

That's exactly what **Thingport** is here to solve.

**Thingport is a self-hosted 3D model library designed to make importing and syncing models between your own library and external providers as seamless as possible.**

You can sync collections from supported providers directly to your Thingport instance. And with collection syncing enabled, new models you bookmark on external sites can be automatically imported into your personal library.

No more worrying about losing access to your favourite models. Your library stays yours.

## Screenshots

Have in mind that these screenshots follow your GitHub theme (matches it). Thingport has a light and a dark theme, or follows your system's.

<table>
  <tr>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/01_dashboard.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/01_dashboard.png"><img src="frontend/src/assets/screenshots/light/01_dashboard.png" width="100%" alt="Dashboard"></picture></a><br><sub><b>Dashboard</b></sub></td>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/02_dashboard_customize.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/02_dashboard_customize.png"><img src="frontend/src/assets/screenshots/light/02_dashboard_customize.png" width="100%" alt="Dashboard in edit mode, Customize dashboard dialog on Panels"></picture></a><br><sub><b>Customize Dashboard</b></sub></td>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/03_dashboard_configuration.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/03_dashboard_configuration.png"><img src="frontend/src/assets/screenshots/light/03_dashboard_configuration.png" width="100%" alt="Configuration dialog, Providers section"></picture></a><br><sub><b>Configuration — Providers</b></sub></td>
  </tr>
  <tr>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/04_models.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/04_models.png"><img src="frontend/src/assets/screenshots/light/04_models.png" width="100%" alt="Models"></picture></a><br><sub><b>Models</b></sub></td>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/05_models_download.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/05_models_download.png"><img src="frontend/src/assets/screenshots/light/05_models_download.png" width="100%" alt="Three selected models and the download dialog"></picture></a><br><sub><b>Download Models</b></sub></td>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/06_model_details.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/06_model_details.png"><img src="frontend/src/assets/screenshots/light/06_model_details.png" width="100%" alt="Model details"></picture></a><br><sub><b>Model Details</b></sub></td>
  </tr>
  <tr>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/07_model_3d_preview.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/07_model_3d_preview.png"><img src="frontend/src/assets/screenshots/light/07_model_3d_preview.png" width="100%" alt="3D preview of a model's plates"></picture></a><br><sub><b>3D Preview</b></sub></td>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/08_model_print_quality.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/08_model_print_quality.png"><img src="frontend/src/assets/screenshots/light/08_model_print_quality.png" width="100%" alt="Print quality dialog listing a model's problems"></picture></a><br><sub><b>Print Quality Checks</b></sub></td>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/09_collections.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/09_collections.png"><img src="frontend/src/assets/screenshots/light/09_collections.png" width="100%" alt="Collections"></picture></a><br><sub><b>Collections</b></sub></td>
  </tr>
  <tr>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/10_collections_merge.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/10_collections_merge.png"><img src="frontend/src/assets/screenshots/light/10_collections_merge.png" width="100%" alt="Merge dialog for three selected collections"></picture></a><br><sub><b>Merge Collections</b></sub></td>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/11_tags.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/11_tags.png"><img src="frontend/src/assets/screenshots/light/11_tags.png" width="100%" alt="Tags"></picture></a><br><sub><b>Tags</b></sub></td>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/12_tags_select.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/12_tags_select.png"><img src="frontend/src/assets/screenshots/light/12_tags_select.png" width="100%" alt="Tags in selection mode"></picture></a><br><sub><b>Select Tags</b></sub></td>
  </tr>
  <tr>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/13_downloads.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/13_downloads.png"><img src="frontend/src/assets/screenshots/light/13_downloads.png" width="100%" alt="Downloads"></picture></a><br><sub><b>Downloads</b></sub></td>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/14_profile.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/14_profile.png"><img src="frontend/src/assets/screenshots/light/14_profile.png" width="100%" alt="Profile with activity heatmap"></picture></a><br><sub><b>Profile &amp; Activity</b></sub></td>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/15_profile_configuration.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/15_profile_configuration.png"><img src="frontend/src/assets/screenshots/light/15_profile_configuration.png" width="100%" alt="Configuration dialog, Appearance section"></picture></a><br><sub><b>Configuration</b></sub></td>
  </tr>
  <tr>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/16_admin_overview.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/16_admin_overview.png"><img src="frontend/src/assets/screenshots/light/16_admin_overview.png" width="100%" alt="Administration overview with System Health"></picture></a><br><sub><b>Administration</b></sub></td>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/17_admin_providers.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/17_admin_providers.png"><img src="frontend/src/assets/screenshots/light/17_admin_providers.png" width="100%" alt="Administration, Providers page with on/off switches"></picture></a><br><sub><b>Administration — Providers</b></sub></td>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/18_admin_storage.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/18_admin_storage.png"><img src="frontend/src/assets/screenshots/light/18_admin_storage.png" width="100%" alt="Administration, Storage page"></picture></a><br><sub><b>Administration — Storage</b></sub></td>
  </tr>
  <tr>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/19_admin_dashboard.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/19_admin_dashboard.png"><img src="frontend/src/assets/screenshots/light/19_admin_dashboard.png" width="100%" alt="Administration, Dashboard page with custom widget switches"></picture></a><br><sub><b>Administration — Dashboard</b></sub></td>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/20_admin_ai.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/20_admin_ai.png"><img src="frontend/src/assets/screenshots/light/20_admin_ai.png" width="100%" alt="Administration, AI page with models and features"></picture></a><br><sub><b>Administration — AI</b></sub></td>
    <td width="33%"><a href="frontend/src/assets/screenshots/dark/21_admin_captcha_search.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/light/21_admin_captcha_search.png"><img src="frontend/src/assets/screenshots/dark/21_admin_captcha_search.png" width="100%" alt="Search opened over the Captcha administration page"></picture></a><br><sub><b>Search</b> — in the other theme</sub></td>
  </tr>
  <tr>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/31_tools.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/31_tools.png"><img src="frontend/src/assets/screenshots/light/31_tools.png" width="100%" alt="Tools page, with the tools on shelves by what they do"></picture></a><br><sub><b>Tools</b></sub></td>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/32_tool_window.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/32_tool_window.png"><img src="frontend/src/assets/screenshots/light/32_tool_window.png" width="100%" alt="The QR code generator tool open in its window"></picture></a><br><sub><b>Tools — QR Code Generator</b></sub></td>
    <td width="33%"><a href="frontend/src/assets/screenshots/light/35_model_customize.png" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/screenshots/dark/35_model_customize.png"><img src="frontend/src/assets/screenshots/light/35_model_customize.png" width="100%" alt="Customizer with a model's OpenSCAD parameters and the model it generated"></picture></a><br><sub><b>Customize a Model</b></sub></td>
  </tr>
  <tr>
    <td width="33%"><a href="extension/docs/screenshots/collection-printables.jpg" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="extension/docs/screenshots/collection-printables-dark.jpg"><img src="extension/docs/screenshots/collection-printables.jpg" width="100%" alt="Thingport Grab importing a Printables collection"></picture></a><br><sub><b>Thingport Grab — Collections</b></sub></td>
    <td width="33%"><a href="extension/docs/screenshots/panel-printables.jpg" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="extension/docs/screenshots/panel-printables-dark.jpg"><img src="extension/docs/screenshots/panel-printables.jpg" width="100%" alt="Thingport Grab on Printables"></picture></a><br><sub><b>Thingport Grab — Printables</b></sub></td>
    <td width="33%"><a href="extension/docs/screenshots/panel-thingiverse.jpg" target="_blank"><img src="extension/docs/screenshots/panel-thingiverse.jpg" width="100%" alt="Thingport Grab on Thingiverse"></a><br><sub><b>Thingport Grab — Thingiverse</b></sub></td>
  </tr>
  <tr>
    <td width="33%"><a href="extension/docs/screenshots/panel-makerworld.jpg" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="extension/docs/screenshots/panel-makerworld-dark.jpg"><img src="extension/docs/screenshots/panel-makerworld.jpg" width="100%" alt="Thingport Grab on MakerWorld"></picture></a><br><sub><b>Thingport Grab — MakerWorld</b></sub></td>
    <td width="33%"><a href="extension/docs/screenshots/collection-makerworld.jpg" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="extension/docs/screenshots/collection-makerworld-dark.jpg"><img src="extension/docs/screenshots/collection-makerworld.jpg" width="100%" alt="Thingport Grab syncing a MakerWorld collection"></picture></a><br><sub><b>Thingport Grab — Sync a Collection</b></sub></td>
    <td width="33%"><a href="extension/docs/screenshots/panel-crealitycloud.jpg" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="extension/docs/screenshots/panel-crealitycloud-dark.jpg"><img src="extension/docs/screenshots/panel-crealitycloud.jpg" width="100%" alt="Thingport Grab on Creality Cloud"></picture></a><br><sub><b>Thingport Grab — Creality Cloud</b></sub></td>
  </tr>
</table>

<table>
  <tr>
    <td align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="extension/docs/screenshots/popup-setup-dark.png"><img src="extension/docs/screenshots/popup-setup.png" width="260" alt="Thingport Grab popup before an instance is added, with Pair with Thingport"></picture><br><sub><b>Thingport Grab — Setup</b></sub></td>
    <td align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="extension/docs/screenshots/popup-connected-dark.png"><img src="extension/docs/screenshots/popup-connected.png" width="260" alt="Thingport Grab popup connected to an instance, with the sites it runs on"></picture><br><sub><b>Thingport Grab — Connected</b></sub></td>
  </tr>
</table>

## Installation

> Step-by-step guides for Docker Compose, Unraid, TrueNAS SCALE and CasaOS are also on the
> **[Thingport website](https://thingport.net/docs/)**.

### Docker Compose

Runs entirely from the pre-built images on GHCR -- no local build, no git clone needed. Works on any Docker host, including a NAS (Synology, QNAP, Unraid, etc).

> **Unraid users:** see [docs/install/unraid/README.md](docs/install/unraid/README.md) for an Unraid-flavored compose
> file (appdata paths, Docker tab icons/WebUI) and Compose plugin setup steps.
>
> **TrueNAS SCALE users:** see [docs/install/truenas/README.md](docs/install/truenas/README.md) for a TrueNAS-flavored
> compose file (dataset-backed appdata paths) and both the Custom App (YAML) and SSH setup
> steps.
>
> **CasaOS users:** see [docs/install/casaos/README.md](docs/install/casaos/README.md) for a CasaOS-flavored compose
> file (`/DATA/AppData` appdata paths) and both the customized-app and SSH setup steps.

Create a folder for Thingport and add these two files to it:

<details>
<summary><code>docker-compose.yml</code></summary>

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      - POSTGRES_USER=${POSTGRES_USER:-thingport}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-thingport}
      - POSTGRES_DB=${POSTGRES_DB:-thingport}
    volumes:
      - thingport_db:/var/lib/postgresql/data
    networks:
      - app-net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-thingport}"]
      interval: 5s
      timeout: 5s
      retries: 10

  flaresolverr:
    image: ghcr.io/flaresolverr/flaresolverr:latest
    restart: unless-stopped
    environment:
      - LOG_LEVEL=${FLARESOLVERR_LOG_LEVEL:-info}
      - TZ=${TZ:-UTC}
    networks:
      - app-net

  backend:
    image: ghcr.io/tautvydasderzinskas/thingport-backend:latest
    restart: unless-stopped
    environment:
      - PUID=${PUID:-1000}
      - PGID=${PGID:-1000}
      - AUTH_SECRET=${AUTH_SECRET:-changeme-secret}
      - AUTH_TOKEN_TTL=${AUTH_TOKEN_TTL:-43200}
      - PUBLIC_URL=${PUBLIC_URL:-}
      - SMTP_HOST=${SMTP_HOST:-}
      - SMTP_PORT=${SMTP_PORT:-587}
      - SMTP_SECURE=${SMTP_SECURE:-false}
      - SMTP_USER=${SMTP_USER:-}
      - SMTP_PASS=${SMTP_PASS:-}
      - SMTP_FROM=${SMTP_FROM:-Thingport <no-reply@localhost>}
      - FILE_STORAGE=/app/storage
      - DATABASE_URL=postgresql://${POSTGRES_USER:-thingport}:${POSTGRES_PASSWORD:-thingport}@db:5432/${POSTGRES_DB:-thingport}?schema=public
      - CORS_ORIGINS=${CORS_ORIGINS:-}
      - FLARESOLVERR_URL=${FLARESOLVERR_URL:-http://flaresolverr:8191/v1}
    depends_on:
      db:
        condition: service_healthy
      flaresolverr:
        condition: service_started
    volumes:
      - thingport_storage:/app/storage
      # Optional consume folder: files and folders dropped in it are imported automatically
      # (Administration -> Storage -> Consume Folder). Uncomment and point it at a host folder.
      # - /path/to/consume:/app/consume
    networks:
      - app-net

  frontend:
    image: ghcr.io/tautvydasderzinskas/thingport-frontend:latest
    restart: unless-stopped
    ports:
      - "${WEB_PORT:-80}:80"
    depends_on:
      - backend
    networks:
      - app-net

volumes:
  thingport_storage:
  thingport_db:

networks:
  app-net:
    driver: bridge
```

</details>

<details>
<summary><code>.env</code></summary>

```env
# Required
# AUTH_SECRET signs login tokens -- use your own random value
AUTH_SECRET=b1193c7014e833a063f750d6e4644d615e90e6ee81dbde619e1818e9675a3374
POSTGRES_PASSWORD=change-this-password

# Optional (defaults shown)
PUID=1000
PGID=1000
WEB_PORT=80
POSTGRES_USER=thingport
POSTGRES_DB=thingport
# e.g. https://thingport.example.com -- needed for links in emails and for single sign-on (OIDC).
# Read on the first run only; after that it's managed in Administration -> Auth.
PUBLIC_URL=
# access token lifetime, in seconds; the browser renews it
AUTH_TOKEN_TTL=43200
# how long a browser stays signed in without being used, in seconds (0 = off); until set in Administration -> Auth
# REMEMBER_SESSION_TTL=2592000
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=Thingport <no-reply@localhost>
# first-run default only; once Thingport has started, change it in Administration -> Connections -> FlareSolverr
FLARESOLVERR_URL=http://flaresolverr:8191/v1
TZ=UTC
```

</details>

Then start it:

```bash
docker compose up -d
```

Thingport will be available at `http://<host>:<WEB_PORT>` (default port 80). The first
account you register becomes the admin account.

Then open **Administration → Overview → System Health** and click **Run full test**. Ideally everything is green:
anything marked **Required** or **Recommended** that isn't means Thingport, or part of it, won't work properly until
it's fixed, and each problem says how. It's also the first place to look whenever something stops working. See
[System Health](docs/guides/system-health.md).

> **Just want to try it?** On Linux or macOS, one command creates a `thingport` folder with the same two files,
> generates the secrets in `.env` and starts Thingport on port 80:
>
> ```bash
> curl -fsSL https://thingport.net/install.sh | sh
> ```
>
> Edit `.env` there and run `docker compose up -d` again to change settings. Pick the folder and port up front with
> `curl -fsSL https://thingport.net/install.sh | WEB_PORT=8080 sh -s -- ~/thingport`. The script is
> [install.sh](install.sh) in this repo.

<details>
<summary>Building from source instead</summary>

```bash
git clone https://github.com/TautvydasDerzinskas/Thingport.git
cd Thingport
cp .env.example .env
docker compose up -d
```

This builds the images locally rather than pulling from GHCR.

</details>

### Consume folder

To have Thingport import whatever you drop into a folder on the server, uncomment the consume volume in
`docker-compose.yml`. See the [consume folder guide](docs/guides/consume-folder.md).

## Features

- **[Import from 17 sites](docs/features/importing.md)** — MakerWorld, Printables, Thingiverse, MyMiniFactory, Snapmaker Space, MakerOnline, Creality Cloud, NexPrint, Thangs, Cults3D, eufyMake, Pinshape, OwlCAD, Toymakr3D, Makerables, CGTrader and GrabCAD
- **[Import bookmarklet](docs/guides/bookmarklet.md)**
- **[Synced collections](docs/guides/synced-collections.md)**
- **[Bring your existing library](docs/guides/existing-library.md)**
- **[Consume folder](docs/guides/consume-folder.md)**
- **[3D previews](docs/features/3d-previews.md)**
- **[Multicolour models in their own colours](docs/features/3d-previews.md)**
- **[Print quality checks](docs/features/print-quality.md)**
- **[AI categorization and descriptions](docs/guides/ai.md)**
- **[Organize, search and bulk-edit](docs/features/organize-and-search.md)**
- **[Dashboard](docs/features/dashboard.md)**
- **[Profile and activity](docs/features/profile-and-activity.md)**
- **[Author pages](docs/features/authors.md)**
- **[Open in your slicer](docs/features/slicers.md)**
- **[Normalized MakerWorld 3MFs](docs/features/normalized-3mf.md)**
- **[Everything to print it](docs/features/supporting-files.md)**
- **[Customize models that came with their OpenSCAD script](docs/features/supporting-files.md#models-you-can-generate-again)**
- **[Download as ZIP](docs/features/downloads.md)**
- **[Plain files on your disk](docs/features/storage.md)**
- **[Repair models whose files are gone](docs/features/storage.md#when-the-files-are-gone)**
- **[Multi-user](docs/features/multi-user.md)**
- **[Single sign-on](docs/guides/single-sign-on.md)**
- **[Administration](docs/features/administration.md)**
- **[System Health](docs/guides/system-health.md)**
- **[API token](docs/guides/api-token.md)**
- **[Connect an AI assistant (MCP)](docs/guides/mcp.md)**
- **[Custom dashboard widgets](docs/guides/custom-widgets.md)**
- **[Tools: planners, generators, calculators and a 3MF normalizer](docs/guides/tools.md)**
- **[Make your own tools, or have an AI write them](docs/guides/tools.md#have-an-ai-write-one)**
- **[Light and dark themes, accent colours, in English, Spanish, French and Lithuanian](docs/features/appearance.md)**
- **[Self-hosted](#installation)**

## Companion Apps

Thingport ships two small companion apps, each downloadable from the in-app **Downloads** page or GitHub Releases:

- **[Thingport Bridge](bridge/README.md)** — a lightweight desktop helper that makes "Open in {Slicer}" work for slicers (Bambu Studio, PrusaSlicer, Cura, Anycubic Slicer Next) whose own URL-protocol handlers won't accept a link from a self-hosted domain.
- **[Thingport Grab](extension/README.md)** — a browser extension for Chrome, Edge and Firefox that imports models from all 17 sites straight from their own pages, without leaving the site (see the screenshots above), and hands Thingport your sign-in on the sites that need one as you use them. **Pair with Thingport** connects it to your instance: Thingport opens in a tab to approve the browser, and no password is saved in the extension. Even without a Thingport instance, it adds a "Download normalized" button to MakerWorld model pages that converts Bambu Studio projects into 3MFs other slicers open with their colours and settings. Get it from the [Chrome Web Store](https://chromewebstore.google.com/detail/nmblahmglpbplmfcggghdgohohlaeiee), [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/thingport-grab/) or [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/kahfidpmojfocohinlmglnfoaimocbol).

## Provider Setup

MakerWorld needs each user's session cookie, Printables works with no setup, and Thingiverse needs an App Token an admin sets once for the whole instance. Most of the others need a sign-in or key of their own, usually handed over by [Thingport Grab](extension/README.md); OwlCAD needs none at all, and eufyMake, MakerOnline and Makerables only for your likes or saved projects. MakerOnline's files come only through Grab, and so do OwlCAD's CAD projects. Printables, Thingiverse and MyMiniFactory work best with FlareSolverr, and CGTrader needs Grab or FlareSolverr to get its downloads past AWS's bot check. Connect them under **Configuration → Providers** (from the user menu): right-click a provider to connect it, or choose **About** for what it needs. All 17 are on by default; admins can turn any of them off for the whole instance under **Administration → Providers**. See **[docs/PROVIDER_SETUP.md](docs/PROVIDER_SETUP.md)** for a comparison of them all, and a setup page for each.

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch,
commit and pull request workflow, and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for how to run
Thingport locally with hot reload. Adding a model site is in
[docs/PROVIDER_DEVELOPMENT.md](docs/PROVIDER_DEVELOPMENT.md), and writing a tool for the Tools page in
[docs/TOOL_DEVELOPMENT.md](docs/TOOL_DEVELOPMENT.md).

### Honourable contributors

<table>
  <tr>
    <td align="center" width="140">
      <a href="https://github.com/Ruivalim"><img src="https://avatars.githubusercontent.com/u/15039284?v=4&s=160" width="80" height="80" alt="Rui Valim"></a><br>
      <sub><b>Ruivalim</b></sub><br>
      <a href="https://github.com/Ruivalim"><img src="docs/assets/icons/github.svg" width="16" height="16" alt="GitHub"></a>&nbsp;
      <a href="https://ruivalim.com.br"><img src="docs/assets/icons/website.svg" width="16" height="16" alt="Website"></a>&nbsp;
      <a href="https://www.linkedin.com/in/rui-valim/"><img src="docs/assets/icons/linkedin.svg" width="16" height="16" alt="LinkedIn"></a>
    </td>
  </tr>
</table>

## Support

If Thingport is useful to you, consider supporting its development:

- [GitHub Sponsors](https://github.com/sponsors/TautvydasDerzinskas)
- [Buy Me a Coffee](https://buymeacoffee.com/TautvydasDerzinskas)

## License

Thingport is free software: you can redistribute it and/or modify it under the terms of the
[GNU Affero General Public License, version 3](LICENSE) (AGPL-3.0-only), as published by the Free
Software Foundation.
