import { useEffect, useRef, useState } from "react";

import type { AladinApi, AladinHiPS, AladinInstance } from "aladin-lite";

import type { SkyLayer } from "../urlState";

// Aladin Lite (CDS, Strasbourg) comes from the npm package "aladin-lite", pinned to one
// version in package.json. It is large, so it is fetched only when this panel first appears.

// Background surveys, both served by IRSA as HiPS tile sets. The addresses are given in full
// because the short CDS names ("P/allWISE/color") resolve to CDS servers that did not
// answer when this was written (2026-11-14). The SPHEREx all-sky cube is experimental here.
const SURVEYS: Record<SkyLayer, string> = {
  wise: "https://irsa.ipac.caltech.edu/data/hips/CDS/AllWISE/RGB-W4-W2-W1",
  spherex: "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube",
};

const SURVEY_NAMES: Record<SkyLayer, string> = {
  wise: "WISE",
  spherex: "SPHEREx all-sky",
};

// The SPHEREx cube has 102 frames (6 bands of 17 channels, shortest wavelength first).
// Aladin Lite opens it at frame 50, which is empty, so one frame is chosen here.
// Frame 8 is in band 1. Showing the frame that matches the wavelength range is not built yet.
const SPHEREX_CUBE_FRAME = 8;

const SPEED_OF_LIGHT_M_PER_S = 299792458;
const FIELD_OF_VIEW_DEG = 0.5;

let loading: Promise<AladinApi> | null = null;

function loadAladin(): Promise<AladinApi> {
  if (!loading) {
    loading = import("aladin-lite")
      .then(async (module) => {
        const api = module.default;
        // Resolves once the WebAssembly part has started; rejects without WebGL2.
        await api.init;
        return api;
      })
      .catch((error: unknown) => {
        loading = null;
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not start the sky map (Aladin Lite): ${reason}`);
      });
  }
  return loading;
}

/**
 * Aladin Lite 3.9 picks a cube frame from a frequency, spreading the frames evenly in
 * frequency between the two ends the survey declares. This turns a frame number back
 * into the wavelength to ask for. Checked in the browser against the tile requests.
 */
function showCubeFrame(survey: AladinHiPS, frame: number) {
  if (!survey.cubeDepth || !survey.emMin || !survey.emMax) return;
  const lowest = SPEED_OF_LIGHT_M_PER_S / survey.emMax;
  const highest = SPEED_OF_LIGHT_M_PER_S / survey.emMin;
  const frequency = lowest + ((frame + 0.5) / survey.cubeDepth) * (highest - lowest);
  survey.setFrequency({ value: SPEED_OF_LIGHT_M_PER_S / frequency, unit: "m" });
}

interface Props {
  ra: number;
  dec: number;
  sky: SkyLayer;
  onSky: (sky: SkyLayer) => void;
}

/** A wide-field sky map centred on the position, for context around the small frames. */
export default function AladinPanel({ ra, dec, sky, onSky }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<{ api: AladinApi; aladin: AladinInstance } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Start the map once. The position at that moment comes from a ref,
  // so later changes do not rebuild it.
  const latest = useRef({ ra, dec, sky });
  latest.current = { ra, dec, sky };

  useEffect(() => {
    let cancelled = false;
    loadAladin()
      .then((api) => {
        if (cancelled || map.current || !holder.current) return;
        const now = latest.current;
        const aladin = api.aladin(holder.current, {
          // Name a survey here, or Aladin Lite first asks a CDS server for its own default.
          // The effect further down sets it again with the error and frame handling.
          survey: api.HiPS(SURVEYS[now.sky]),
          fov: FIELD_OF_VIEW_DEG,
          target: `${now.ra} ${now.dec}`,
          cooFrame: "ICRSd",
          showFullscreenControl: false,
          showLayersControl: false,
          showProjectionControl: false,
          // Aladin Lite otherwise reports each start, with this page's full address, to a
          // usage log at CDS. Our address holds the position being viewed, so keep it off.
          log: false,
        });
        map.current = { api, aladin };
        setReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) setProblem(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (ready) map.current?.aladin.gotoRaDec(ra, dec);
  }, [ready, ra, dec]);

  useEffect(() => {
    if (!ready || !map.current) return;
    let cancelled = false;
    const { api, aladin } = map.current;
    setProblem(null);
    const survey = api.HiPS(SURVEYS[sky], {
      successCallback: (loaded) => {
        if (!cancelled && sky === "spherex") showCubeFrame(loaded, SPHEREX_CUBE_FRAME);
      },
      // Without this, a survey that cannot be reached leaves an empty map and no message.
      errorCallback: () => {
        if (cancelled) return;
        setProblem(
          `The ${SURVEY_NAMES[sky]} background could not be loaded from IRSA, so the map is empty. ` +
            "The frames above do not depend on it.",
        );
      },
    });
    aladin.setBaseImageLayer(survey);
    return () => {
      cancelled = true;
    };
  }, [ready, sky]);

  return (
    <div>
      <div className="toggle" role="group" aria-label="Background survey">
        <button
          type="button"
          className={sky === "wise" ? "chip active" : "chip"}
          onClick={() => onSky("wise")}
        >
          WISE (2010)
        </button>
        <button
          type="button"
          className={sky === "spherex" ? "chip active" : "chip"}
          onClick={() => onSky("spherex")}
          title="One frame (band 1) of the SPHEREx all-sky map from IRSA. Experimental."
        >
          SPHEREx all-sky (experimental)
        </button>
      </div>
      {problem && <p className="notice error">{problem}</p>}
      <div ref={holder} className="aladin" />
    </div>
  );
}
