# Guided sky viewer

## Visual direction
A calm, dark image workspace. The existing observation image is the focal point; there is no decorative artwork, texture, or generated imagery. Use the existing system font stack. Surfaces are `#0B1117` and `#141D25`, primary text `#EDF3F5`, active controls `#8BD0C8`, and the predicted-position marker `#F3C963`. Warning and error colors are reserved for those states.

## First view
An empty URL opens Barnard's Star in Images mode and writes its preset into the shareable URL. The header names the tool and shows mock or live mode. The target picker and coordinate fields lead into a large square observation viewer; the wider sky map is secondary.

## Layout and behavior
Desktop uses a compact control rail and a broad image workspace. The workspace gives playback and mode controls immediate proximity to the image, with visit comparisons and motion data below in Stack mode. Tablet and phone layouts preserve the same order without horizontal page scrolling. Advanced wavelength, size, and motion fields are grouped behind a clear disclosure. The map follows the image workspace.

Loading keeps image-sized space reserved and reports elapsed time without a fictitious percentage. Errors state the problem and offer retry. Invalid inputs receive messages beside their fields. Keyboard focus remains visible; labels and values remain legible at phone width.

## Boundaries
The API, scientific calculations, and caption claims remain unchanged except for the four corrections in issue #2. No outside font, icon, image, or library is added. Name search is visibly marked as unavailable until implemented.
