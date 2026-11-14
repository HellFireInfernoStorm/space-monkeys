# Shared instructions for AI coding tools

This is the one canonical instruction file for every AI tool used on this repository (Claude Code, OpenAI Codex, Cursor, Google Antigravity). Tool-specific files such as `CLAUDE.md` only point here. If a rule needs to change, change it here and nowhere else. Keep this file under 24,000 bytes (Antigravity ignores anything longer).

Humans: the same rules apply to you. Setup steps are in `CONTRIBUTING.md`.

## 1. What we are building

Team **space-monkeys**, NASA Space Apps Challenge 2026, challenge "Planet X and SPHEREx".

A public web tool that shows SPHEREx sky images over time for any Right Ascension and Declination, so that objects which move or change brightness stand out. Nobody on the team is an astronomer, so the science facts in `docs/SCIENCE.md` matter: read that file before touching anything that handles images, wavelengths or coordinates.

The product is a **layered workbench**. Layers are built in this fixed order, and each one must be demo-ready before the next one starts:

1. Wavelength-matched blink and difference images.
2. Motion-tracked stacking (demo object: WISE 0855).
3. Click a point to get its spectrum and brightness-over-time curve.
4. WISE-era versus SPHEREx comparison.
5. Automatic flags on sources that moved or changed.

Do not start a later layer, or add features outside these layers, without a `decision` issue that the area owner has closed as accepted.

Deadlines: pitch on 2026-11-15 at 10:00 (5 minutes demo, 5 minutes questions). Final submission time is not confirmed yet; treat the end of 2026-11-15 as the latest.

## 2. Rules that are never broken

1. **No NASA branding in anything AI-generated.** Do not use, generate, imitate or modify NASA logos, the NASA insignia, flags, or mission identifiers (mission patches and logos) in code, images, slides, video or text art. Naming the mission in plain text ("SPHEREx data") is fine.
2. **Log every reused resource.** Any code, text, image, dataset, font, icon or library that we did not write ourselves gets a line in `docs/RESOURCES.md` in the same pull request that introduces it, with its source and licence. If the licence is unknown, say so in the log and open a `question` issue; do not guess.
3. **Log AI use.** Add a line to `docs/AI_USAGE.md` for each piece of work an AI tool produced or substantially shaped (see section 9). The project page must disclose this honestly.
4. **Do not copy from other teams' repositories** or from other Space Apps submissions. Ask the owner first through a `decision` issue.
5. **No names, voices or likenesses of anyone under 18** anywhere in the project.
6. **No secrets in the repository.** Keys and tokens live in environment variables or the hosting dashboard. `.env` files are ignored by git; only `.env.example` files with dummy values are committed.
7. **Nothing from the team's private folders** (`private docs`) are copied into this repository.
8. **Do not invent science.** If a number, unit, coordinate or flag meaning is not in `docs/SCIENCE.md` or a cited source, look it up or ask. Never present mock data as real data: the user interface must show which mode it is in.
9. **No force-pushes to `main`, and no history rewriting** on branches other people use.

## 3. Start of every session

Do these before any other work, and repeat steps 2 and 3 before starting each new task:

1. Update your copy: `git pull` on `main`, then switch to or create your branch.
2. Read the open issues assigned to the person you are working for:
   `gh issue list --assignee "@me" --state open`
   Blockers and questions addressed to them come first.
3. Read `docs/DECISIONS.md` (it is short) so you do not undo a decision.
4. Check `docs/OWNERSHIP.md` to see which folders your person owns.

If `gh` is not installed or not signed in, say so to your person and ask them to check the issues page in the browser. Do not skip the check silently.

## 4. Coordination: GitHub Issues are the message bus

There is no chat integration. Everything that another person or their AI tool needs to know goes into a GitHub issue.

Every issue has three things:

- one **area label**: `area:frontend`, `area:backend`, `area:data`, `area:infra`, `area:pitch`
- one **type label**: `question`, `blocker`, `decision`, `handoff`
- an **assignee**: the person who must act next (the area owner from `docs/OWNERSHIP.md` unless you know better)

What each type means:

| Type | Use it when | Closed when |
| --- | --- | --- |
| `question` | You need a fact or a preference from someone | It is answered in the issue |
| `blocker` | You cannot continue until someone else acts | The blocking thing is fixed |
| `decision` | A choice affects more than your own area, or changes scope | The owner writes the outcome and it is added to `docs/DECISIONS.md` |
| `handoff` | You stop work that someone else (or you, later) must pick up | The next person confirms they have taken over |

Use the issue templates. Create issues with `gh issue create` or in the browser. Keep titles specific ("Blink player flickers when frames are different sizes", not "Bug").

An AI tool may open, comment on and label issues for its person. It must not close a `decision` issue; a human does that.

## 5. Ownership

`docs/OWNERSHIP.md` maps folders to owners, and `.github/CODEOWNERS` enforces review. Work inside your person's folders. If a task needs a change in someone else's area:

- a small fix (a typo, a broken import) may go in your pull request, with the owner requested as reviewer;
- anything larger starts as an issue assigned to that owner.

`AGENTS.md`, `docs/DECISIONS.md`, the API contract (`docs/openapi.json`) and the continuous-integration workflow are shared. Change them only through a pull request that the repository owner reviews.

## 6. How work moves

