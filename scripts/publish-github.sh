#!/usr/bin/env bash
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
# One-time publish: creates the GitHub repo, stores the signing keys as encrypted Actions secrets,
# pushes the code and the version tag. The tag starts .github/workflows/release.yml, which builds
# and signs the APK, MSI, AppImage, deb and tar.gz plus the signed update manifest.
#
#   bash scripts/publish-github.sh            # re-running is safe: every step is idempotent
#
# Secret values are piped straight from ~/.zeidex-keys/lexi-local into `gh secret set`; nothing is
# echoed, written to the repo, or passed on the command line.
set -euo pipefail

REPO="${REPO:-zeiad6/zeidex-lexi-local}"
KEYS="${LEXI_KEYS_DIR:-$HOME/.zeidex-keys/lexi-local}"
cd "$(dirname "$0")/.."

for f in android-release.p12 windows-codesign.pfx update-private.pem secrets.env; do
  [ -f "$KEYS/$f" ] || { echo "missing $KEYS/$f — run: node scripts/release-keys.mjs init" >&2; exit 1; }
done
value() { grep -E "^$1=" "$KEYS/secrets.env" | head -1 | cut -d= -f2-; }

if ! gh repo view "$REPO" >/dev/null 2>&1; then
  gh repo create "$REPO" --public \
    --description "Private, in-browser summarizer, quiz maker and document Q&A. Local WebGPU models, optional cloud providers. Web, Android, Windows, Linux. By ZeidexSoft." \
    --homepage "https://zeidexsoft.com"
fi
git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$REPO.git"

echo "Storing signing secrets in $REPO (encrypted by GitHub)…"
base64 -w0 "$KEYS/android-release.p12" | gh secret set ANDROID_KEYSTORE_B64 -R "$REPO"
printf %s "$(value ANDROID_KEYSTORE_PASSWORD)" | gh secret set ANDROID_KEYSTORE_PASSWORD -R "$REPO"
printf %s "$(value ANDROID_KEY_ALIAS)" | gh secret set ANDROID_KEY_ALIAS -R "$REPO"
base64 -w0 "$KEYS/windows-codesign.pfx" | gh secret set WIN_CSC_LINK -R "$REPO"
printf %s "$(value WIN_CSC_KEY_PASSWORD)" | gh secret set WIN_CSC_KEY_PASSWORD -R "$REPO"
printf %s "$(node scripts/release-keys.mjs info | sed -n 's/^windows signer sha1: *//p')" | gh secret set WIN_SIGNER_SHA1 -R "$REPO"
gh secret set UPDATE_SIGNING_KEY -R "$REPO" < "$KEYS/update-private.pem"

git push -u origin main
VERSION="$(node -p "require('./package.json').version")"
git rev-parse "v$VERSION" >/dev/null 2>&1 || git tag -a "v$VERSION" -m "Zeidex Lexi Local $VERSION"
git push origin "v$VERSION"

echo "Signed build started: https://github.com/$REPO/actions"
