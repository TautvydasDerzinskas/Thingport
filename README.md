<div align="center">

<img src="frontend/src/assets/logos/thingport-lockup-stacked-color.svg" alt="Thingport" width="250">

<h3>Your personal 3D model library.</h3>

<p>
Collect, organize, preview, and manage your 3D printing models<br>
from the places where you discover them.
</p>

<p>
  <img src="https://github.com/TautvydasDerzinskas/Thingport/actions/workflows/frontend-image.yml/badge.svg" alt="Frontend">
  <img src="https://github.com/TautvydasDerzinskas/Thingport/actions/workflows/backend-image.yml/badge.svg" alt="Backend">
  <img src="https://github.com/TautvydasDerzinskas/Thingport/actions/workflows/bridge-release.yml/badge.svg" alt="Slicer Bridge">
  <img src="https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/Three.js-000000?logo=three.js&logoColor=white" alt="Three.js">
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL">
</p>

</div>

## About

If you do 3D printing, you probably discover models across **MakerWorld, Printables, Thingiverse, and other 3D model platforms**.

Over time, those bookmarks, downloads, ZIP files, and random folders become a mess.

**Thingport is your personal, self-hosted 3D model library.**

Bring your models together in one place, keep them organized, and preview them directly in your browser.

Instead of having your collection scattered across different websites and your filesystem, Thingport gives you a single place to manage the models you actually want to keep.

## Features

- 🗂️ **Personal model library** — keep your 3D models in one organized place
- 🌐 **Import from model websites** — bring models into your library from supported platforms
- 🔎 **Search & organize** — find models in your collection quickly
- 🧊 **3D previews** — inspect models directly in the browser
- 📦 **Archive your models** — keep local copies of the models you want to preserve
- 🖼️ **Model metadata & previews** — keep useful information together with the files
- 🔗 **Source links** — retain the original model source
- 🐳 **Self-hosted** — run your own instance and keep your collection under your control
- 🌍 **Multi-language ready** — internationalization support built into the frontend
- ⚡ **Modern web interface** — React + Three.js powered UI

## Screenshots

<table>
  <tr>
    <td width="33%"><img src="frontend/src/assets/screenshots/01_dashboard.png" width="100%" alt="Dashboard"><br><sub><b>Dashboard</b></sub></td>
    <td width="33%"><img src="frontend/src/assets/screenshots/02_models.png" width="100%" alt="Models"><br><sub><b>Models</b></sub></td>
    <td width="33%"><img src="frontend/src/assets/screenshots/03_model_details.png" width="100%" alt="Model details"><br><sub><b>Model Details</b></sub></td>
  </tr>
  <tr>
    <td width="33%"><img src="frontend/src/assets/screenshots/04_model_details_3d_preview.png" width="100%" alt="3D preview"><br><sub><b>3D Preview</b></sub></td>
    <td width="33%"><img src="frontend/src/assets/screenshots/05_collections.png" width="100%" alt="Collections"><br><sub><b>Collections</b></sub></td>
    <td width="33%"><img src="frontend/src/assets/screenshots/06_tags.png" width="100%" alt="Tags"><br><sub><b>Tags</b></sub></td>
  </tr>
  <tr>
    <td width="33%"><img src="frontend/src/assets/screenshots/07_downloads.png" width="100%" alt="Downloads"><br><sub><b>Downloads</b></sub></td>
    <td width="33%"><img src="frontend/src/assets/screenshots/08_my_models.png" width="100%" alt="My models"><br><sub><b>My Models</b></sub></td>
    <td width="33%"><img src="frontend/src/assets/screenshots/09_dark_theme.png" width="100%" alt="Dark theme"><br><sub><b>Dark Theme</b></sub></td>
  </tr>
  <tr>
    <td width="33%"><img src="frontend/src/assets/screenshots/10_extension_printables.png" width="100%" alt="Thingport Grab on Printables"><br><sub><b>Thingport Grab — Printables</b></sub></td>
    <td width="33%"><img src="frontend/src/assets/screenshots/11_extension_thingyverse.png" width="100%" alt="Thingport Grab on Thingiverse"><br><sub><b>Thingport Grab — Thingiverse</b></sub></td>
    <td width="33%"><img src="frontend/src/assets/screenshots/12_extension_makerworld.png" width="100%" alt="Thingport Grab on MakerWorld"><br><sub><b>Thingport Grab — MakerWorld</b></sub></td>
  </tr>
</table>

## Installation

### Docker

Clone the repository:

```bash
git clone https://github.com/TautvydasDerzinskas/Thingport.git
cd Thingport
cp .env.example .env
```

Configure `.env` if needed, then start Thingport:

```bash
docker compose up -d
```

The application will be available at:

```text
http://localhost
```

For a deployment using the published container images:

```bash
docker compose -f docker-compose.deploy.yml up -d
```

## Components

| Component | Description |
|-----------|-------------|
| `frontend` | React web application with Three.js 3D viewer |
| `backend` | Node.js / Express API |
| `db` | PostgreSQL database |
| `flaresolverr` | Web request / anti-bot handling |

