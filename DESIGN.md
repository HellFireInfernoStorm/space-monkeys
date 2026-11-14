# Guided sky viewer

## Visual direction
A calm, dark image workspace. The existing observation image is the focal point; there is no decorative artwork, texture, or generated imagery. Use the existing system font stack. Surfaces are `#0B1117` and `#141D25`, primary text `#EDF3F5`, active controls `#8BD0C8`, and the predicted-position marker `#F3C963`. Warning and error colors are reserved for those states.

## Reference translation

- [Vision AI](https://dribbble.com/shots/27091362-Vision-AI-Medical-Imaging-Interface-Concept): the target list acts as image-series navigation; the image stays the main work surface.
- [Solar system App](https://dribbble.com/shots/25913923-Solar-system-App) and [Space Exploration](https://dribbble.com/shots/27846482-Space-Exploration-Website-Design): use a large visual field and dark negative space, supplied by the actual sky image.
- [Spacecraft Command Dashboard](https://dribbble.com/shots/27171089-Futuristic-Spacecraft-Command-Dashboard-Sci-Fi-Spaceship-UI): keep modes and playback close to the visual they control.
- [Space Tourism](https://dribbble.com/shots/27594508-Space-Tourism-Landing-Page-by-Alex-Pavlov) and [Futuristic And Clean](https://dribbble.com/shots/26232530-UI-for-Space-Tourism-Futuristic-And-Clean): carry over strong contrast and spare chrome, without their marketing hero structure or additional imagery.

## First view
An empty URL opens Barnard's Star in Images mode and writes its preset into the shareable URL. The header names the tool and shows mock or live mode. The target picker and coordinate fields lead into a large square observation viewer; the wider sky map is secondary.

## Layout and behavior
Easy Mode supplies the Pick, Watch, Compare flow. Observatory supplies the image timestamp and thumbnails from the current exposure sequence. On desktop the image fits the available height, with playback and thumbnails below and comparison options alongside. On phones the preset dropdown leads to the image, playback, and comparison controls. Open Browse frames to see dated thumbnails. Frame details, coordinates, and the wider sky map each have their own disclosure. At narrower or zoomed widths the columns stack. The frame slider exposes its current frame and UTC timestamp to assistive technology.

Loading keeps image-sized space reserved and reports elapsed time without a fictitious percentage. Errors state the problem and offer retry. Invalid inputs receive messages beside their fields. Keyboard focus remains visible; labels and values remain legible at phone width.

## Boundaries
The API, scientific calculations, and caption claims remain unchanged except for the four corrections in issue #2. No outside font, icon, image, or library is added. Name search is visibly marked as unavailable until implemented.
