# SpaceShift

**Try it: https://spaceshift.earth/** (no login needed)

**One patch of sky, many moments in time.** SpaceShift is a web tool that shows the SPHEREx space telescope's infrared images of any spot on the sky in time order, so that objects which move or change brightness stand out.

Built by team **space-monkeys** for the NASA Space Apps Challenge 2026, challenge **"Planet X and SPHEREx"** (Colombo local event, virtual track).

## What you can do with it

Pick one of the five built-in targets, type a position (Right Ascension and Declination), or click a spot on the sky map. Then:

| Layer | What it does | State (see [ACCEPTANCE.md](docs/ACCEPTANCE.md)) |
| --- | --- | --- |
| 1. Blink and difference | Plays the exposures of that patch like a short video, or shows each one minus a reference frame. Uses only exposures that saw the target within the selected wavelength range, to reduce changes that are only colour. A visible change still needs checking for wavelength effects and image artifacts; the player warns when its frames span a wide wavelength range. | Runs on real data |
| 2. Motion-tracked stacking | Adds many exposures together while following a moving object, so objects too faint to see in one exposure appear. Measures the motion and compares it with the prediction. | Runs on real data |
| 3. Spectrum and light curve | Click a point to measure its brightness in every exposure: by wavelength (spectrum) and by date (light curve). A quick-look measurement, cross-checked against IRSA's Spectrophotometry Tool. | Checked on real data, locally |
| 4. WISE comparison | Shows a 2010 AllWISE image of the same field beside the SPHEREx view, side by side or blinking, and links to WiseView. | Checked on real data, locally |
| 5. Automatic flags | Marks sources that moved or changed. | Not built |

Also in the workbench:

