# Ownership

Who decides and who reviews, per area. An issue's area label and its assignee come from this table.

As of 2026-11-14 the repository owner (Dinura) owns every area. Rows will be reassigned as teammates take areas; change this file and `.github/CODEOWNERS` in the same pull request.

| Area label | Folders and files | Owner | What it covers |
| --- | --- | --- | --- |
| `area:frontend` | `frontend/` | Dinura | Pages, controls, blink player, sky map, URL state |
| `area:backend` | `backend/app/`, `backend/tests/`, `backend/scripts/` | Dinura | API routes, contract, caching, mock mode |
| `area:data` | `backend/app/live.py`, `backend/app/flags.py`, `backend/app/targets.py`, `docs/SCIENCE.md` | Dinura | Archive search, cutouts, stacking, photometry, science checks on the test targets |
| `area:infra` | `.github/`, `.do/`, `scripts/`, root configuration files | Dinura | Repository settings, CI, hosting, deploys |
| `area:pitch` | `docs/PROJECT_PAGE.md`, `docs/ACCEPTANCE.md`, `docs/RESOURCES.md`, `docs/AI_USAGE.md`, demo material | Dinura | Project page, slides or video, pitch, credits and disclosures |

Shared files (`AGENTS.md`, `docs/DECISIONS.md`, `docs/openapi.json`, `.github/workflows/`) are owned by the repository owner whoever owns the areas.

## Team

| Person | GitHub username | Areas | Operating system |
| --- | --- | --- | --- |
| Dinura | to be filled in | all, for now | Windows |
| to be filled in | | | |
| to be filled in | | | |
| to be filled in | | | |
| to be filled in | | | |
| to be filled in | | | |
