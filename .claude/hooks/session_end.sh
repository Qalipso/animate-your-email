#!/usr/bin/env bash
# SessionEnd hook — append a session boundary to the activity log (lightweight auto-memory).
set -euo pipefail

DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
LOG_DIR="${DIR}/knowledge/log"
mkdir -p "$LOG_DIR"
printf -- "- %s — session ended\n" "$(date '+%Y-%m-%d %H:%M')" >> "${LOG_DIR}/sessions.md"

exit 0