- A wide-field sky map (Aladin Lite) with eleven background surveys, including the SPHEREx all-sky map with a slider through its 102 wavelength frames.
- An alignment check (issue #22) that compares the stars in an exposure with Gaia catalogue positions. It works on synthetic data; matching against the real catalogue is not validated yet.
- Every view lives in the page address, so any view can be shared or embedded with a link.
- A badge that always says whether you are looking at **live data** or **mock data**.

## Example: the coldest known brown dwarf

In a typical single SPHEREx exposure at 4.4 to 5.0 micrometres, WISE 0855 has a signal-to-noise ratio of 4.7, below our detection threshold of 5. Stacking 46 exposures raises it to 11.4 on a fixed grid, and to 14.2 when the stack follows the object's motion. The motion measured between visits agrees with the prediction from its catalogue proper motion within the statistical errors. Details and limits: [docs/SCIENCE.md](docs/SCIENCE.md), section 6.

## Status

- The site is public at https://spaceshift.earth/: the homepage at `/` and the workbench at `/explore/`. The workbench badge, and the [API health endpoint](https://space-monkeys-demo-bjdddzdbduc6gme7.southindia-01.azurewebsites.net/api/health), show whether it is using live or mock data.
- Layers 3 and 4 are checked on real SPHEREx data, run locally. Layers 1 and 2 run on real data, but their acceptance checks are not ticked yet. [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) records what was checked, when and how.
- The two variable-star targets are hard cases. R Draconis was saturated in every exposure we tested, so it gave no usable aperture measurements. RW Aurigae has given usable measurements so far only at 0.746 to 1.117 micrometres; the other range tested (1.6 to 1.8 micrometres) was saturated. See [docs/SCIENCE.md](docs/SCIENCE.md) for how many exposures were sampled.
- A position the tool has not seen before takes about 30 seconds the first time (archive search and image reads); after that it loads in under a second from the cache.
- When IRSA's search service is down, the tool falls back to the last saved search for that position or a nearby one, and says so.

## How it works

```
Browser: React, Vite, TypeScript (static site)
   |   view state in the URL
   v
Back end: Python, FastAPI
   |-- searches the SPHEREx archive at IRSA (one query across all data collections)
   |-- reads only the needed image patch from the AWS mirror (byte-range requests)
   |-- checks each exposure's wavelength at the target, then cuts out, aligns and stacks
   v
Disk cache
```

The back end has two modes, set by the environment variable `SM_MODE`:

- `mock` (default): instant synthetic data with the same shape as the real thing. No network needed.
- `live`: real SPHEREx data.

Hosting and domain setup: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#hosting).

A new SPHEREx data release is a one-line change in `backend/app/config.py`. The full design, every endpoint and the measured timings are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run it on your own computer

You need git, Python 3.11 or newer, and Node 20 or newer. Step-by-step setup for Windows and macOS is in [CONTRIBUTING.md](CONTRIBUTING.md).

Back end, in one terminal (inside `backend/`):

```
python -m venv .venv
.venv\Scripts\activate            (Windows PowerShell)
source .venv/bin/activate         (macOS, Linux)
python -m pip install -e ".[dev,live]"
python -m uvicorn app.main:app --reload --port 8000
```

This starts in mock mode. For real data, set `SM_MODE` to `live` before starting the server: `$env:SM_MODE = "live"` in PowerShell, `export SM_MODE=live` on macOS and Linux. Mock mode only needs `.[dev]`.

Front end, in a second terminal (inside `frontend/`):

```
npm install
npm run dev
```

Open http://localhost:5173 for the homepage and http://localhost:5173/explore/ for the workbench. The API documentation is at http://localhost:8000/docs.

Before a demo, run the pre-warm script from the repository root with the back end's virtual environment: `backend\.venv\Scripts\python.exe scripts/prewarm.py` on Windows, `backend/.venv/bin/python scripts/prewarm.py` on macOS and Linux. It always uses live mode, so `SM_MODE` does not need to be set. It fills the cache for the five targets so they load quickly even if the archive is slow or down.

## The five test targets

| Target | What it shows |
| --- | --- |
| Barnard's Star | The fastest-moving star in the sky, about 10 arcseconds a year |
| Epsilon Indi B | A pair of nearby brown dwarfs (objects between a star and a planet) with large motion |
| WISE 0855 | The coldest known brown dwarf; needs many exposures stacked, and tracking its motion sharpens it |
| RW Aurigae | A young star whose brightness changes |
| R Draconis | A pulsating star whose brightness changes |

## Where things are

| Path | What |
| --- | --- |
| `backend/` | Python and FastAPI service: archive search, image patches, stacking, photometry, WISE images, alignment check |
| `frontend/` | React, Vite and TypeScript static site: homepage at `/`, workbench at `/explore/` |
| `docs/` | Shared documents (below), the generated API contract `openapi.json`, and review screenshots |
| `scripts/` | Cross-platform helper scripts: cache pre-warm, label sync (the API export and the accuracy and alignment checks are in `backend/scripts/`) |
| `.github/` | Issue and pull request templates, labels, code owners, continuous integration |
| `.do/` | Earlier hosting draft for DigitalOcean App Platform, not used |

| Document | Read it for |
| --- | --- |
| [AGENTS.md](AGENTS.md) | The rules for everyone and every AI tool working here |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup and the daily routine |
| [docs/SCIENCE.md](docs/SCIENCE.md) | What the data is, the mistakes to avoid, and the measured checks |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the parts fit and what each endpoint does |
| [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) | The checklist we are judged against, with what has been checked |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decisions already made |
| [docs/OWNERSHIP.md](docs/OWNERSHIP.md) | Who owns which folder |
| [docs/RESOURCES.md](docs/RESOURCES.md) | Every outside resource we use, with credit and licence |
| [docs/AI_USAGE.md](docs/AI_USAGE.md) | Where AI tools were used |
| [docs/PROJECT_PAGE.md](docs/PROJECT_PAGE.md) | Draft text for the Space Apps project page |
| `docs/*_VALIDATION.md` | Review notes for the new layout, the alignment check and the spectrum panel |

## Data and credit

This project uses data products from NASA's SPHEREx mission, served by the NASA/IPAC Infrared Science Archive (IRSA), and AllWISE images from the same archive. The sky map is Aladin Lite, made by CDS, Strasbourg. Full acknowledgements, data identifiers and licences are in [docs/RESOURCES.md](docs/RESOURCES.md).

This project is not affiliated with or endorsed by NASA.

## Licence

Copyright 2026 the space-monkeys team.

Our own code and documents are licensed under the Apache License, Version 2.0. The full text is in [LICENSE](LICENSE). The NASA Space Apps terms ask for an open-source licence and name this one as the default.

This licence covers only what the team wrote. Data, libraries and other material we reuse keep their own licences, listed in [docs/RESOURCES.md](docs/RESOURCES.md).
