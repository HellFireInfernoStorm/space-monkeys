# Project page draft

Text for the Space Apps project page. Everything here is a draft until the feature it describes works on the deployed site. Do not claim a layer that is not ticked in `docs/ACCEPTANCE.md`.

Limits: summary 50 to 200 words. Demo: at most 7 slides, or a 30-second video with English subtitles, at a public link that needs no login.

## Team

space-monkeys, Colombo (virtual).

## Challenge

Planet X and SPHEREx

## Project name

SpaceShift (built by team space-monkeys).

## High-level summary (50 to 200 words)

> DRAFT, about 110 words. Rewrite once we know which layers are live.
>
> SPHEREx photographs the whole sky in infrared light every six months, but its images are hard to compare: each one sees a given star at a different wavelength. Our tool takes a sky position and plays the SPHEREx images of that spot as a short video, matched by wavelength so that what changes on screen is real. It follows fast-moving objects using their known motion, and adds many faint exposures together along that path, so that objects too dim to see in any single image appear. Anyone can share a view with a link. We tested it on five targets, including WISE 0855, the coldest known brown dwarf.

## Link to project demo

To be added. Slides or video; check the link in a private browser window.

## Link to final project

Deployed site: to be added.
Repository: to be added.

## Project details

Suggested headings; fill each with two to five sentences.

### What it does

### How it works

Search of the SPHEREx archive at IRSA; byte-range reads of only the needed patch from the AWS mirror; wavelength matching; motion tracking; stacking.

### What is new

Existing tools show SPHEREx spectra precisely but slowly, and not as a time sequence. Ours is built around change over time.

### What we checked

The five test targets and what each one showed. Honest limits: quick-look brightness values, coverage gaps, anything that did not work.

### What we would do next

## Use of artificial intelligence

Copy the current statement from `docs/AI_USAGE.md`.

## NASA data

Copy the "NASA data" table from `docs/RESOURCES.md`, with links.

## Space agency partner and other data

Copy the remaining tables from `docs/RESOURCES.md`.

## References

Copy the citations and the SPHEREx acknowledgement from `docs/RESOURCES.md`.

## Pitch outline (5 minutes)

1. The problem in one sentence (20 seconds)
2. Live: Barnard's Star moving (60 seconds)
3. Live: why wavelength matching matters, with a variable star (60 seconds)
4. Live: WISE 0855 appears out of noise in the tracked stack (90 seconds)
5. Share a link; new data release is one configuration line (30 seconds)
6. What it means and what is next (40 seconds)
