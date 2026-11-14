# Working on this repository

For the six of us. Read `AGENTS.md` too: its rules apply to people as well as AI tools.

## One-time setup

### 1. Install the tools

| Tool | Version | Windows | macOS |
| --- | --- | --- | --- |
| git | any recent | https://git-scm.com/download/win | `xcode-select --install` |
| Python | 3.11 or newer | https://www.python.org/downloads/ (tick "Add to PATH") | https://www.python.org/downloads/ |
| Node | 20 or newer | https://nodejs.org | https://nodejs.org |
| GitHub CLI (`gh`) | any recent | https://cli.github.com | https://cli.github.com |

Check them (same commands in PowerShell and Terminal):

```
git --version
python --version
node --version
gh --version
```

On macOS the Python command may be `python3`. Use it to create the virtual environment; after you activate the environment, `python` works.

Sign in to GitHub from the command line once, so that you and your AI tool can read and write issues:

```
gh auth login
```

### 2. Get the code

```
git clone <repository address>
cd space-monkeys
```

### 3. Back end

Windows PowerShell:

```
cd backend
python -m venv .venv
.venv\Scripts\activate
python -m pip install -e ".[dev]"
```

macOS:

```
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
```

If PowerShell refuses to run the activate script, run this once and try again:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

`.[dev]` is enough for mock mode. If you work on real SPHEREx data, install `.[dev,live]` instead; it adds the astronomy libraries.

### 4. Front end

```
cd frontend
npm install
```

### 5. Turn on notifications

We do not use a chat integration. GitHub tells you when something needs you:

1. On the repository page choose **Watch**, then **Participating and @mentions** (or **All activity** if you own an area).
2. Install the GitHub mobile app and allow notifications, so that an issue assigned to you reaches your phone.

## Running it

Two terminals.

Back end (inside `backend/`, with the environment activated):

```
python -m uvicorn app.main:app --reload --port 8000
```

Front end (inside `frontend/`):

```
npm run dev
```

Open http://localhost:5173. The badge in the page header says **mock data** or **live data**.

To use real data, set the mode before starting the back end.

Windows PowerShell: `$env:SM_MODE = "live"`
macOS: `export SM_MODE=live`

Or copy `backend/.env.example` to `backend/.env` and edit it. `.env` is never committed.

## Every day

1. `git pull` on `main`.
2. Check your issues: `gh issue list --assignee "@me" --state open`. Answer blockers and questions first.
3. Work on a branch named `<area>/<topic>`, for example `frontend/blink-controls`.
4. **Push at least every 30 minutes and before every break.** A power cut should never cost more than half an hour.
5. Open a pull request early; draft is fine. Fill in the template.
6. Before you stop for the day, if anything is unfinished, open a `handoff` issue.

## Before you push

Back end (inside `backend/`):

```
python -m ruff check .
python -m pytest -q
```

Front end (inside `frontend/`):

```
npm run typecheck
npm test
```

If you changed the API, also run `python scripts/export_openapi.py` in `backend/` and `npm run gen:api` in `frontend/`, and commit the results.

## Asking, deciding, handing over

Open an issue with the matching template: question, blocker, decision or handoff. Give it one area label and assign the person who must act next. Details are in `AGENTS.md`, section 4.

## Using AI tools

- Your tool reads `AGENTS.md` automatically (Claude Code reaches it through `CLAUDE.md`). If your tool seems not to know the rules, tell it to read `AGENTS.md`.
- Record AI use in `docs/AI_USAGE.md`. We must disclose it on the project page.
- AI-generated images, slides and video must not contain NASA logos, insignia, flags or mission patches.
- You are responsible for what your tool writes. Read the change before you push it.
