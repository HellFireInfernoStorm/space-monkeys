# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
People curious about the changing sky, including visitors without astronomy training. They need to find a patch of sky and understand whether a point moved or changed between observations.

## Product Purpose
Display SPHEREx sky images over time at a chosen Right Ascension and Declination, so the public can inspect motion and brightness changes. A visitor succeeds when they can select a target or enter coordinates, play comparable exposures, and understand what they are looking at.

## Operating Context
A public browser tool and a five-minute challenge demonstration. Visitors may arrive through a shared URL. Real archive requests can take 30 to 90 seconds; mock mode supplies labelled synthetic data.

## Capabilities and Constraints
The existing tool has image playback, differences, tracked and fixed stacking, a wider sky map, and a WiseView link. The API and science calculations stay fixed for the redesign. All view state is represented by `frontend/src/urlState.ts`. Wavelengths at the target must be close for meaningful blink and difference comparisons. No NASA logos, insignia, flags, or mission patches are used.

## Evidence on Hand
The repository contains cited science notes in `docs/SCIENCE.md`, five target presets, mock images, and live archive integration. Mock images are synthetic and must remain clearly identified. No decorative imagery is planned.

## Product Principles
- Let the observation image lead; give controls a clear supporting role.
- Make scientific limits and data mode visible where decisions are made.
- Keep the coordinate workflow usable without astronomy experience.
- Preserve deep links and make long waits understandable.
