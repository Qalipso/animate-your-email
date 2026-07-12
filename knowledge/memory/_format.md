---
name: _format
description: How to write a memory file in this project (delete or keep as reference)
metadata:
  type: reference
---
# Memory file format

Copy this shape for each durable fact. **One fact per file.** After creating a file,
add a one-line pointer to `../MEMORY.md` under "Facts".

```markdown
---
name: <short-kebab-slug>
description: <one-line summary — used to decide relevance on recall>
metadata:
  type: user | feedback | project | reference
---

<The fact. For feedback/project, follow with **Why:** and **How to apply:** lines.>
<Link related notes with [[their-name]] — e.g. [[Iron Laws]] from the shared brain.>
```

Types: `user` (who the user is) · `feedback` (how to work, with the why) ·
`project` (goals/constraints not in the code) · `reference` (pointers to URLs/dashboards).

This file is just the template — safe to delete.
