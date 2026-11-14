# space-monkeys

Our entry for the NASA Space Apps Challenge 2026, challenge **"Planet X and SPHEREx"** (Colombo local event, virtual track).

A public web tool that shows SPHEREx sky images over time for any position on the sky, so that objects which move or change brightness stand out. Enter a Right Ascension and Declination (or pick a test target), and the tool plays the exposures of that patch like a short video.

> Working title: **Sky Workbench**. The product name is not decided yet.

## Status

Scaffold only. The back end answers every endpoint with **mock data** by default; the live exposure search against the SPHEREx archive works, and the live image endpoints are the first thing to build. See `docs/ACCEPTANCE.md` for what is done and what is not.

## What it will do

Built in this order, each layer usable on its own:

1. Wavelength-matched blink and difference images
2. Motion-tracked stacking, to pull faint moving objects out of the noise
3. Click a point for its spectrum and brightness-over-time curve
4. WISE-era versus SPHEREx comparison
5. Automatic flags on sources that moved or changed

## Quick start

You need git, Python 3.11 or newer, and Node 20 or newer. Full instructions for Windows and macOS are in [CONTRIBUTING.md](CONTRIBUTING.md).

Back end, in one terminal:

```
cd backend
python -m venv .venv
.venv\Scripts\activate          (Windows)   or   source .venv/bin/activate   (macOS)
python -m pip install -e ".[dev]"
python -m uvicorn app.main:app --reload --port 8000
```

Front end, in a second terminal:

```
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The API documentation is at http://localhost:8000/docs.

## Where things are

| Path | What |
| --- | --- |
| `backend/` | Python and FastAPI service: searches the archive, cuts out image patches, measures brightness |
| `frontend/` | React, Vite and TypeScript static site |
| `docs/` | Shared documents (below) and the generated API contract `openapi.json` |
| `scripts/` | Cross-platform helper scripts |
| `.github/` | Issue and pull request templates, labels, code owners, continuous integration |
| `.do/` | Draft hosting specification for DigitalOcean App Platform; not deployed or tested |

| Document | Read it for |
| --- | --- |
| [AGENTS.md](AGENTS.md) | The rules for everyone and every AI tool working here |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup and the daily routine |
| [docs/SCIENCE.md](docs/SCIENCE.md) | What the data is and the mistakes to avoid |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the parts fit and what each endpoint does |
| [docs/OWNERSHIP.md](docs/OWNERSHIP.md) | Who owns which folder |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decisions already made |
| [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) | The checklist we are judged against |
| [docs/RESOURCES.md](docs/RESOURCES.md) | Every outside resource we use, with credit |
| [docs/AI_USAGE.md](docs/AI_USAGE.md) | Where AI tools were used |
| [docs/PROJECT_PAGE.md](docs/PROJECT_PAGE.md) | Draft text for the Space Apps project page |

## Data and credit

This project uses data products from NASA's SPHEREx mission, served by the NASA/IPAC Infrared Science Archive. Full acknowledgements, data identifiers and licences are in [docs/RESOURCES.md](docs/RESOURCES.md).

This project is not affiliated with or endorsed by NASA.

## Licence

Copyright 2026 the space-monkeys team.

Our own code and documents are licensed under the Apache License, Version 2.0. The full text is in [LICENSE](LICENSE). The NASA Space Apps terms ask for an open-source licence and name this one as the default.

This licence covers only what the team wrote. Data, libraries and other material we reuse keep their own licences, listed in [docs/RESOURCES.md](docs/RESOURCES.md).
