# animate-your-email

@~/Documents/ClaudeBrain/CLAUDE.md

> The line above imports the **shared brain** (ClaudeBrain): the Iron Laws, the Core
> Loop, the Mindset, Orchestration, and Craft. Those principles govern this project.
> Skills, agents, and commands come from the installed `claude-brain` plugin.

## About this project
- **Goal:** Turn typed text into a short animated GIF for pasting into emails (Gmail/Outlook)
- **Created:** 2026-07-11
- **Location:** `~/Documents/AI Portal/animate-your-email`
- **Knowledge graph (Obsidian):** `ClaudeBrain/vault/Projects/animate-your-email` (mirrors `knowledge/`)

## Brain (shared, read-only for this project)
This project does **not** redefine methodology — it uses ClaudeBrain. When in doubt,
the imported Iron Laws win. Use the `claude-brain` plugin's skills/agents/commands
(`/plan`, `/code-review`, TDD, systematic-debugging, the reviewer agents, …).

## Memory (auto-loaded + write-on-purpose)
Memory is this project's own — it lives here and is mirrored into the shared vault.
- **Auto-load:** the `SessionStart` hook injects `knowledge/MEMORY.md` and recent activity
  into context at the start of every session. You don't need to read them manually.
- **Persisting a durable fact:** create `knowledge/memory/<short-slug>.md` with frontmatter
  (see the existing files / the format in ClaudeBrain), then add a one-line pointer to
  `knowledge/MEMORY.md`. One fact per file.
- **Decisions:** record notable/architectural decisions in `knowledge/decisions/`.
- **Activity log:** `knowledge/log/sessions.md` is appended automatically on session end.

Save to memory what is **non-obvious and durable** (goals, constraints, conventions,
user preferences, why-decisions) — not what the code or git history already records.

## Layout
```
animate-your-email/
├── CLAUDE.md            this file
├── .claude/            settings + hooks (brain & memory autoload)
├── knowledge/          memory + decisions + log  ← shows up in Obsidian as Projects/animate-your-email
├── src/                project source
└── docs/specs/         design specs (write here before implementing — see brainstorming)
```
