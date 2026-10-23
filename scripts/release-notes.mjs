// Prints the GitHub release notes for one version: its CHANGELOG.md section plus download and
// verification instructions. usage: node scripts/release-notes.mjs v1.1.1 > notes.md
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function changelogSection(changelog, version) {
  const v = version.replace(/^v/, "");
  const lines = changelog.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## [${v}]`));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## ["));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

export function releaseNotes(changelog, version, repo = "zeiad6/zeidex-lexi-local") {
  const v = version.replace(/^v/, "");
  const section = changelogSection(changelog, v);
  if (!section) throw new Error(`CHANGELOG.md has no section for ${v}`);
  const file = (suffix) => `Zeidex-Lexi-Local-${v}-${suffix}`;
  return `${section}

## Downloads · التنزيلات

| Platform · المنصة | File · الملف |
|---|---|
| Android 8+ | \`${file("android.apk")}\` |
| Windows 10/11 (x64) | \`${file("win-x64.msi")}\` |
| Linux (x86_64), any distro | \`${file("linux-x86_64.AppImage")}\` |
| Debian / Ubuntu | \`${file("linux-amd64.deb")}\` |
| Linux archive | \`${file("linux-x64.tar.gz")}\` |

Installed apps update themselves: they verify the signed manifest (\`lexi-local.json\`), the file hash and the signing certificate before installing.
تحدّث التطبيقات المثبّتة نفسها تلقائيًا بعد التحقق من البيان الموقَّع وبصمة الملف وشهادة التوقيع.

## Verify · التحقق

\`\`\`sh
curl -LO https://raw.githubusercontent.com/${repo}/v${v}/keys/update-public.pem
openssl dgst -sha256 -verify update-public.pem -signature SHA256SUMS.sig SHA256SUMS
sha256sum --ignore-missing -c SHA256SUMS
\`\`\`
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const version = process.argv[2];
  if (!version) throw new Error("usage: release-notes.mjs <version>");
  process.stdout.write(releaseNotes(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), version));
}
