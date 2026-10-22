import type { Dict } from "@/i18n";

/** Turns engine routing codes into the user's language; other messages pass through. */
export function errorText(e: unknown, t: Dict): string {
  const m = e instanceof Error ? e.message : String(e);
  return m === "local-not-ready" ? t.localNotReady : m === "cloud-not-ready" ? t.cloudNotReady : m;
}
