# UI Concerns — Monorepo vs Polyrepo Clarity

**Status:** RESOLVED  
**Date:** 2026-05-26

---

## Concern: How does a user know if their project is a monorepo?

**The concern:** When a user looks at the project setup screen, if there is only one repo entry in the list and nothing explicitly labels it, it could look like an incomplete polyrepo setup rather than a deliberate monorepo configuration. The user may not know whether they need to add more entries.

**The answer:** The distinction is encoded in the data model by entry count. One entry = monorepo. N entries = polyrepo. The system always knows which it is dealing with — no special field, no sentinel key, and no separate init path is needed.

The UI is responsible for surfacing this clearly. The recommended approach is a derived badge:

- 1 entry → display a **Monorepo** label
- N entries → display a **Polyrepo** label or simply list the repos without a label

This is a display concern only. The underlying data model does not need to change to support it.

---

## Concern: The sub-directory feels wrong for a monorepo

**The concern:** A monorepo user sees that the system creates a sub-directory (e.g. `app/`) inside the workspace, but their actual repository has no such sub-directory at its root. This feels like a mismatch.

**The answer:** The workspace sub-directory is entirely internal to the system. The user never navigates it, never references it in their code, and never needs to think about it. The folder name in the KV map is a system alias — it has no relationship to the directory structure inside the repository itself.

What the user declares is a name and a URL. What the system does with that internally is its own concern. The user's repo is cloned as-is; its internal structure is untouched.

---

## Concern: What if the user wants to represent a monorepo with internal packages as multiple entries?

**The concern:** A monorepo might have internal packages — `UI`, `Gateway`, `Backend` — that are all part of the same repository. A user might try to represent these as separate KV entries all pointing at the same repo URL.

**The answer:** This is correctly rejected by the URL uniqueness constraint. The KV map represents repositories, not packages. Internal packages within a single repository are the repository's own concern — they are not separate repos and should not be declared as separate entries.

For a monorepo with internal packages, the correct declaration is one entry: the repo URL and a single folder alias (e.g. `app`). The system clones the full repo, and the LLM has visibility into all internal packages through the cloned directory tree.

---

## Concern: What happens when migrating from monorepo to polyrepo?

**The concern:** If the workspace layout differs between monorepo and polyrepo, a migration would require restructuring the workspace, moving files, and re-cloning.

**The answer:** Because the system uses a consistent sub-directory layout for both mono and poly, migration is just adding a new KV entry. The existing folder stays exactly where it is. Nothing moves, nothing breaks, and no re-cloning is required for the repos that were already initialised.

---

## Summary

| Concern | Resolution |
|---|---|
| How does the user know it is a monorepo? | UI derives a badge from entry count — 1 entry = Monorepo label |
| Sub-directory feels wrong for a monorepo | The workspace is internal; the folder alias has no relation to the repo's own structure |
| Multiple entries for internal packages | Correctly rejected — one repo = one entry regardless of internal package count |
| Migration from mono to poly | Add an entry; nothing else changes |
