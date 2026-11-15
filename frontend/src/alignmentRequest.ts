import { getAlignment, type AlignmentResult, type Frame } from "./api";

export interface AlignmentRequestState {
  key: string;
  result: AlignmentResult | null;
  loading: boolean;
  error: string;
}

export function alignmentFrameKey(frame: Frame): string {
  return [frame.exposure_id, frame.center_ra, frame.center_dec, frame.target_ra, frame.target_dec].join("|");
}

export function emptyAlignmentRequest(key = ""): AlignmentRequestState {
  return { key, result: null, loading: false, error: "" };
}

/** Own cancellation and state together, so returning to an aborted frame allows retry. */
export function createAlignmentRequest(
  publish: (state: AlignmentRequestState) => void,
  fetchAlignment = getAlignment,
) {
  let selectedKey = "";
  let active: AbortController | null = null;

  function cancel() {
    active?.abort();
    active = null;
  }

  function select(key: string) {
    cancel();
    selectedKey = key;
    publish(emptyAlignmentRequest(key));
  }

  async function run(frame: Frame) {
    const key = alignmentFrameKey(frame);
    if (key !== selectedKey) return;
    cancel();
    const controller = new AbortController();
    active = controller;
    publish({ ...emptyAlignmentRequest(key), loading: true });
    const isCurrent = () => active === controller && !controller.signal.aborted && selectedKey === key;
    try {
      const result = await fetchAlignment(frame, controller.signal);
      if (isCurrent()) publish({ ...emptyAlignmentRequest(key), result });
    } catch (error) {
      if (isCurrent()) publish({ ...emptyAlignmentRequest(key),
        error: error instanceof Error ? error.message : "Check failed" });
    } finally {
      if (active === controller) active = null;
    }
  }

  return { select, run, cancel };
}
