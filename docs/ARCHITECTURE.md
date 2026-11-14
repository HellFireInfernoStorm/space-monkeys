# Architecture

## The parts

```
Browser
  frontend/  (static site: React, Vite, TypeScript)
     |  view state lives in the URL
     |  GET /api/...
     v
  backend/   (Python, FastAPI)
     |-- mock mode: synthetic data, no network
     |-- live mode:
     |      search  -> IRSA Simple Image Access service (one query per collection)
     |      pixels  -> AWS mirror of the archive, byte-range reads of the patch only
     v
  disk cache (backend/.cache, or SM_CACHE_DIR)
```

The front end also uses Aladin Lite (made by CDS, Strasbourg; installed from npm) for the wide-field sky map, with background tiles fetched from IRSA, and links out to WiseView for the WISE-era view.

## Two modes

Set by the environment variable `SM_MODE`.

| Mode | Behaviour | Needs |
| --- | --- | --- |
| `mock` (default) | Every endpoint answers at once with deterministic synthetic data shaped exactly like the real thing | Only the core Python packages |
| `live` | Real SPHEREx data. Endpoints not built yet answer HTTP 501 | The `live` extra (`pip install -e ".[dev,live]"`) and network access |

The response of `/api/health` and of every list endpoint states the mode, and the front end shows it as a badge. Mock images must never be shown without that badge.

## The API

The contract is `docs/openapi.json`, generated from the code. Browse it at `http://localhost:8000/docs` while the back end is running.

| Endpoint | Purpose | Mock | Live |
| --- | --- | --- | --- |
| `GET /api/health` | Status, mode, configured collections | yes | yes |
| `GET /api/bands` | The six detector bands and their wavelength ranges, for the band selector | yes | yes |
| `GET /api/targets` | The five test targets with catalogue values | yes | yes |
| `GET /api/resolve?name=` | Name to coordinates. Built-in targets only for now | yes | yes |
| `GET /api/exposures` | Exposures covering a position, across all collections, capped | yes | yes |
| `GET /api/frames` | The frame list for the blink player: exposures filtered by wavelength, each with an image address | yes | yes |
| `GET /api/frame.png` | One image patch as PNG; with `diff_ref`, a difference image | yes | yes |
| `GET /api/photometry` | Quick-look brightness per exposure at a point: serves both the spectrum and the light curve | yes | **501** |

Planned, not in the contract yet:

| Endpoint | Layer | Purpose |
| --- | --- | --- |
| `GET /api/stack.png` | 2 | Motion-tracked stack of many exposures in a wavelength range |
| `GET /api/flags` | 1 | Flag bits set in a patch, with names, for the metadata display |
| `GET /api/changes` | 5 | Sources in the field that moved or changed, with a label |

### Conventions

- Coordinates: ICRS decimal degrees (`ra`, `dec`). Sizes on the sky: arcseconds. Wavelengths: micrometres. Times: MJD. Proper motion: milliarcseconds per year (`pmra` includes the cos(dec) factor), with `epoch` as a decimal year for the given position.
- An exposure is identified by `exposure_id`, which is the archive's observation id plus the detector, for example `2025W18_1B_0081_2-D6`. One observation id can cover a position with more than one detector.
- When proper motion is given, the server moves the position to each exposure's date. `/api/frames` then centres all frames on the position at the middle exposure (so the object visibly moves), or, with `track=true`, re-centres every frame on the object (so the object stays still and the background moves; this is what stacking uses).
- List endpoints return `total`, `returned` and `capped`, so the interface can say "showing 300 of 2,502".
- Photometry points use the column names of IRSA's Spectrophotometry Tool where they overlap (`flux`, `flux_err`, `lambda_width`, `flags`, `mjd`, `det_id`), so results can be compared side by side.

## The live data path

Code: `backend/app/live.py` (search), `live_frames.py` (the two endpoints), `pixels.py` (range reads), `resample.py` (geometry, no astronomy libraries), `cache.py`.

1. **Search.** `backend/app/live.py` queries the Simple Image Access service once per collection in `settings.collections`, in parallel threads, with `pyvo`. A failed collection is reported in the response's `warnings`; the others still return. If every collection fails, `/api/frames` answers 502 (or uses the last saved result for that position, with a warning).
2. **Cap.** `/api/exposures` returns at most `max_exposures` (default 300), an even sample across time.
3. **Locate.** Each row's `cloud_access` field gives bucket, region and key. The address is `https://{bucket}.s3.{region}.amazonaws.com/{key}`.
4. **Wavelength at the target.** For each exposure whose detector range overlaps the requested range (at most `max_probes`, default 400, spread in time), open the file with `astropy.io.fits.open(url, use_fsspec=True, fsspec_kwargs={"block_size": 131072, "cache_type": "bytes"})`, find the target's pixel with the full coordinate system (including the SIP distortion), and interpolate the `WCS-WAVE` table there. Keep only exposures whose wavelength at the target is inside the range (`docs/SCIENCE.md`, section 1). Then cap to `max_frames` (default 40), spread evenly in time; `capped` says so.
5. **Cut out and resample.** Read only the block of `IMAGE` and `FLAGS` that covers the output after rotation, through `.section[...]` (`VARIANCE` is not read). Resample it onto one grid for all frames: a tangent plane centred on the frame centre, north up, east left, 6.15 arcseconds per pixel, `round(size / 6.15)` pixels wide (8 to 96), the same as mock mode. Bilinear for the image (bad pixels left out), nearest pixel for the flags. Steps 4 and 5 run `s3_concurrency` (default 16) files at once. A file that fails is skipped and counted in `warnings`.
6. **Render.** Subtract the median of the good pixels (zodiacal light). One asinh stretch is computed over all frames of the request and stored with each frame, so the blink does not flicker. Difference images subtract the reference frame's patch at the same centre, grey meaning no change, as in mock mode.