- Branch from `main`. Name branches `<area>/<short-topic>`, for example `backend/s3-cutouts`.
- **Push often**: at least every 30 minutes of work and before every break, even if unfinished. Power cuts and laptop failures are a real risk for this team; unpushed work is lost work. Push to your branch, not to `main`.
- Open a pull request early (draft is fine). Use the template. Keep pull requests small: one topic each.
- A pull request merges when the checks pass and, if it touches someone else's area, that owner has approved.
- Merging to `main` deploys the site, so `main` must always work.
- Commit messages: one short line in the imperative ("Add difference mode to frame endpoint"), optional body explaining why.

## 7. Layout and commands

```
backend/    Python 3.11+ and FastAPI. The API. Mock mode is the default.
frontend/   React, Vite and TypeScript. A static site.
docs/       Shared documents and the generated API contract.
scripts/    Cross-platform helper scripts (Python only).
.github/    Issue and pull request templates, labels, CODEOWNERS, CI.
```

Commands are the same in PowerShell and bash except where two forms are shown.

Back end (run inside `backend/`):

```
python -m venv .venv
.venv\Scripts\activate            (Windows PowerShell)
source .venv/bin/activate         (macOS, Linux)
python -m pip install -e ".[dev,live]"
python -m uvicorn app.main:app --reload --port 8000
python -m pytest -q
python -m ruff check .
python scripts/export_openapi.py
```

Front end (run inside `frontend/`):

```
npm install
npm run dev          (http://localhost:5173, sends /api to port 8000)
npm run typecheck
npm test
npm run build
npm run gen:api      (regenerates src/api-types.ts from docs/openapi.json)
```

**Cross-platform rule:** the team uses both Windows and macOS. Do not add shell scripts (`.sh`, `.ps1`, `.bat`) or npm scripts that rely on shell features (`&&` chains with `rm`, `cp`, `export`, environment variables set inline). Write helper scripts in Python or Node. Line endings are LF everywhere (`.gitattributes` enforces it). Use forward slashes or `pathlib`/`path.join` in code, never hard-coded backslashes.

## 8. The API contract and mock mode

- The contract is `docs/openapi.json`. It is **generated** from the FastAPI code by `python scripts/export_openapi.py`; never edit it by hand. A test fails if the file is out of date.
- To change the API: change the models and routes in `backend/app/`, run the export script, run `npm run gen:api` in `frontend/`, and commit all of it in one pull request. If the change breaks existing fields, open a `decision` issue first.
- The back end has two modes, set by the environment variable `SM_MODE`:
  - `mock` (default): every endpoint answers instantly with deterministic synthetic data. No network, no astronomy libraries needed. Front-end work never waits for the back end.
  - `live`: real SPHEREx data. Endpoints that are not built yet answer with HTTP 501.
- Every mock response has the same shape as the live one. Add the mock version of an endpoint first, then the live version.
- Data release names, collection names and service addresses live in `backend/app/config.py` only. Never hard-code a release name such as `spherex_dr1` anywhere else; new releases arrive often and must be a one-line change.
- All view state on the front end lives in the URL (`frontend/src/urlState.ts`), so any view can be shared or embedded with a link. A new control means a new URL parameter.

## 9. Logs you must keep up to date

| File | Add a line when |
| --- | --- |
| `docs/AI_USAGE.md` | An AI tool wrote or substantially shaped code, text, images or analysis |
| `docs/RESOURCES.md` | You add anything we did not make: data, code, library, image, text |
| `docs/DECISIONS.md` | A `decision` issue is closed |
| `docs/ACCEPTANCE.md` | A checklist item is verified (tick it, with the date and how it was checked) |

## 10. Handoff notes

When you stop work that is not finished, open (or update) a `handoff` issue using the template. It must contain:

1. **State**: branch name, last pushed commit, what works right now.
2. **Next step**: the single next action, concrete enough to start without asking.
3. **Open problems**: what is broken or unknown, with error text.
4. **How to check**: the exact commands or page that show it working.
5. **Do not**: anything you tried that failed, so nobody repeats it.

Push your branch before writing the note. A note that describes unpushed work is useless.

## 11. Science facts that are easy to get wrong

The full version, with sources, is `docs/SCIENCE.md`. The short version:

- **Each exposure sees a point on the sky at a different wavelength.** The wavelength changes across each detector. Never blink or subtract two exposures without checking that their wavelengths at the target are close; otherwise brightness changes are just colour.
- **Fast objects are not where the catalogue says.** Catalogue positions are for a past date. Move them to the observation date with the proper motion before searching or cutting out. WISE 0855 is about two arcminutes from the position given in the challenge text.
- **Faint objects need stacking.** WISE 0855 is about 2 sigma in one exposure and only visible at 4.4 to 5.0 micrometres. Stack many exposures after shifting each to follow the object.
- **Not every flag bit means "bad pixel".** Flag bits 12 and 21 are informational; bit 21 ("known source") is set on almost half of all pixels. Use the mask in `backend/app/flags.py`.
- **Units**: image values are MJy/sr with the zodiacal light still included. Pixel scale is 6.15 arcseconds. Coordinates in the API are ICRS decimal degrees; proper motions are milliarcseconds per year; times are MJD.
- **Search all configured collections together** and cap the number of exposures per request; some sky areas have thousands.
- **Read image patches from the AWS mirror with byte-range requests**, not whole 66 MB files and not the IRSA cutout service (slow, and it rejects more than about 8 parallel requests).

## 12. Quality bar

- Run the tests and the linter for the area you touched before you push. Say plainly in the pull request what you ran and what you could not check.
- New back-end behaviour gets a test. New URL parameters get a round-trip test.
- Do not add a dependency for something small. Every new dependency goes in `docs/RESOURCES.md`.
- Prefer the simple version that works on demo day over the clever one that might.
- Report results honestly: if something is untested, slow or wrong for some targets, write that down where the next person will see it.
