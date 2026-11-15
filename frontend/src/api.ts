// The only file that calls the back end. Types come from api-types.ts, which is
// generated from docs/openapi.json by `npm run gen:api`; do not write them by hand.

import type { components } from "./api-types";

type Schemas = components["schemas"];
export type Health = Schemas["Health"];
export type Band = Schemas["Band"];
export type Target = Schemas["Target"];
export type Exposure = Schemas["Exposure"];
export type ExposureList = Schemas["ExposureList"];
export type Frame = Schemas["Frame"];
export type FrameList = Schemas["FrameList"];
export type StackResult = Schemas["StackResult"];
export type StackImage = Schemas["StackImage"];
export type MotionPoint = Schemas["MotionPoint"];
export type PhotometryResult = Schemas["PhotometryResult"];
export type PhotometryPoint = Schemas["PhotometryPoint"];
export type WiseImage = Schemas["WiseImage"];

const BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Params = Record<string, string | number | boolean | null | undefined>;

/** Full address for a path the API returned, such as a frame's `image_url`. */
export function apiUrl(path: string): string {
  return BASE + path;
}

/** FastAPI sends a string, or for a 422 a list of {loc, msg}; turn either into a sentence. */
export function detailText(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (!Array.isArray(detail)) return null;
  const parts = detail
    .map((item) => {
      if (typeof item !== "object" || item === null || typeof item.msg !== "string") return null;
      const loc: unknown[] = Array.isArray(item.loc) ? item.loc : [];
      const field = loc.filter((p) => p !== "query" && p !== "body" && p !== "path").join(".");
      return field ? `${field}: ${item.msg.replace(/\.$/, "")}` : item.msg.replace(/\.$/, "");
    })
    .filter((part): part is string => part !== null);
  return parts.length > 0 ? `The server rejected the request. ${parts.join("; ")}.` : null;
}

async function get<T>(path: string, params: Params = {}, signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) query.set(key, String(value));
  }
  const text = query.toString();
  const response = await fetch(apiUrl(path) + (text ? "?" + text : ""), { signal });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = detailText(body.detail) ?? detail;
    } catch {
      // The body was not JSON; keep the status text.
    }
    throw new ApiError(response.status, detail);
  }
  return (await response.json()) as T;
}

export interface PositionQuery {
  ra: number;
  dec: number;
  pmra: number;
  pmdec: number;
  epoch: number;
}

export interface FramesQuery extends PositionQuery {
  size: number;
  wl_min: number | null;
  wl_max: number | null;
  track: boolean;
}

export const getHealth = (signal?: AbortSignal) => get<Health>("/api/health", {}, signal);

export const getBands = async (signal?: AbortSignal) =>
  (await get<Schemas["BandList"]>("/api/bands", {}, signal)).bands;

export const getTargets = async (signal?: AbortSignal) =>
  (await get<Schemas["TargetList"]>("/api/targets", {}, signal)).targets;

export const getFrames = (query: FramesQuery, signal?: AbortSignal) =>
  get<FrameList>("/api/frames", { ...query }, signal);

export interface StackQuery extends PositionQuery {
  size: number;
  wl_min: number | null;
  wl_max: number | null;
  /** Milliarcseconds; 0 leaves parallax out of the predicted positions. */
  parallax: number;
}

export const getStack = (query: StackQuery, signal?: AbortSignal) =>
  get<StackResult>("/api/stack", { ...query }, signal);

export interface PhotometryQuery extends PositionQuery {
  wl_min: number | null;
  wl_max: number | null;
  /** Milliarcseconds; moves the aperture with the object. */
  parallax: number;
}

export const getPhotometry = (query: PhotometryQuery, signal?: AbortSignal) =>
  get<PhotometryResult>("/api/photometry", { ...query }, signal);

export interface WiseQuery {
  ra: number;
  dec: number;
  /** Width on the sky, arcseconds: the SPHEREx image's, so both cover the same field. */
  size: number;
  band: "W1" | "W2";
}

export const getWise = (query: WiseQuery, signal?: AbortSignal) =>
  get<WiseImage>("/api/wise", { ...query }, signal);

export const getExposures =(query: PositionQuery, signal?: AbortSignal) =>
  get<ExposureList>("/api/exposures", { ...query }, signal);