**Bright stars are flagged.** The core of a bright star carries bad-pixel bits (Barnard's Star at 1.1 micrometres: OVERFLOW, SUR_ERROR, TRANSIENT and BLOOM over a 6 by 6 pixel block, measured 2026-11-14). The mask is applied to everything quantitative (background, stretch, difference images), but the blink picture shows those pixels' own values, so a bright star is not drawn as a hole.

Measured on a home connection in Sri Lanka, 2026-11-14 (cold cache, 16 readers): Barnard's Star at 1.0 to 1.2 micrometres: 362 exposures found, 121 wavelength checks, 30 frames, 34 seconds. WISE 0855 at 4.4 to 5.0 micrometres, tracked: 258 found, 93 checks, 40 of 46 matching frames, 32 seconds. From the cache: about 0.1 seconds for the list and 0.1 to 0.5 seconds for all its images.

### Cache

- Folder: `settings.cache_dir` (environment variable `SM_CACHE_DIR`), default `backend/.cache`, git-ignored. Safe to delete.
- Patches: compressed NumPy files keyed by `exposure_id`, the centre (6 decimals, as in the image address), the width in pixels and the grid version. A small in-memory cache sits in front.
- Wavelength checks: per exposure and target position (4 decimals). The display stretch: per frame.
- Search results: per rounded position, for `search_cache_hours` (default 12); new data appears at most weekly.
- The exposure id to file address table, so `/api/frame.png` can read a patch that is not cached yet.
- Pre-warm before the pitch: `python scripts/prewarm.py` (with the back end's environment) runs the five targets at fixed wavelength ranges, including WISE 0855 at 4.4 to 5.0 micrometres with tracking.
### Other data we point at

- All-sky SPHEREx map for Aladin Lite: `https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube`. A cube with 102 wavelength frames; frame index = 17 x (band - 1) + (channel - 1); frames 50 and 51 are blank. Not confirmed: on 2026-11-14 the tiles for frames 0 and 50 were missing and the survey declares its first frame as 1, so the numbering may start at 1. Check before stating the wavelength of a frame.
- Solid angle of each pixel, per detector `k`: `nasa-irsa-spherex/dr1/solid_angle_pixel_map/cal-sapm-v3-2026-191/{k}/solid_angle_pixel_map_D{k}_spx_cal-sapm-v3-2026-191.fits`.
- Archive metadata tables through TAP: `spherex.artifact` and `spherex.plane`.

## The front end

- `src/urlState.ts` is the single source of view state. Parameters: `ra`, `dec`, `size` (arcseconds), `wlmin`, `wlmax`, `pmra`, `pmdec`, `epoch`, `speed` (frames per second), `mode` (`blink` or `diff`), `track` (`1` to re-centre every frame on the moving object; left out when off), `sky` (background survey in the wide-field sky map: `wise` by default, or `spherex`), `name`. A link with these parameters reproduces the view, which also makes the tool embeddable in a frame.
- `src/api.ts` is the only file that calls the back end. Its types come from `src/api-types.ts`, generated from the contract with `npm run gen:api`.
- `BlinkPlayer` preloads every frame image and switches which one is visible, so playback does not flicker.
- `AladinPanel` shows the surrounding sky from existing surveys and is the place for catalogue overlays (Gaia, WISE).
- Aladin Lite comes from the npm package `aladin-lite`. It is loaded only when the sky map panel first appears (a lazy dynamic import, so it is a separate chunk). Its usage logging is off.
- Both backgrounds (WISE, and the experimental SPHEREx all-sky cube) are HiPS tile sets that the browser fetches straight from IRSA, because the CDS tile servers did not answer on 2026-11-14.
- For the SPHEREx cube the site shows one fixed frame (the constant `SPHEREX_CUBE_FRAME` in `frontend/src/components/AladinPanel.tsx`), because the frame Aladin Lite opens by default is empty. This relies on the behaviour of the pinned aladin-lite version, so re-check it if the version changes.
- In development the Vite server forwards `/api` to `http://localhost:8000`. In production the site calls the address in `VITE_API_BASE`, or the same origin if that is empty.

## Hosting

Planned: DigitalOcean App Platform, one app with two components, in a region near the AWS `us-east-1` mirror.

- `api`: the back end as a container (`backend/Dockerfile`), with `SM_MODE=live`.
- `web`: the front end as a static site built with `npm ci` and `npm run build`.
- Requests to `/api` go to the back end; everything else to the static site.

`.do/app.yaml` is a **draft** of this. It has not been deployed or validated.

## Adding a new data release

Add its collection name to `collections` in `backend/app/config.py` (or set `SM_COLLECTIONS` in the hosting dashboard). Nothing else should need to change. If something else does, that is a bug: fix the place that hard-coded the old name.
