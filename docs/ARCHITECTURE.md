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
     |      search  -> IRSA Simple Image Access service (one query, all collections)
     |      pixels  -> AWS mirror of the archive, byte-range reads of the patch only
     v
  disk cache (backend/.cache, or SM_CACHE_DIR)
```

The front end also uses Aladin Lite (made by CDS, Strasbourg; installed from npm) for the wide-field sky map, with background tiles fetched from IRSA, and links out to WiseView for the WISE-era view. The WiseView link (`src/wiseview.ts`) moves the position along its proper motion to 2014.0, the middle of the WISE-era images; its format (`#ra=...&dec=...&size=...`, size in arcseconds, at most 2000) was checked against WiseView's page script on 2026-11-14.

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
| `GET /api/stack` | Layer 2: many exposures added together. One typical single exposure, the tracked stack, the fixed-grid stack, one stack per visit, and the measured versus predicted motion | yes | yes |
| `GET /api/stack.png` | One image of a stack set as PNG (`kind` = `single`, `tracked`, `static` or `epoch`, and `index` for epochs) | yes | yes |
| `GET /api/photometry` | Layer 3: quick-look brightness per exposure at a point, serving both the spectrum and the light curve. With proper motion (and optional `parallax`), each exposure is measured where the object was on that date | yes | yes |
| `GET /api/wise` | Layer 4: an AllWISE image (W1 or W2, 2010) of the same field as the SPHEREx view, with its dates, tile and source file | yes | yes |
| `GET /api/wise.png` | That image as PNG | yes | yes |

Planned, not in the contract yet:

| Endpoint | Layer | Purpose |
| --- | --- | --- |
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

