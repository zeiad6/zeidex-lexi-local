import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { dictionaries } from "./i18n";
import { notify } from "./lib/notify";
// Fonts ship inside the bundle so every package (web, desktop, Docker, Android) works offline.
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/amiri/700.css";
import "@fontsource-variable/source-serif-4";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Android back button: close the top dialog first, otherwise let the system handle it.
window.__lexiBack = () => {
  const open = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
  open[open.length - 1]?.close();
  return open.length > 0;
};

// The Android app serves the bundle from its own assets, so an offline cache would only duplicate it.
if ("serviceWorker" in navigator && import.meta.env.PROD && !window.LexiAndroid) {
  navigator.serviceWorker
    .register("./sw.js")
    .then((reg) => {
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        sw?.addEventListener("statechange", () => {
          // A waiting worker with an existing controller means a new deploy, not the first install.
          if (sw.state !== "installed" || !navigator.serviceWorker.controller) return;
          const t = dictionaries[document.documentElement.lang === "en" ? "en" : "ar"];
          notify({ title: t.appUpdate, action: { label: t.reload, run: () => location.reload() } });
        });
      });
    })
    .catch(() => {
      // Offline shell is a bonus; the app works without it.
    });
}
