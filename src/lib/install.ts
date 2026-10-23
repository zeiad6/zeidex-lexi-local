// Model install bookkeeping that needs no Worker, so it can be unit-tested.

export type LoadErrorKind = "network" | "quota" | "gpu-memory" | "gpu-limits" | "other";

export interface InstallInfo {
  phase: "fetch" | "cache";
  loadedBytes: number;
  totalBytes?: number;
  /** Smoothed download speed, bytes per second. */
  speed?: number;
  /** Milliseconds left at the current speed. */
  eta?: number;
}

export function classifyLoadError(message: string): LoadErrorKind {
  if (/quota|no space|storage (is )?full|insufficient storage/i.test(message)) return "quota";
  if (/out of memory|\bOOM\b|device (is |was )?lost|lost the device|allocat|createBuffer|model not loaded/i.test(message)) return "gpu-memory";
  if (/failed to fetch|network ?error|load failed|cannot fetch|fetch failed|request failed|timed? ?out|err_(internet|network|connection|name|timed)|offline|stalled|\b429\b|too many requests/i.test(message))
    return "network";
  if (/maxStorageBufferBindingSize|maxBufferSize|maxComputeWorkgroup|requested limits?|exceeds? (the )?limit|shader-f16|required feature/i.test(message))
    return "gpu-limits";
  return "other";
}

/** Seconds to wait before each automatic retry of a dropped download; past the last one the user resumes by hand. */
export const RETRY_DELAYS_S = [3, 10, 30, 60, 120];
