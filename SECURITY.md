# Security policy

Report vulnerabilities privately to **info@zeidexsoft.com**, with the subject *"Lexi Local security"*. Do not open a public issue for them. Please include steps to reproduce. You will get a reply within 7 days.

## Design notes for reviewers

- In **Local** mode, documents and prompts never leave the device. Models are downloaded from Hugging Face or from the WebLLM CDN, and are then cached locally.
- API keys for cloud providers are kept in the browser's `localStorage` and sent only to the provider you chose, or to the bundled proxy on `localhost`. Exported settings files leave the keys out by default.
- The bundled server (`server/server.mjs`) has these safeguards:
  - **Static files:** it serves only `dist/` and rejects path traversal.
  - **LAN sharing:** only a client on loopback can turn LAN sharing on or off.
  - **Cloud proxy:** it forwards only to provider hosts from `src/providers.json`, or to hosts allowlisted in `LEXI_PROXY_ALLOW`. Targets on `localhost` are allowed only for clients on loopback, so the proxy is not an open relay on your network.
- The desktop app runs with `contextIsolation` and `sandbox` enabled and `nodeIntegration` disabled. Its preload exposes only `checkUpdates` and `appInfo`. It opens external links in your system browser.
- **Android:**
  - The WebView loads only the bundled app from `https://appassets.androidplatform.net`. Any other URL opens in the system browser, so `window.LexiAndroid` is never reachable from a third-party page.
  - File and content access are off, and camera, microphone and location requests are denied.
  - `allowBackup` is off, so API keys and history are never copied into cloud backups.
- **Updates:**
  - Every app verifies an ECDSA P-256 signature over the manifest bytes before trusting any field in it.
  - It then checks that the downloaded file has the signed SHA-256 and size.
  - Android also requires the APK's package name and signing certificate to match the installed app. Windows requires the MSI's Authenticode thumbprint to match the manifest.
  - Private keys are never in the repository. The `.gitignore` blocks `*.p12`, `*.pfx`, `*.jks`, `*-private.pem` and `signing.properties`.
