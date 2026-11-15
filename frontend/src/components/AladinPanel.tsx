import { useEffect, useMemo, useRef, useState } from "react";

import type { AladinApi, AladinHiPS, AladinInstance } from "aladin-lite";

import { chooseFrame, cubeFromProperties, cubeFromSurvey, loadProperties, type CubeInfo } from "../hipsCube";
import { SKY_MAPS, skyMap } from "../skyMaps";
import type { CoordinateFrame, SkyLayer, ViewState } from "../urlState";
import CubeSlider from "./CubeSlider";
import MapDropdown, { type MapOption } from "./MapDropdown";

// Aladin Lite (CDS, Strasbourg) comes from the npm package "aladin-lite", pinned to one
// version in package.json. It is large, so it is fetched only when this panel first appears.

// Background surveys: addresses, labels and explanations are in one table, `skyMaps.ts`.
// The addresses are given in full because the short CDS names ("P/allWISE/color") resolve
// to CDS servers that did not answer when this was written (2026-11-14).

// A survey that is a multi-frame cube (the SPHEREx cube: 102 frames, 6 bands of 17 channels,
// shortest wavelength first) gets a wavelength slider. Aladin Lite opens a cube at its middle
// frame, which for SPHEREx is empty, so the frame is always set here: the one in the URL
// (`skyf`), or the one nearest the middle of the wavelength range (`hipsCube.ts`).

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

const SKY_OPTIONS: readonly MapOption<SkyLayer>[] = SKY_MAPS.map(({ value, label, help }) => ({ value, label, help }));
const FRAME_OPTIONS: readonly MapOption<CoordinateFrame>[] = [
  { value: "ICRS", label: "ICRS", help: "The standard grid for the sky, like longitude and latitude on Earth. Right ascension in hours, minutes, seconds; declination in degrees." },
  { value: "ICRSd", label: "ICRS (decimal)", help: "The same grid in decimal degrees, for example 133.79, −7.24. Easiest to copy into other tools." },
  { value: "Galactic", label: "Galactic", help: "A grid lined up with the Milky Way; 0° points at the centre of our galaxy. Shows whether something lies in the galaxy's disc." },
];
const WISE_HELP = "Opens WiseView, a separate website, in a new tab. It flips through WISE images of this spot from 2010 to today, so you can check over 15 years whether something moved. It starts where the object was in 2014, the middle of the WISE years.";
const EXPAND_HELP = "Fills the whole screen with the sky map. Press Esc or the button again to go back.";

type Point = { ra: number; dec: number };
type ScreenPoint = [number, number] | null;
interface Props {
  ra: number;
  dec: number;
  sky: SkyLayer;
  /** Wavelength range and chosen cube frame (1-based), from the URL. */
  wlmin: number | null;
  wlmax: number | null;
  skyf: number | null;
  frame: CoordinateFrame;
  wiseUrl: string;
  onChange: (change: Partial<ViewState>) => void;
  onPosition: (ra: number, dec: number) => void;
}

