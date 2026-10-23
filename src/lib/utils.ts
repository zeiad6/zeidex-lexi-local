import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** m:ss, or h:mm:ss for long jobs; digits only, so it reads the same in Arabic and English. */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

/**
 * Wraps a setter so a burst of calls (a model streaming tokens) renders at most once per frame with
 * the latest value; re-parsing a long answer on every token stalls phones.
 */
export function perFrame<T>(set: (v: T) => void): ((v: T) => void) & { cancel: () => void } {
  let pending: { v: T } | null = null;
  let frame = 0;
  const flush = () => {
    const last = pending;
    pending = null;
    if (last) set(last.v);
  };
  const push = (v: T) => {
    if (!pending) frame = requestAnimationFrame(flush);
    pending = { v };
  };
  // Call before setting the final value, so a late frame cannot overwrite it with a partial one.
  push.cancel = () => {
    cancelAnimationFrame(frame);
    pending = null;
  };
  return push;
}
