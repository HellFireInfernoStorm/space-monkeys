// The "aladin-lite" package ships no type definitions. This file declares only the
// small part of it that this site uses. Add to it when a new call is needed.
declare module "aladin-lite" {
  /** One background survey (a HiPS tile set). The cube fields are set only for cubes. */
  export interface AladinHiPS {
    /** Number of frames, for a cube. */
    cubeDepth?: number;
    /** Shortest and longest wavelength the survey declares, in metres. */
    emMin?: number;
    emMax?: number;
    /** For a cube: show the frame at this wavelength (unit "m") . */
    setFrequency(target: { value: number; unit: "m" }): void;
  }

  export interface AladinHiPSOptions {
    successCallback?: (survey: AladinHiPS) => void;
    errorCallback?: (error: unknown) => void;
  }

  export interface AladinInstance {
    gotoRaDec(ra: number, dec: number): void;
    setBaseImageLayer(survey: AladinHiPS | string): void;
  }

  export interface AladinApi {
    /** Resolves when the library is ready to draw. Rejects if the browser has no WebGL2. */
    init: Promise<unknown>;
    aladin(element: HTMLElement, options: Record<string, unknown>): AladinInstance;
    HiPS(address: string, options?: AladinHiPSOptions): AladinHiPS;
  }

  const A: AladinApi;
  export default A;
}
