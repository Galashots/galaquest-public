#!/bin/bash
# Cloud SessionStart hook. The repo has no npm/pip/etc dependencies to install
# (see README.md "Running it"), but the required unit gate needs Node 24+ for
# the built-in node:sqlite surface (net/rewardStore.mjs). Cloud containers can
# default to an older Node via nvm, so pin the session to Node 24 here.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if [ "$(node --version 2>/dev/null | cut -d. -f1 | tr -d v)" -ge 24 ] 2>/dev/null; then
  exit 0
fi

NVM_DIR="${NVM_DIR:-/opt/nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh"
  nvm install 24 >/dev/null
  NODE24_BIN="$(dirname "$(nvm which 24)")"
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export PATH=\"$NODE24_BIN:\$PATH\"" >> "$CLAUDE_ENV_FILE"
  fi
fi