/** A wide-field sky map centred on the position, for context around the small frames. */
export default function AladinPanel({ ra, dec, sky, wlmin, wlmax, skyf, frame, wiseUrl, onChange, onPosition }: Props) {
  const [clicked, setClicked] = useState<Point | null>(null);
  const clickedRef = useRef<Point | null>(null);
  const [currentPixel, setCurrentPixel] = useState<ScreenPoint>(null);
  const [clickedPixel, setClickedPixel] = useState<ScreenPoint>(null);
  const [coordinates, setCoordinates] = useState("");
  const [fov, setFov] = useState(FIELD_OF_VIEW_DEG);
  const [expanded, setExpanded] = useState(false);
  const expandButton = useRef<HTMLButtonElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<{ api: AladinApi; aladin: AladinInstance } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The loaded survey and, when it is a cube, its frames. Both belong to the current `sky`.
  const survey = useRef<AladinHiPS | null>(null);
  const [cube, setCube] = useState<CubeInfo | null>(null);
  const cubeFrame = useMemo(() => cube && chooseFrame(cube, skyf, wlmin, wlmax), [cube, skyf, wlmin, wlmax]);
  const [ready, setReady] = useState(false);

  // Start the map once. The position at that moment comes from a ref,
  // so later changes do not rebuild it.
  const latest = useRef({ ra, dec, sky, frame });
  latest.current = { ra, dec, sky, frame };

  useEffect(() => {
    let cancelled = false;
    loadAladin()
      .then((api) => {
        if (cancelled || map.current || !holder.current) return;
        const now = latest.current;
        const aladin = api.aladin(holder.current, {
          // Name a survey here, or Aladin Lite first asks a CDS server for its own default.
          // The effect further down sets it again with the error and frame handling.
          survey: api.HiPS(skyMap(now.sky).url),
          fov: FIELD_OF_VIEW_DEG,
          target: `${now.ra} ${now.dec}`,
          cooFrame: now.frame,
          showZoomControl: false,
          showFov: false,
          showFrame: false,
          showCooLocation: false,
          showStatusBar: false,
          showSettingsControl: false,
          showShareControl: false,
          showSimbadPointerControl: false,
          showCooGridControl: false,
          showSelectionModeControl: false,
          showColorPickerControl: false,
          showReticle: false,
          showFullscreenControl: false,
          showLayersControl: false,
          showProjectionControl: false,
          // Aladin Lite otherwise reports each start, with this page's full address, to a
          // usage log at CDS. Our address holds the position being viewed, so keep it off.
          log: false,
        });
        map.current = { api, aladin };
        const refresh = () => {
          const current = latest.current;
          const project = (point: Point): ScreenPoint => {
            const pixel = aladin.world2pix(point.ra, point.dec, "ICRS");
            return pixel && pixel.every(Number.isFinite) ? pixel : null;
          };
          setCurrentPixel(project(current));
          const point = clickedRef.current;
          const pixel = point ? project(point) : null;
          setClickedPixel(pixel);
          if (point && pixel) {
            const [lon, lat] = aladin.pix2world(pixel[0], pixel[1], current.frame);
            setCoordinates(current.frame === "ICRS"
              ? api.coo(lon, lat, 7).format("s")
              : current.frame === "Galactic" ? `l ${lon.toFixed(5)}°, b ${lat.toFixed(5)}°`
              : `RA ${lon.toFixed(5)}°, Dec ${lat.toFixed(5)}°`);
          }
          setFov(aladin.getFov()[0]);
        };
        aladin.on("click", (point) => {
          if (point.isDragging || !Number.isFinite(point.ra) || !Number.isFinite(point.dec)) return;
          clickedRef.current = { ra: point.ra, dec: point.dec };
          setClicked(clickedRef.current);
          refresh();
        });
        aladin.on("positionChanged", refresh);
        let initialWidthApplied = false;
        aladin.on("zoomChanged", () => {
          // The initial canvas resize changes the constructor's effective field width.
          // Correct it after that zoom update, once only; later user zoom stays intact.
          if (!initialWidthApplied) {
            initialWidthApplied = true;
            aladin.setFoV(FIELD_OF_VIEW_DEG);
          }
          refresh();
        });
        aladin.on("resizeChanged", refresh);
        refresh();
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
    if (ready && map.current) {
      map.current.aladin.gotoRaDec(ra, dec);
      setCurrentPixel(map.current.aladin.world2pix(ra, dec, "ICRS") ?? null);
    }
  }, [ready, ra, dec]);

  useEffect(() => {
    if (!ready || !map.current) return;
    let cancelled = false;
    const { api, aladin } = map.current;
    setProblem(null);
    survey.current = null;
    setCube(null);
    const { url, cube: config } = skyMap(sky);
    // Started now so it runs while Aladin Lite loads the survey. Fetched once per address.
    const properties = loadProperties(url);
    properties.catch(() => undefined);
    const layer = api.HiPS(url, {
      successCallback: (loaded) => {
        if (cancelled) return;
        properties
          .then((values) => cubeFromProperties(values, config))
          // Without the properties file, use what Aladin Lite read; never break the map.
          .catch(() => cubeFromSurvey(loaded, config))
          .then((info) => {
            if (cancelled || !info) return;
            survey.current = loaded;
            setCube(info);
          });
      },
      // Without this, a survey that cannot be reached leaves an empty map and no message.
      errorCallback: () => {
        if (cancelled) return;
        setProblem(
          `The ${skyMap(sky).label} background could not be loaded from IRSA, so the map is empty. ` +
            "The frames above do not depend on it.",
        );
      },
    });
    aladin.setBaseImageLayer(layer);
    return () => {
      cancelled = true;
    };
  }, [ready, sky]);

  // Change the frame of the same layer; recreating the layer would reload every tile.
  useEffect(() => {
    if (survey.current && cubeFrame !== null) showCubeFrame(survey.current, cubeFrame);
  }, [cube, cubeFrame]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const { aladin, api } = map.current;
    aladin.setFrame(frame);
    const point = clickedRef.current;
    if (point) {
      const pixel = aladin.world2pix(point.ra, point.dec, "ICRS");
      if (pixel) {
        const [lon, lat] = aladin.pix2world(pixel[0], pixel[1], frame);
        setCoordinates(frame === "ICRS" ? api.coo(lon, lat, 7).format("s")
          : frame === "Galactic" ? `l ${lon.toFixed(5)}°, b ${lat.toFixed(5)}°`
          : `RA ${lon.toFixed(5)}°, Dec ${lat.toFixed(5)}°`);
      }
    }
  }, [frame, ready]);

  // Aladin Lite 3.9.2 observes its container and redraws when this viewport overlay changes size.
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setExpanded(false);
      requestAnimationFrame(() => expandButton.current?.focus({ preventScroll: true }));
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [expanded]);

  function dismissPoint() { clickedRef.current = null; setClicked(null); setClickedPixel(null); }
  const width = holder.current?.clientWidth ?? 0;
  const height = holder.current?.clientHeight ?? 0;
  const visible = (pixel: ScreenPoint) => pixel && pixel[0] >= 0 && pixel[1] >= 0 && pixel[0] < width && pixel[1] < height;

  return (
    <div className={`sky-map${expanded ? " expanded" : ""}`} aria-label="Interactive sky map">
      <div ref={holder} className="aladin" />
      {!ready && !problem && <p className="map-status" role="status">Loading sky map…</p>}
      {problem && <p className="notice error map-status">{problem}</p>}
      {ready && <>
        <div className="map-top-controls">
          <MapDropdown label="Sky view" value={sky} options={SKY_OPTIONS} onChange={(sky) => onChange({ sky })} />
          <MapDropdown label="Coordinates" value={frame} options={FRAME_OPTIONS} onChange={(frame) => onChange({ frame })} />
        </div>
        <span className="tooltip-anchor map-expand">
          <button type="button" ref={expandButton} aria-label={expanded ? "Exit expanded sky map" : "Expand sky map"}
            aria-describedby="expand-help" aria-pressed={expanded} onClick={() => setExpanded((value) => !value)}>⛶</button>
          <span className="tooltip" role="tooltip" id="expand-help">{EXPAND_HELP}</span>
        </span>
        {visible(currentPixel) && <span className="map-marker current" role="img" aria-label="Current position" title={`RA ${ra.toFixed(7)}°, Dec ${dec.toFixed(7)}°`}
          style={{ left: currentPixel![0], top: currentPixel![1] }} />}
        {clicked && visible(clickedPixel) && <>
          <span className="map-marker clicked" role="img" aria-label="Clicked position"
            style={{ left: clickedPixel![0], top: clickedPixel![1] }} />
          <div className="map-popup" role="region" aria-label="Clicked sky position"
            style={{ left: Math.max(8, Math.min(clickedPixel![0] + 18, width - 278)),
              top: Math.max(90, Math.min(clickedPixel![1] + 18, height - (cube ? 230 : 140))) }}>
            <button type="button" className="popup-close" aria-label="Dismiss clicked position" onClick={dismissPoint}>✕</button>
            <p className="mono">{coordinates}</p>
            <button type="button" className="primary" onClick={() => {
              onPosition(clicked.ra, clicked.dec); dismissPoint();
            }}>Show frames here</button>
          </div>
        </>}
        {cube && cubeFrame !== null && (
          <CubeSlider cube={cube} frame={cubeFrame} onCommit={(next) => onChange({ skyf: next + 1 })} />
        )}
        <div className="map-bottom-controls">
          <div className="map-zoom">
            <button type="button" aria-label="Zoom in" onClick={() => map.current?.aladin.setFoV(Math.max(fov / 1.5, 1 / 36000))}>+</button>
            <button type="button" aria-label="Zoom out" onClick={() => map.current?.aladin.setFoV(Math.min(fov * 1.5, 180))}>−</button>
          </div>
          <output className="map-fov">View: {fov < 1 ? `${(fov * 60).toFixed(1)}′` : `${fov.toFixed(2)}°`}</output>
          <span className="tooltip-anchor wise-link">
            <a href={wiseUrl} target="_blank" rel="noreferrer" aria-describedby="wise-help">Open in WiseView ↗ ⓘ</a>
            <span className="tooltip" role="tooltip" id="wise-help">{WISE_HELP}</span>
          </span>
        </div>
      </>}
    </div>
  );
}
