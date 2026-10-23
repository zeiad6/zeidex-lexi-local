// Sandboxed preloads must be CommonJS. Exposes only these narrow calls to the page.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lexiDesktop", {
  checkUpdates: (manual) => ipcRenderer.invoke("lexi:check-updates", !!manual),
  appInfo: () => ipcRenderer.invoke("lexi:app-info"),
  printToPdf: (html, name) => ipcRenderer.invoke("lexi:print-pdf", String(html), String(name)),
});
