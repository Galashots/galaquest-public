#!/bin/bash
# Cloud SessionStart hook. The repo has no npm/pip/etc dependencies to install
# (see README.md "Running it"), but the required unit gate needs Node 24+ for
# the built-in node:sqlite surface (net/rewardStore.mjs). Cloud containers can
# default to an older Node via nvm, so ensure the session has Node 24+ here.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Always resolves to a plain non-negative integer (0 if node is missing or
# unparseable), so callers can safely `-ge`/`-lt` compare it without a
# malformed comparison masking a real failure.
node_major() {
  local v
  v="$(node --version 2>/dev/null || true)"
  v="${v#v}"
  v="${v%%.*}"
  if [[ "$v" =~ ^[0-9]+$ ]]; then
    echo "$v"
  else
    echo 0
  fi
}

if [ "$(node_major)" -ge 24 ]; then
  exit 0
fi

NVM_DIR="${NVM_DIR:-/opt/nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh"
  nvm install 24 >/dev/null
  NODE24_BIN="$(dirname "$(nvm which 24)")"
  export PATH="$NODE24_BIN:$PATH"
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export PATH=\"$NODE24_BIN:\$PATH\"" >> "$CLAUDE_ENV_FILE"
  fi
fi

# Postcondition: never report success while leaving an older Node active,
# whether nvm.sh was missing, install failed, or PATH didn't take.
if [ "$(node_major)" -lt 24 ]; then
  echo "session-start.sh: could not establish Node 24+ (found: $(node --version 2>/dev/null || echo 'none')); this repo's required unit gate needs Node 24+ for node:sqlite" >&2
  exit 1
fi
