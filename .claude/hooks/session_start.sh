#!/usr/bin/env bash
# SessionStart hook — inject the shared brain pointer + this project's memory into context.
# stdout from a SessionStart hook is added to the session context.
set -euo pipefail

DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
BRAIN="$HOME/Documents/ClaudeBrain"

echo "## 🧠 Shared brain: ClaudeBrain"
echo "- Operating guide & Iron Laws: ${BRAIN}/CLAUDE.md (imported in this project's CLAUDE.md)."
echo "- Skills / agents / commands: provided by the installed 'claude-brain' plugin."
echo "- This project's knowledge graph: ${BRAIN}/vault/Projects/animate-your-email (mirrors ./knowledge)."
echo

if [ -f "${DIR}/knowledge/MEMORY.md" ]; then
  echo "## 📌 Project memory — knowledge/MEMORY.md"
  cat "${DIR}/knowledge/MEMORY.md"
  echo
fi

if [ -s "${DIR}/knowledge/log/sessions.md" ]; then
  echo "## 🕘 Recent activity (last 15 lines of knowledge/log/sessions.md)"
  tail -n 15 "${DIR}/knowledge/log/sessions.md"
fi

exit 0