1. **Search.** `backend/app/live.py` sends one Simple Image Access query naming every collection in `settings.collections` (`pyvo`, with `check_baseurl=False`, so no separate capabilities request), through one shared session with PyVO's User-Agent. It has a timeout (`irsa_timeout_s`, default 90 s, the longest wait for the next bytes) and retries connection errors and HTTP 429, 500, 502, 503 and 504 up to `irsa_retries` times (default 2), with a pause starting at `irsa_backoff_s` that doubles (at most 30 s); the archive's Retry-After header is ignored. Rows are labelled with the collection names we asked for (checked against IRSA on 2026-11-15; compared without case); an exposure listed by two collections is kept from the collection listed first. A malformed answer counts as a failed search. Measured on 2026-11-15 for WISE 0855: the same 258 rows as one query per collection, in about 22 s. After a failure that means IRSA is down (no answer, HTTP 429 or 5xx, not other 4xx), searches fail at once for `irsa_cooldown_s` (default 60 s). Every caller, `/api/exposures` included, goes through `live_frames.search`, which keeps the result on disk and lets concurrent requests for the same position wait for one search (a fixed pool of 64 locks); during an outage the cooldown makes the waiters fail at once. If the search fails, the last saved result for that position is used, with a warning; with none, the saved search of the nearest position within `nearby_search_deg` (default 0.1 degree, same radius and collections; positions are recorded in the cache's `searchpos` entries) is used, with a warning that exposures covering only this position are missing. Exposures that miss this position drop out when their wavelength at the target is checked (`/api/exposures` lists them unchecked). With nothing saved nearby, the endpoint answers 502. Issue #38 lists the causes of IRSA failures and the fixes not done yet.
2. **Cap.** `/api/exposures` returns at most `max_exposures` (default 300), an even sample across time.
3. **Locate.** Each row's `cloud_access` field gives bucket, region and key. The address is `https://{bucket}.s3.{region}.amazonaws.com/{key}`.
4. **Wavelength at the target.** For each exposure whose detector range overlaps the requested range (at most `max_probes`, default 400, spread in time), open the file with `astropy.io.fits.open(url, use_fsspec=True, fsspec_kwargs={"block_size": 131072, "cache_type": "bytes"})`, find the target's pixel with the full coordinate system (including the SIP distortion), and interpolate the `WCS-WAVE` table there. Keep only exposures whose wavelength at the target is inside the range (`docs/SCIENCE.md`, section 1). Then cap to `max_frames` (default 40), spread evenly in time; `capped` says so.
5. **Cut out and resample.** Read only the block of `IMAGE` and `FLAGS` that covers the output after rotation, through `.section[...]` (`VARIANCE` is not read). Resample it onto one grid for all frames: a tangent plane centred on the frame centre, north up, east left, 6.15 arcseconds per pixel, an odd number of pixels wide (nearest requested width rounded up to odd, 9 to 95), the same as mock mode. Bilinear for the image (any contributing bad, missing or off-detector pixel makes the output empty; zero-weight neighbours do not count), nearest pixel for the flags. Steps 4 and 5 run `s3_concurrency` (default 16) files at once. A file that fails is skipped and counted in `warnings`.
6. **Render.** Subtract the median of the good pixels (zodiacal light). One asinh stretch is computed over all frames of the request and stored with each frame, so the blink does not flicker. Difference images subtract the reference frame's patch at the same centre, grey meaning no change, as in mock mode.

**Bright stars are flagged.** The core of a bright star carries bad-pixel bits (Barnard's Star at 1.1 micrometres: OVERFLOW, SUR_ERROR, TRANSIENT and BLOOM over a 6 by 6 pixel block, measured 2026-11-14). The mask is applied to everything quantitative (background, stretch, difference images), but the blink picture shows those pixels' own values, so a bright star is not drawn as a hole.

Measured on a home connection in Sri Lanka, 2026-11-14 (cold cache, 16 readers): Barnard's Star at 1.0 to 1.2 micrometres: 362 exposures found, 121 wavelength checks, 30 frames, 34 seconds. WISE 0855 at 4.4 to 5.0 micrometres, tracked: 258 found, 93 checks, 40 of 46 matching frames, 32 seconds. From the cache: about 0.1 seconds for the list and 0.1 to 0.5 seconds for all its images.

### Stacks (layer 2)

Code: `backend/app/stacking.py` (pure NumPy, tested without the network) and `stack_service.py` (inputs, cache, images). The science is in `docs/SCIENCE.md`, section 6.

1. **Inputs.** Steps 1 to 4 above give every exposure whose wavelength at the moving target is in range. Stacks use all of them up to `max_stack_frames` (default 150, environment variable `SM_MAX_STACK_FRAMES`), not the blink player's 40. Each patch is read centred on the object's predicted position at that exposure's time, which reuses a `/api/frames?track=true` cache entry when the centre and internal grid width match. Small stack crops use the same 21-pixel inputs as a 120-arcsecond tracked frame request; a smaller layer 1 patch has a different cache entry. In mock mode the inputs are 48 synthetic exposures in four visits about six months apart (`mock.stack_exposures`), drawn like the other mock images.
2. **Grid.** Stacks use an internal odd grid of at least 21 pixels for both modes, independent of the requested image crop, so S/N controls and motion fits survive small requested sizes. Measurements and display stretches are computed before cropping; returned image arrays and marker coordinates are cropped together. Stacks stay on the 6.15 arcsecond grid. The cache holds patches already resampled to it; a finer grid would mean reading every file again.
3. **Kinds.** `tracked`: the patches as they are. `static`: each patch shifted (bilinear, sub-pixel) onto one fixed grid centred on the object's position at the mean time of all exposures. `epoch`: the same fixed grid, one stack per visit; a gap of more than 30 days starts a new visit, visits with fewer than 5 exposures are skipped. Without proper motion there is no `static` (it would equal `tracked`).
4. **Combining.** Each exposure: its background and robust noise (1.4826 times the median absolute deviation) come from a fixed annulus 3 to 8 pixels from the grid centre, so changing field size does not change weights or background. Per pixel: values more than 4 times the larger of the exposure's noise and the spread across exposures from the median are dropped, masked pixels never count, and the rest are averaged with weights 1 / noise squared. A pixel with fewer than max(2, a quarter of the exposures) values is empty.
5. **Numbers.** S/N is the amplitude of a fixed Gaussian PSF (sigma 0.8 pixel) plus constant sky fitted in a 5 by 5 aperture, divided by the sample scatter of the identical measurement in local control apertures 4 to 7 pixels away. At least 20 complete controls are required. Their median is subtracted from the target amplitude; no maximum-pixel selection is used. Controls include correlated noise and field-source confusion. A missing target-aperture pixel means no S/N. A missing 3 by 3 core marks the source as `saturated`. Motion: each visit is fitted on its object-centred stack, at S/N at least 5 with a usable core. Saturated-core motion and errors are omitted, with a warning. In live mode, associate target data by predicted sky position within 3 arcseconds at each exposure date; when a known neighbour lies in the 5 by 5 fit region, fit two Gaussians: a moving target and the fixed catalogue neighbour from issue #4, each with its own amplitude and a shared fitted width. Known neighbours and their sources live in `targets.py`; selecting one adds a response warning. Mock mode has no catalogue-neighbour model. The fixed neighbour's grid position is averaged from that visit's exposures. Errors come from 200 bootstrap re-stacks and re-fits; each draw uses the corresponding neighbour positions. The visits' errors add in quadrature. Parallax enters the prediction when requested. Details and measured values: `docs/SCIENCE.md`, section 6.
6. **Pictures.** Empty pixels (flagged star cores) are drawn from the median of the unflagged values, as in the blink view. One stretch is shared by `single`, `tracked` and `static`, another by all epoch stacks, so they compare and blink cleanly. The `single` image is the exposure with the median S/N: typical, not lucky.

Measured on 2026-11-14 (same home connection): the WISE 0855 stack at 4.4 to 5.0 micrometres (46 exposures) takes 31 seconds with an empty cache (search, 93 wavelength checks, 46 patches, all images), 5.7 seconds when the layer 1 pre-warm has already cached 40 of the patches, and 0.01 seconds from the stack cache.

### Photometry (layer 3)

Code: `backend/app/photometry.py`. `scripts/check_accuracy.py` uses the same `measure()`.

1. **Inputs.** Steps 1 to 4 above, capped at `max_exposures`. Each exposure's patch is 21 pixels (120 arcseconds), centred on the object's position on that date, so it shares cache entries with a tracked 120-arcsecond frame request.
2. **Measurement.** Aperture radius 3 pixels; background is the median of an annulus 5 to 7.5 pixels; MJy/sr times the 6.15-arcsecond pixel solid angle gives Jy, reported as `uJy` in both modes. The parallax shift is added to the aperture position. Science, checks and limits: `docs/SCIENCE.md`, section 7.
3. **Error.** sigma * sqrt(N_ap + (pi / 2) * N_ap^2 / N_sky), with sigma the robust scatter (1.4826 times the median absolute deviation) of the annulus. Background noise only: on the 2MASS check star (0.14 Jy) the scatter between exposures was 3.8 %, far above the error bars. The panel says so.
4. **Unusable points.** Any empty aperture pixel (flagged, missing or off the detector), an aperture too near the patch edge, or too few background pixels gives `usable` false, `flux` and `flux_err` null (never a partial sum) and a `reason`, with the names of the problem flags. `flags` is the bitwise OR of the aperture pixels' flags. Empty annulus pixels are left out of the background.
5. **Cache.** The result is kept for `search_cache_hours`, keyed by the request, `PHOTOMETRY_VERSION`, the grid version and the collections. Empty results and results with search-failure warnings are not stored.

### WISE comparison (layer 4)

Code: `backend/app/wise.py`; front end `components/WiseCompare.tsx` and `src/wiseCompare.ts`.

1. **Tile.** AllWISE Atlas tiles (4095 x 4095 pixels of 1.375 arcseconds, about 1.56 degrees) on IRSA's AWS mirror (`settings.wise_bucket_url`, `settings.wise_atlas_prefix`). IRSA's search service is not used: folders are named after tile centres (`13/1342/1342m076_ac51`), so the server lists the RA folders around the position (cached for good; the archive is fixed) and takes the tile whose centre is nearest, if the position lies inside it.
2. **Reading.** Two range requests: the header (first 28,800 bytes, parsed up to the END card), then the contiguous rows of the patch. Astropy's `section` would fetch row by row; measured for a 300-arcsecond field: 74 s that way, 10 to 60 s this way depending on the connection. Then 0.05 s from the cache.
3. **Grid.** Bilinear resampling through the tile's WCS onto the requested centre and width, north up, east left, at 1.375 arcseconds, so the WISE image covers exactly the SPHEREx image's field. NaN (blank) where the field crosses the tile edge; `coverage` says how much has data, with a warning.
4. **Dates.** From the tile header: `DATEOBS1`, `DATEOBS2` (earliest and latest frame) and `MIDOBS`. The front end moves the target to `mjd_mid` with its proper motion to mark its 2010 position.
5. **Front end.** The panel compares the frame on screen (the middle frame when following the object), or in Stack mode the fixed-grid stack, with the WISE image of the same centre and width, side by side or blinking (`wise`, `cmp` in the URL). It marks the target on the SPHEREx date and on the WISE date, offers to widen the view when one is outside, and offers 4.4 to 5.0 micrometres with W2.

### Cache

- Folder: `settings.cache_dir` (environment variable `SM_CACHE_DIR`), default `backend/.cache`, git-ignored. Safe to delete.
- Patches: compressed NumPy files keyed by `exposure_id`, the centre (6 decimals, as in the image address), the width in pixels and the grid version. A small in-memory cache sits in front.
- Wavelength checks: per exposure and target position (4 decimals). The display stretch: per frame.
- Search results: per rounded position, for `search_cache_hours` (default 12); new data appears at most weekly.
- The exposure id to file address table, so `/api/frame.png` can read a patch that is not cached yet.
- Stacks: the result (`stack`, JSON with the two stretches) and its pictures (`stackimg`, one `.npz`), keyed by the normalised request (`StackRequest.normalised` in `stack_service.py`: a request within 0.01 arcsec of a built-in target takes its exact catalogue values, anything else is rounded to 1e-6 degree; the API and `scripts/prewarm.py` both use it, so the site's 7-decimal links hit the pre-warmed stacks), `max_stack_frames`, the collections and `STACK_VERSION` in `stack_service.py` (bump it when the stacking changes). Successful nonempty results are kept for `search_cache_hours`, then rebuilt from the cached patches. Empty results and results with search-failure warnings are not stored. Complete search failures remain HTTP 502; `/api/frames` likewise does not cache failed searches and recovers on the next request. Cold stacks are built one at a time (a lock), so the image requests that follow a slow `/api/stack` wait and then hit the cache.
- Pre-warm before the pitch: `python scripts/prewarm.py` (with the back end's environment) runs the five targets at fixed wavelength ranges, including WISE 0855 at 4.4 to 5.0 micrometres with tracking, and builds the stacks in its `STACKS` table (WISE 0855 at 4.4 to 5.0, Barnard's Star at 1.0 to 1.2 micrometres). Steps whose archive search failed (or fell back to a saved search) are retried once after `--retry-wait` seconds (default 90, longer than the IRSA cooldown); what still fails is listed at the end and the exit code is 1. Run it while IRSA answers, so the demo targets keep working during IRSA outages.
### Other data we point at

- All-sky SPHEREx map for Aladin Lite: `https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube`. A cube with 102 wavelength frames; frame index = 17 x (band - 1) + (channel - 1); frame indices are 0-based; frames 50 and 51 (2.399 and 2.445 µm) are blank: their tiles answer 404 while 49 and 52 load (checked 2026-11-15; this is said only in the free-text `obs_description`). Each frame's wavelength in µm is in the space-separated `data_cube_crval3_arr` of its `properties` file. The 2026-11-14 note that the numbering might start at 1 is superseded by that check.
- Solid angle of each pixel, per detector `k`: `nasa-irsa-spherex/dr1/solid_angle_pixel_map/cal-sapm-v3-2026-191/{k}/solid_angle_pixel_map_D{k}_spx_cal-sapm-v3-2026-191.fits`.
- Archive metadata tables through TAP: `spherex.artifact` and `spherex.plane`.

## The front end

### Desktop layout (issue #10)

The header centres the title and shows the URL position, wavelength range and unchanged data-mode badge. `ControlsDrawer` uses a native modal dialog (focus containment, Esc and backdrop dismissal). It opens on every page load, returns focus to the Controls button on close, and closes after a target is picked or the position form is applied; toggling "Follow the object" keeps it open.

The main row gives 40% to frames (minimum 520 px) and 60% to the tabbed workbench, with equal-height panels and independent scrolling for long stacks and measurements. The right tabs use arrow-key navigation. A frame-pixel click sets `phot=1` and `tab=spectrum`; opening the spectrum tab alone shows the existing measurement hint/button. Both plots are stacked vertically there. The sky map initialises only after its tab is first opened (so a spectrum-first link never initialises WebGL at zero size), then stays mounted while hidden, preserving its zoom and pending clicked point. The WISE comparison remains full width below, and footer credits are unchanged.

`tab=sky|spectrum` and `frame=ICRS|ICRSd|Galactic` are URL state (default sky tab and decimal ICRS). Old `phot=1` links without `tab` open the spectrum. An explicit `tab=sky` keeps a measurement available while looking at the map. Tab and frame changes are history entries, so Back and Forward restore them. Drawer, map expansion, zoom and unconfirmed clicks are temporary UI state.

`AladinPanel` overlays keyboard-usable `MapDropdown` controls, per-option explanations, zoom buttons/width label, expand and WiseView on the map. Zoom and the width label sit above Aladin Lite's logo in the bottom right corner, and the WiseView link sits to the logo's left, so the logo stays visible. Projection, Galactic conversion and sexagesimal formatting use the existing Aladin library. Position/zoom/resize events update markers and width; the current-position marker receives `mapRa`/`mapDec`, including the shown frame's moving position. A click only opens the point marker/popup. "Show frames here" calls the form's `viewForTypedPosition` helper to drop the old target's motion, parallax, epoch, name and tracking. Expansion fills the browser viewport, returns with Esc or the same button, and Aladin's built-in ResizeObserver redraws on the size change. Esc restores focus to the expand button. The initial canvas zoom update reapplies the opening field width once (1.5° on the starting place when no position is chosen, 0.5° with a position); later user zoom is preserved. A stable root scrollbar gutter prevents the drawer's scroll lock from changing the map width. No new dependency or API change.


- `src/urlState.ts` is the single source of view state. Parameters: `ra`, `dec`, `size` (arcseconds), `wlmin`, `wlmax`, `pmra`, `pmdec`, `epoch`, `speed` (frames per second), `mode` (`blink`, `diff` or `stack`), `track` (`1` to re-centre every frame on the moving object; left out when off), `tab` (`sky` or `spectrum`), `frame` (`ICRS`, `ICRSd` or `Galactic` for the map coordinates), `sky` (background survey in the wide-field sky map, in dropdown order: `spherex`, `wise` (default), `w1`, `w2`, then the others oldest first: `dss`, `iris`, `2mass`, `sdss`, `galex`, `irac`, `planck`; the table is `src/skyMaps.ts`), `skyf` (for a cube background: the frame shown, 1-based as its label shows it; left out, the frame nearest the middle of `wlmin`..`wlmax`, or frame 9 for SPHEREx with no range; a new `sky`, `wlmin` or `wlmax` drops it), `name`, `phot` (`1` shows the spectrum and light-curve panel), `pra` and `pdec` (a clicked point to measure; left out, the panel measures the target along its motion), `bin` (`1` for the binned spectrum), `wise` (`W1` or `W2` shows the WISE comparison), `cmp` (`blink` to blink the two images; side by side when left out). A link with these parameters reproduces the view, which also makes the tool embeddable in a frame.
- `src/api.ts` is the only file that calls the back end. Its types come from `src/api-types.ts`, generated from the contract with `npm run gen:api`.
- `BlinkPlayer` preloads every frame image and switches which one is visible, so playback does not flicker. In difference mode the first frame is the reference: it is shown as a plain image labelled "Reference frame: the others are shown minus this one", and every other frame minus it. Its pure helpers are in `src/blink.ts`.
- `StackView` (`mode=stack`) shows one exposure beside the tracked stack, the fixed-grid stack, a blink of the per-visit stacks with markers at the predicted positions, and the motion table. In this mode the page does not load the frame list. Its pure helpers are in `src/stackView.ts`. `ModeToggle` switches between the three modes.
- `PhotometryPanel` (layer 3) plots `/api/photometry` as a spectrum and a light curve using the generic `Chart.tsx`: pixel-sized responsive SVG with error bars, shared exposure highlights, pointer/keyboard tooltips, and missing-value lanes. API detector bands use the chart underlay hook; overlay and point-click hooks are available. The unchanged method and legend are in a native fold-out. Clicking a blink or difference frame, or a fixed-grid image in the Stack view (the fixed-grid stack and the per-visit stacks; the single exposure and the tracked stack follow the object, so they are not clickable unless there is no motion), sets `pra` and `pdec`. Both charts are coloured by wavelength; hovering any point shows its date, wavelength and bandpass, value or refusal reason. Pure helpers (units, binning, click to sky position) are in `src/photometry.ts`.
- `AladinPanel` shows the surrounding sky from existing surveys and is the place for catalogue overlays (Gaia, WISE).
- Aladin Lite comes from the npm package `aladin-lite`. It is loaded only when the sky map panel first appears (a lazy dynamic import, so it is a separate chunk). Its usage logging is off.
- With no position chosen, the sky map still opens, on the Orion Nebula at 1.5° wide (`DEFAULT_SKY_CENTRE` in `src/skyMaps.ts`, position from NED). It has no position marker and no WiseView link, and the starting place is not written to the URL. Clicking a spot and "Show frames here" chooses a position; choosing a position zooms to the usual 0.5°, and going back to no position (Back) widens to 1.5° again, in both cases only if the user has not zoomed since. The hint is hidden while a clicked point's pop-up is open.
- All backgrounds are HiPS tile sets that the browser fetches straight from IRSA, because the CDS tile servers did not answer on 2026-11-14. Each one is one entry in `src/skyMaps.ts` (address, label, explanation, and for a cube what its `properties` file does not say, such as blank frames).
- A background that is a multi-frame cube (today only SPHEREx) gets a wavelength slider (`CubeSlider`) at the bottom centre of the map. `src/hipsCube.ts` reads the survey's `properties` file once per address (wavelengths from `data_cube_crval3_arr`; if that is missing, approximate ones from `em_min`/`em_max`; if the file cannot be read, Aladin Lite's own `cubeDepth`/`emMin`/`emMax`), skips blank frames (SPHEREx 50 and 51, from `skyMaps.ts`), and picks the default frame. The frame is changed with `showCubeFrame` in `AladinPanel.tsx`, which relies on the frequency-to-frame behaviour of the pinned aladin-lite version (its `setSliceNumber` picks the wrong frame), so re-check it if the version changes. Dragging changes only the label; the map follows 200 ms after the slider rests, because Aladin Lite draws a frame before its tiles arrive.
- In development the Vite server forwards `/api` to `http://localhost:8000`. In production the site calls the address in `VITE_API_BASE`, or the same origin if that is empty.

## Hosting

Planned: DigitalOcean App Platform, one app with two components, in a region near the AWS `us-east-1` mirror.

- `api`: the back end as a container (`backend/Dockerfile`), with `SM_MODE=live`.
- `web`: the front end as a static site built with `npm ci` and `npm run build`.
- Requests to `/api` go to the back end; everything else to the static site.

`.do/app.yaml` is a **draft** of this. It has not been deployed or validated.

## Adding a new data release

Add its collection name to `collections` in `backend/app/config.py` (or set `SM_COLLECTIONS` in the hosting dashboard). Nothing else should need to change. If something else does, that is a bug: fix the place that hard-coded the old name.

## Independent alignment check (issue #22, first deliverable)

`app/astrometry.py` implements `/api/alignment`, an explicit per-exposure check separate from frame loading. It detects clean original-pixel sources and compares them to epoch-propagated reference positions. It never changes archive WCS or spectral lookup. A median translation is diagnostic only; no refined image is served. Catalogue and TAP address live in config; the default is Gaia DR3, with licence/acknowledgement pending #27.

Two native readers may run concurrently. The async route returns after `SM_ASTROMETRY_TIMEOUT_S` (default 30 seconds); timed-out readers retain their slot until exit. Network I/O uses `SM_ASTROMETRY_IO_TIMEOUT_S` (default 10 seconds per operation). Completed diagnostics are cached one day by solver version, immutable exposure URL (including processing version), catalogue service, displayed centre and excluded target. Failures are not cached. Existing science caches are untouched.

`AlignmentPanel` always appears above blink/difference frames; “Check this frame” requests the check. Stale asynchronous responses are excluded. `matches=0` is URL state. Stack and WISE panels retain explicitly unverified archive provenance. The reference table handles its own arrow/Space scrolling and prevents document-level playback shortcuts from consuming those keys. This PR does not change the page-wide responsive layout. See `PLATE_SOLVING_VALIDATION.md` for tests, limits and remaining work.

Cached alignment results are returned before acquiring a native-reader slot. Mirror HTTP/transport errors use the structured failed-check path. The nominal reference cone is the patch half-diagonal plus a one-pixel matching margin, rather than the full patch width; the 500-source safety cap still rejects oversized catalogues. Solver cache version v3 invalidates older diagnostics. `quality_passed` reports the outcome of all gates independently of mock/live provenance. Matches expose `offset_arcsec` (absolute catalogue-to-centroid separation) and `fit_residual_arcsec` (distance from the median offset used to classify inliers). The legacy `residual_arcsec` field keeps its original total-offset meaning for compatibility.
