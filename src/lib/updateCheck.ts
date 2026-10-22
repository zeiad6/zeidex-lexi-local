import type { Dict } from "@/i18n";
import { checkAppUpdate } from "./appUpdate";
import { android, desktop } from "./native";
import { notify } from "./notify";
import { getSettings } from "./settings";

const LAST_KEY = "lexi-app-update-at";
const EVERY_MS = 24 * 3600 * 1000;

/**
 * Android and desktop download, verify (signature, hash, signing certificate) and install natively;
 * the plain web build can only point to the download page.
 */
export async function runAppUpdateCheck(t: Dict, manual: boolean) {
  const s = getSettings();
  if (!manual) {
    if (!s.checkAppUpdates || !navigator.onLine) return;
    const last = Number(localStorage.getItem(LAST_KEY) ?? 0);
    if (Date.now() - last < EVERY_MS) return;
  }
  localStorage.setItem(LAST_KEY, String(Date.now()));
  if (android) return android.checkUpdates(manual);
  if (desktop) return void desktop.checkUpdates(manual);
  try {
    const update = await checkAppUpdate(s.updateUrl);
    if (update) {
      const lang = document.documentElement.lang === "en" ? "en" : "ar";
      notify({
        title: t.appUpdateAvailable(update.version),
        body: update.notes[lang] || undefined,
        tone: "info",
        action: { label: t.downloadUpdate, run: () => window.open(update.page, "_blank", "noopener") },
      });
    } else if (manual) notify({ title: t.upToDate, tone: "success" });
  } catch (e) {
    if (manual) notify({ title: t.updateCheckFailed, body: String(e instanceof Error ? e.message : e), tone: "warning" });
  }
}
