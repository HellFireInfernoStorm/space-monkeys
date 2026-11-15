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

- Drawer opens on fresh load and reload; target selection closes it. Close, Esc and a click on the backdrop dismiss it. Focus starts on Close and returns to the Controls button. Native modal-dialog behaviour contains keyboard focus.
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

The initial run hit intermittent IRSA HTTP 502 errors: Barnard's Star returned only 20 DR1 frames once and WISE 0855 failed three times. **The requested two-target check was rerun successfully on 2026-11-15**, with the unchanged application code:

| Check | Result |
| --- | --- |
| Frontend commands rerun | `npm run typecheck`, all 53 tests and `npm run build` passed; the existing Aladin chunk warning remains |
| Mock API on port 8000 and dev preview | Health reported `mock`; WISE Stack view loaded its images and table; Barnard Images view and frame-dependent marker worked |
| Live WISE 0855, 4.4–5.0 µm, Stacked | 46 of 46 matching exposures, uncapped; tracked S/N 14.18, static S/N 11.44; two visit stacks and motion table displayed. Every displayed stack PNG loaded. No archive-failure warning; the known-neighbour warning remains |
| Live WISE motion table | Later visit 3.90 ± 0.57 arcseconds west and 0.99 ± 0.56 north, against 4.44 west and 0.54 north predicted; these reproduce the existing documented results |
| Live Barnard's Star, 1.0–1.2 µm, Images | 30 of 30 matching frames, uncapped, from DR1 and QR3; API warnings empty; all 30 PNGs loaded |
| Real-frame playback | Play advanced Barnard's Star from the first observation to frame 24 (2026-08-21); Pause stopped it |
| Real-frame marker | First frame RA 269.4463493°, Dec 4.7671641°; last frame RA 269.4461213°, Dec 4.7701011°. The marker follows the observation rather than the old catalogue position |
| Browser console | No warning/error messages captured during the successful live checks |

The live Stack-pixel click was also checked to open the spectrum tab and show "Measuring every exposure…". That additional measurement was not awaited to completion before switching targets, so this is not a new live photometry validation.

The previous archive blocker is resolved for the requested check. A complete repeat of every issue #10 interaction in live mode and a separate hover-only tooltip sweep have not been performed; the mock interaction checks above remain the evidence for those controls. No backend workaround, science change or application code change was introduced during this rerun. The PR remains draft; this validation run did not request review or merge it.

## Active-tab styling correction

A merge-readiness check found that the generic `button:not(...)` selector had higher specificity than the tab rules. Both tabs therefore rendered with the same text colour and 1 px border, despite the correct `aria-selected` state. On 2026-11-15 the exclusions were moved into `:where(...)`, reducing the base selector's specificity so the component's own rules apply.

Checked both selections in the browser: the active tab has accent text and a 3 px accent underline (`rgb(124, 196, 255)`); the inactive tab has muted text and a transparent 3 px underline. Clicking the other tab moves the highlight. Type checking, all 53 tests and the production build passed again. No behaviour, API or science code changed.

Latest screenshots: [Sky map active](screenshots/issue-10/tab-highlight-sky.jpg), [Spectrum active](screenshots/issue-10/tab-highlight-spectrum.jpg). The earlier screenshots below predate this styling correction.

## Owner review follow-up

Addressed the two non-blocking map findings from the owner's PR #11 review on 2026-11-15:

- **Esc focus:** after expanding, clicking inside the map and pressing Esc, the map collapses and `document.activeElement` is the "Expand sky map" button.
- **Starting width:** Aladin's initial canvas resize changed the constructor's effective field. The first zoom update now reapplies 0.5° once. Reserving the root scrollbar gutter also prevents closing the drawer's scroll lock from narrowing the field again. Fresh loads show **30.0 arcminutes** at both 1440 × 900 and 1280 × 800. Zooming in gives 20.0 arcminutes; switching tabs and reopening/closing the drawer keep 20.0. A spectrum-first Galactic link initialises at 30.0 when its sky tab is first opened and retains the Galactic setting.
- **History:** tab switches remain history entries, as already documented and accepted in the review. No behaviour change was made for this informational note.

Type checking, all 53 tests and production build passed again. No warning/error messages were captured in these browser checks. Screenshots: [initial 30-arcminute view](screenshots/issue-10/review-initial-view.jpg), [focus after Esc](screenshots/issue-10/review-escape-focus.jpg).

## Screenshots

All mock screenshots label their synthetic data; the sky map is the existing external WISE context survey.

| View | 1440 × 900 | 1280 × 800 |
| --- | --- | --- |
| Controls drawer | [Screenshot](screenshots/issue-10/drawer-1440.jpg) | [Screenshot](screenshots/issue-10/drawer-1280.jpg) |
| Sky map | [Screenshot](screenshots/issue-10/sky-map-1440.jpg) | [Screenshot](screenshots/issue-10/sky-map-1280.jpg) |
| Spectrum tab | [Screenshot](screenshots/issue-10/spectrum-1440.jpg) | [Screenshot](screenshots/issue-10/spectrum-1280.jpg) |

[Mock stack layout](screenshots/issue-10/stack-1280.jpg); [partial live Barnard result](screenshots/issue-10/live-barnard-partial-1280.jpg).

Successful rerun: [real WISE 0855 stack](screenshots/issue-10/live-wise-stack.jpg); [real Barnard playback](screenshots/issue-10/live-barnard-blink.jpg). These are live-data screenshots, not mock examples. The earlier partial result is retained as historical evidence only.
