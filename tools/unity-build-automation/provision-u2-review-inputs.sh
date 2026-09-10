#!/usr/bin/env bash
set -euo pipefail

# Unity Build Automation runs this after checkout/cache restore and before Unity
# starts. The URLs must be controlled, short-lived HTTPS downloads; they must
# not be public Google Drive links.
if [[ "${IS_BUILDER:-}" != "true" && "${GQ_U2_PROVISION_LOCAL:-}" != "1" ]]; then
  echo "Refusing U2 review-input provisioning outside Unity Build Automation (set GQ_U2_PROVISION_LOCAL=1 only for a local rehearsal)." >&2
  exit 2
fi

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if ! repo_root="$(cd -- "$script_directory/../.." && pwd -P)" || [[ -z "$repo_root" ]]; then
  echo "Could not resolve the repository root from pre-build script location: $script_directory" >&2
  exit 2
fi
if [[ ! -e "$repo_root/.git" ]]; then
  echo "Resolved pre-build repository root has no Git metadata: $repo_root" >&2
  exit 2
fi
cd "$repo_root"

fbx_url="${GQ_U2_GREMLIN_FBX_URL:-}"
texture_url="${GQ_U2_GREMLIN_TEXTURE_URL:-}"
bearer="${GQ_U2_REVIEW_ASSET_BEARER_TOKEN:-}"

require_https_url() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "Missing required controlled U2 input URL: $name" >&2
    exit 2
  fi
  if [[ "$value" != https://* ]]; then
    echo "$name must be an HTTPS URL; public Drive sharing and unencrypted transport are not supported" >&2
    exit 2
  fi
}

require_https_url GQ_U2_GREMLIN_FBX_URL "$fbx_url"
require_https_url GQ_U2_GREMLIN_TEXTURE_URL "$texture_url"

if ! command -v curl >/dev/null 2>&1; then
  echo "Unity Build Automation agent is missing curl; cannot provision controlled U2 inputs" >&2
  exit 2
fi

hash_file() {
  local path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print tolower($1)}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$path" | awk '{print tolower($1)}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$path" | awk '{print tolower($NF)}'
  else
    echo "No SHA-256 utility is available on the Unity Build Automation agent" >&2
    exit 2
  fi
}

download_verified() {
  local name="$1"
  local url="$2"
  local destination="$3"
  local expected_sha="$4"
  local expected_bytes="$5"
  local parent
  local temporary
  local actual_sha
  local actual_bytes

  parent="$(dirname "$destination")"
  mkdir -p "$parent"
  if [[ -f "$destination" ]]; then
    actual_sha="$(hash_file "$destination")"
    actual_bytes="$(wc -c < "$destination" | tr -d '[:space:]')"
    if [[ "$actual_sha" == "$expected_sha" && "$actual_bytes" == "$expected_bytes" ]]; then
      echo "Reusing verified $name ($actual_bytes bytes, $actual_sha)"
      return
    fi
  fi

  temporary="$(mktemp "$destination.tmp.XXXXXX")"
  trap 'rm -f "$temporary"' RETURN
  if [[ -n "$bearer" ]]; then
    curl --fail --location --silent --show-error --retry 2 --connect-timeout 20 --max-time 300 \
      --header "Authorization: Bearer $bearer" --output "$temporary" "$url"
  else
    curl --fail --location --silent --show-error --retry 2 --connect-timeout 20 --max-time 300 \
      --output "$temporary" "$url"
  fi
  actual_sha="$(hash_file "$temporary")"
  actual_bytes="$(wc -c < "$temporary" | tr -d '[:space:]')"
  if [[ "$actual_sha" != "$expected_sha" || "$actual_bytes" != "$expected_bytes" ]]; then
    echo "Controlled U2 input verification failed for $name: expected $expected_bytes bytes/$expected_sha, got $actual_bytes bytes/$actual_sha" >&2
    exit 1
  fi
  mv -f "$temporary" "$destination"
  trap - RETURN
  echo "Provisioned verified $name ($actual_bytes bytes, $actual_sha)"
}

download_verified \
  "lava gremlin FBX" \
  "$fbx_url" \
  "$repo_root/.local/m2/gremlin-local-rig/lava-gremlin-local-v1.fbx" \
  "283cf0579fc864a1e599f7c2ccda3e0b4fdd930d566c04225c8dc88b10be77db" \
  "4404300"

download_verified \
  "lava gremlin base-color texture" \
  "$texture_url" \
  "$repo_root/.local/m2/gremlin-body/texture_0_base_color.png" \
  "9fb9eb5758673cbc3670ad95d1b2e2b9bf075a0699d68aa119ab334f3847d812" \
  "6804038"

echo "U2 review inputs are present at the expected paths and passed SHA-256/byte-size verification."
