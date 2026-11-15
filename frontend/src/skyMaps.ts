// The background maps of the wide-field sky map, in one table. A new map is one entry here
// (plus a line in docs/RESOURCES.md); its `value` becomes a valid `sky=` URL value.
// All are HiPS tile sets on IRSA's mirror, because the CDS tile servers did not answer
// on 2026-11-14. Every `properties` file below answered with CORS allowed on 2026-11-15.

import type { CubeConfig } from "./hipsCube";

export interface SkyMap {
  /** The `sky=` URL value. */
  value: string;
  /** HiPS address, without a trailing slash. */
  url: string;
  label: string;
  /** Plain-language explanation shown in the dropdown. */
  help: string;
  /** Only for a multi-frame cube: what its `properties` file does not say. */
  cube?: CubeConfig;
}

const IRSA = "https://irsa.ipac.caltech.edu/data/hips/";

/** Dropdown order is time order: oldest pictures first. */
export const SKY_MAPS = [
  {
    value: "dss",
    url: IRSA + "CDS/DSS2/color",
    label: "DSS colour (1950s–1990s)",
    help: "The oldest picture here: photographic plates of the whole sky taken from the 1950s to the 1990s, in visible light. Good for seeing nearby stars move over decades.",
  },
  {
    value: "iris",
    url: IRSA + "CDS/IRIS/color",
    label: "IRAS colour (1983)",
    help: "An infrared map of the whole sky from the IRAS space telescope, 1983. It shows glowing dust, not stars, and looks blurry when you zoom in.",
  },
  {
    value: "2mass",
    url: IRSA + "CDS/2MASS/Color",
    label: "2MASS colour (1997–2001)",
    help: "A near-infrared map of the whole sky from ground telescopes, 1997 to 2001, at 1.2 to 2.2 µm: the same light as SPHEREx's short-wavelength end.",
  },
  {
    value: "sdss",
    url: IRSA + "CDS/SDSS/DR9/color",
    label: "SDSS colour (2000s)",
    help: "Sharp visible-light pictures from a ground telescope in the 2000s. It covers only about a third of the sky; elsewhere the map is empty.",
  },
  {
    value: "galex",
    url: IRSA + "CDS/GALEX/GR6-03-2014/AIS-Color",
    label: "GALEX ultraviolet (2003–2013)",
    help: "Ultraviolet light, from the GALEX space telescope, 2003 to 2013. It covers about 80% of the sky.",
  },
  {
    value: "irac",
    url: IRSA + "CDS/SPITZER/IRAC1",
    label: "Spitzer 3.6 µm (2003–2009)",
    help: "Detailed infrared pictures at 3.6 µm from the Spitzer space telescope, 2003 to 2009. It covers only small patches (about 1.4% of the sky), so the map is usually empty.",
  },
  {
    value: "planck",
    url: IRSA + "CDS/PLANCK/R2/HFI/color",
    label: "Planck dust colour (2009–2013)",
    help: "Cold dust across the whole sky, seen in microwaves by the Planck space telescope, 2009 to 2013. Very blurry when you zoom in.",
  },
  {
    value: "wise",
    url: IRSA + "CDS/AllWISE/RGB-W4-W2-W1",
    label: "WISE colour (2010)",
    help: "An infrared picture of the whole sky, taken by the WISE space telescope around 2010. Compare it with SPHEREx to see what has moved since.",
  },
  {
    value: "w1",
    url: IRSA + "CDS/AllWISE/W1",
    label: "WISE W1 3.4 µm (2010)",
    help: "One WISE band, at 3.4 µm, in black and white, from around 2010.",
  },
  {
    value: "w2",
    url: IRSA + "CDS/AllWISE/W2",
    label: "WISE W2 4.6 µm (2010)",
    help: "One WISE band, at 4.6 µm, in black and white, from around 2010. Cold brown dwarfs show best here.",
  },
  {
    value: "spherex",
    url: IRSA + "SPHEREx/spherex_allsky_cube",
    label: "SPHEREx all-sky (2025)",
    help: "SPHEREx's own map of the whole sky in 102 infrared wavelengths, with a slider to pick the wavelength. It is the average of all its pictures, so the slider changes wavelength, not time.",
    cube: {
      // Said only in the free-text obs_description; their tiles answer 404 (checked 2026-11-15).
      blankFrames: [50, 51],
      // 6 bands of 17 channels: frame = 17 x (band - 1) + (channel - 1).
      framesPerBand: 17,
      // Frame 9 (0.910 µm, band 1), used when no wavelength range is chosen.
      defaultFrame: 8,
    },
  },
] as const satisfies readonly SkyMap[];

export type SkyLayer = (typeof SKY_MAPS)[number]["value"];

export function skyMap(value: SkyLayer): SkyMap {
  return SKY_MAPS.find((map) => map.value === value)!;
}

export function isSkyLayer(value: string | null): value is SkyLayer {
  return SKY_MAPS.some((map) => map.value === value);
}
