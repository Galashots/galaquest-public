#!/usr/bin/env bash
set -euo pipefail

# Install a Unity Build Automation WebGL artifact into the path server.mjs serves
# at /unity/. Refuses any archive whose bytes are not the pinned candidate, so a
# preview can never silently serve a different build than the one under review.
#
#   install-u2-webgl-artifact.sh <artifact.zip>   install from a local archive
#   install-u2-webgl-artifact.sh --fetch          download it first, then install
#
# --fetch is the hosted path. It reads the archive location from
# GQ_PREVIEW_ARTIFACT_URL and its credential from GQ_PREVIEW_ARTIFACT_TOKEN, so
# the compiled build stays out of this repository and the token never appears in
# it either. The archive is private because it embeds custody-tier candidate art.
#
# The build directory is git-ignored, so a deploy has no Unity client until this
# runs; a preview that cannot provision one must fail loudly rather than serve a
# 404 that looks like a broken game.

PINNED_BUILD="11"
PINNED_SOURCE_SHA="1ea2733d8256ea82d54f2d505c29242e3f87718b"
PINNED_ZIP_SHA256="7c78da2f277550da4070204913c1326d1dd7ba4f88fd6e070e3fc6c605f52b40"
ARCHIVE_ROOT="GalaQuest WebGL Staging"

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
destination="$repo_root/unity/GalaQuest/Builds/GalaQuestWebGL"

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print tolower($1)}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print tolower($1)}'
  else openssl dgst -sha256 "$1" | awk '{print tolower($NF)}'
  fi
}

archive="${1:-}"
if [[ "$archive" == "--fetch" ]]; then
  url="${GQ_PREVIEW_ARTIFACT_URL:-}"
  token="${GQ_PREVIEW_ARTIFACT_TOKEN:-}"
  if [[ -z "$url" ]]; then
    echo "GQ_PREVIEW_ARTIFACT_URL is required for --fetch" >&2
    exit 2
  fi
  archive="$staging/artifact.zip"
  # --fail so an auth or path error is a non-zero exit here rather than a zip
  # parse failure three steps later; the token is only ever a header value.
  if [[ -n "$token" ]]; then
    curl --fail --location --silent --show-error --retry 2 --connect-timeout 20 --max-time 600 \
      --header "Authorization: Bearer $token" --output "$archive" "$url"
  else
    curl --fail --location --silent --show-error --retry 2 --connect-timeout 20 --max-time 600 \
      --output "$archive" "$url"
  fi
elif [[ -z "$archive" || ! -f "$archive" ]]; then
  echo "usage: $0 <artifact.zip> | --fetch" >&2
  exit 2
fi

actual_zip_sha="$(hash_file "$archive")"
if [[ "$actual_zip_sha" != "$PINNED_ZIP_SHA256" ]]; then
  echo "Refusing artifact: expected build $PINNED_BUILD zip $PINNED_ZIP_SHA256, got $actual_zip_sha" >&2
  exit 1
fi

unzip -q "$archive" -d "$staging/unpacked"

manifest="$staging/unpacked/$ARCHIVE_ROOT/candidate-build-manifest.json"
[[ -f "$manifest" ]] || { echo "Artifact has no candidate-build-manifest.json" >&2; exit 1; }

manifest_sha="$(node -e 'process.stdout.write(require(process.argv[1]).sourceSha)' "$manifest")"
if [[ "$manifest_sha" != "$PINNED_SOURCE_SHA" ]]; then
  echo "Refusing artifact: manifest sourceSha $manifest_sha is not the pinned $PINNED_SOURCE_SHA" >&2
  exit 1
fi

# Every shipped WebGL file must match the hash the build recorded for it, so a
# repacked or partially copied archive fails here rather than in a browser.
node -e '
const fs=require("fs"), crypto=require("crypto"), path=require("path");
const root=process.argv[1];
const manifest=JSON.parse(fs.readFileSync(path.join(root,"candidate-build-manifest.json"),"utf8"));
let bad=0;
for (const file of manifest.files) {
  const target=path.join(root,"Build",file.name);
  if (!fs.existsSync(target)) { console.error("missing: "+file.name); bad++; continue; }
  const bytes=fs.statSync(target).size;
  const sha=crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
  if (bytes!==file.bytes || sha!==file.sha256) { console.error("hash/size mismatch: "+file.name); bad++; }
}
if (bad) { console.error(bad+" file(s) failed verification"); process.exit(1); }
console.log("verified "+manifest.files.length+" WebGL output files against the manifest");
' "$staging/unpacked/$ARCHIVE_ROOT"

rm -rf "$destination"
mkdir -p "$(dirname "$destination")"
cp -r "$staging/unpacked/$ARCHIVE_ROOT" "$destination"

echo "Installed Unity build $PINNED_BUILD ($PINNED_SOURCE_SHA) into $destination"
echo "server.mjs serves it at /unity/ ; /ws remains the authoritative game socket."
