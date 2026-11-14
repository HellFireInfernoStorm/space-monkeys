# Current UI baseline

Captured on 2026-11-14 from `http://localhost:5173/` at commit `4861e94` with the local front end and back end running. These are browser screenshots of the existing UI, not design proposals. The application showed **Mock data (synthetic, not real sky)** throughout.

| Screenshot | State | Viewport |
| --- | --- | --- |
| `desktop-initial.png` | Initial page, before choosing a target | 1440 × 900 |
| `desktop-wise0855-images.png` | WISE 0855 preset, Images view | 1440 × 900 |
| `desktop-wise0855-difference.png` | WISE 0855 preset, Difference from first view | 1440 × 900 |
| `desktop-wise0855-stacked.png` | WISE 0855 preset, Stacked view | 1440 × 900 |
| `mobile-wise0855-stacked.png` | WISE 0855 preset, Stacked view | 390 × 844 |

## Recreate the states

Open the local URL. Choose **WISE 0855** in the Target panel; the preset loads frames automatically. Use the **Images**, **Difference from first**, and **Stacked** controls for the three populated desktop states. Resize to 390 × 844 for the narrow capture. The frame/visit and wider sky map can change over time, so these captures are a visual baseline rather than pixel-perfect test fixtures.

## Visible layout and controls

- A dark page with a title, a prominent mock-data badge, three desktop columns, and a footer. At 390 px the columns stack vertically.
- Left: target presets, target description, coordinate and wavelength inputs, motion inputs, a follow-object checkbox, and Show.
- Middle: frame image, date and wavelength metadata, playback and speed controls, and Images / Difference / Stacked modes. Stacked adds exposure comparisons, visit playback, and a motion table.
- Right: wider-view sky map, WISE / SPHEREx survey controls, and an outbound WiseView comparison link.

These screenshots document only what the browser displayed in mock mode. They do not verify real-data accuracy or other viewport sizes.
