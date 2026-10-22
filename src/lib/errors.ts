import type { Dict } from "@/i18n";
import { CloudError } from "./cloud";

/** Turns engine routing codes and cloud failures into the user's language; other messages pass through. */
export function errorText(e: unknown, t: Dict): string {
  const m = e instanceof Error ? e.message : String(e);
  if (m === "local-not-ready") return t.localNotReady;
  if (m === "cloud-not-ready") return t.cloudNotReady;
  if (e instanceof CloudError && e.code === "auth") return t.cloudAuth;
  if (e instanceof CloudError && e.code === "cors") return t.cloudCors;
  return m;
}
