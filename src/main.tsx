import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { dictionaries } from "./i18n";
import { notify } from "./lib/notify";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
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
