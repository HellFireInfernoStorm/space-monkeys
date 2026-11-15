# Issue #10 layout checks

Checked locally on 2026-11-15 in the Codex in-app browser, with the existing mock and live APIs. This is layout validation, not new science validation or a deployed-site acceptance check.

## Automated checks

- `npm run typecheck`: passed.
- `npm test`: 53 tests passed, including the `frame`/`tab` combinations, legacy `phot=1` links and history classification.
- `npm run build`: passed. Vite still warns about the existing large Aladin chunk; the library remains lazily imported.
- `git diff --check`: passed.
- Compared the footer, WISE comparison JSX and comparison-image selection with main: unchanged. No API, generated types or backend changes.

## Browser checks

The mock preview was checked at 1440 × 900 and 1280 × 800. At 1280 px the frames panel is 520 px wide and the right panel is 697 px; at 1440 px they are about 551 and 826 px. Each pair has equal height. Long stack content and the motion table scroll within the frames panel and fit its width; spectrum and light curve stack vertically and scroll within their tab.

- Drawer opens on fresh load and reload; target selection closes it. Close, Esc and a click on the backdrop dismiss it. Focus starts on Close and returns to Menu. Native modal-dialog behaviour contains keyboard focus.
- Pixel click opens the spectrum tab, shows the measurement loading state and then charts. Arrow keys move between the tabs. The measurement hint/button is present before measuring.
- Coordinate listbox supports arrow keys, Home/End and Enter; The default decimal ICRS selector, plus ICRS sexagesimal and Galactic popup values, were checked. Explanations appear on keyboard focus, including the active option. Hover styles are implemented in CSS; a separate hover-only sweep was not performed.
- Both sky-survey options update the URL. No map-click marker is created by using the floating controls.
- The zoom-in button updates the width label. Wheel zoom changed the label from 16.3 to 5.6 arcminutes. Tab switching preserved a zoomed view at 10.9 arcminutes.
- Expand fills the browser viewport at both sizes; Esc returns and the map redraws. This uses a viewport overlay, not the browser's native fullscreen API.
- Map click opens a marker and coordinates without changing the URL position; "Show frames here" changes the position and removes the previous target's name, motion, parallax and tracking from the URL.
- Barnard's Star mock marker follows the selected frame: first RA 269.4464152°, Dec 4.7663148°; last RA 269.4461897°, Dec 4.7692203°. It is not fixed at the catalogue position.
- Reload restored the Galactic coordinate system and spectrum tab. Back/Forward restored the previous tab. A spectrum-first link now waits to initialise WebGL until the sky tab is visible, avoiding a zero-size map; that path was rechecked.
- Mock badge and all footer credits remain. No warnings or errors were captured in the mock preview's browser console during the final checks.

## Live checks and remaining work

Both WISE 0855 (stack, 4.4–5.0 µm) and Barnard's Star (blink, 1.0–1.2 µm) were requested in live mode. Barnard's Star returned 20 real DR1 frames once, with explicit warnings that three other collections failed. A subsequent attempt failed completely. WISE 0855 failed its archive search on three attempts, including after reload. Errors included `HTTP Code: 502 Proxy Error` at `https://irsa.ipac.caltech.edu/SIA/capabilities` and HTTP 502 on collection queries.

The live badge, loading/error states and usable map controls were checked. A complete two-target live-data walkthrough, including WISE 0855's stack and the moving marker during real-frame playback, remains unverified. The pull request stays draft until that check can be completed. No backend workaround or science change was introduced.

Next action: once IRSA responds reliably, run the live API and open WISE 0855 in Stack mode, then Barnard's Star in Images mode. Repeat the issue #10 interaction checklist with their real images before requesting review. Do not treat mock screenshots or a partial archive search as full live verification.

## Screenshots

All mock screenshots label their synthetic data; the sky map is the existing external WISE context survey.

| View | 1440 × 900 | 1280 × 800 |
| --- | --- | --- |
| Controls drawer | [Screenshot](screenshots/issue-10/drawer-1440.jpg) | [Screenshot](screenshots/issue-10/drawer-1280.jpg) |
| Sky map | [Screenshot](screenshots/issue-10/sky-map-1440.jpg) | [Screenshot](screenshots/issue-10/sky-map-1280.jpg) |
| Spectrum tab | [Screenshot](screenshots/issue-10/spectrum-1440.jpg) | [Screenshot](screenshots/issue-10/spectrum-1280.jpg) |

[Mock stack layout](screenshots/issue-10/stack-1280.jpg); [partial live Barnard result](screenshots/issue-10/live-barnard-partial-1280.jpg).
