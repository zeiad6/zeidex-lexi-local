# Contributing

Thanks for helping improve Zeidex Lexi Local. Bug reports, translations and pull requests are all welcome.

## Contribution terms (please read)

Opening a pull request means you agree to the following:

1. **You wrote it**, or you have the right to submit it. You sign off each commit (`git commit -s`), following the [Developer Certificate of Origin](https://developercertificate.org/).
2. **Inbound license grant.** You grant ZeidexSoft a perpetual, worldwide, royalty-free, irrevocable license to use, modify, sublicense and relicense your contribution, including under commercial licenses. This lets ZeidexSoft keep offering commercial licenses (see [COMMERCIAL.md](COMMERCIAL.md)) for a codebase that includes your work. You keep the copyright to your contribution.
3. Your contribution is published to everyone else under the project's [PolyForm Noncommercial 1.0.0](LICENSE) license.

## Development

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # unit tests (vitest) + server tests (node --test)
npm run build   # typecheck + production build
```

- Keep pure logic in `src/lib/`, and cover each new branch with a test.
- UI strings go in `src/i18n.ts`, in both Arabic and English.
- Every runtime-tunable value belongs in `src/lib/settings.ts`, so users can change it without a rebuild.
