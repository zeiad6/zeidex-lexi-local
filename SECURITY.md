# Security policy

Report vulnerabilities privately to **info@zeidexsoft.com**, with the subject *"Lexi Local security"*. Do not open a public issue for them. Please include steps to reproduce. You will get a reply within 7 days.

## Design notes for reviewers

- In **Local** mode, documents and prompts never leave the device. Models are downloaded from Hugging Face or from the WebLLM CDN, and are then cached locally.
- API keys for cloud providers are kept in the browser's `localStorage` and sent only to the provider you chose, or to the bundled proxy on `localhost`. Exported settings files leave the keys out by default.
- The bundled server (`server/server.mjs`) has these safeguards:
  - **Static files:** it serves only `dist/` and rejects path traversal.
  - **LAN sharing:** only a client on loopback can turn LAN sharing on or off.
  - **Cloud proxy:** it forwards only to provider hosts from `src/providers.json`, or to hosts allowlisted in `LEXI_PROXY_ALLOW`. Targets on `localhost` are allowed only for clients on loopback, so the proxy is not an open relay on your network.
- The desktop app runs with `contextIsolation` and `sandbox` enabled and `nodeIntegration` disabled. It opens external links in your system browser.
