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
      if (typeof body.detail === "string") detail = body.detail;
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
}

export const getStack = (query: StackQuery, signal?: AbortSignal) =>
  get<StackResult>("/api/stack", { ...query }, signal);

export const getExposures =(query: PositionQuery, signal?: AbortSignal) =>
  get<ExposureList>("/api/exposures", { ...query }, signal);
