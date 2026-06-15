This is spec #2 of a multi-spec initiative described in full at `agent-os/design-notes/multi-architecture-variants.md`. **Read that design note in full** before initializing. Spec #1 (shipped) is documented at `agent-os/specs/2026-05-01-multi-architecture-plumbing/`.

This spec adds the **architecture selector UI and URL routing**. It replaces spec #1's silent default-to-`Default` behaviour with explicit user-driven selection that survives refresh and supports deep-linking.

**Scope of this spec:**

1. **Frontend — react-router-dom integration**
   - Introduce real react-router-dom usage (the dependency is already in `frontend/package.json` from a previous addition but is currently unused).
   - Project routes get `:projectId` segment; architecture-scoped routes get `:projectId/architectures/:architectureId/...` segment.
   - URL is the **source of truth** for active project + active architecture.
   - React context (`ArchitectureContext` + `ProjectContext`) becomes a derived mirror of route params, not the source.
   - Browser back/forward works naturally; refresh and deep-link both work.

2. **Architecture selector UI**
   - Lives somewhere persistent in the project header / top bar.
   - Shows the active architecture's name (and tags? — open question).
   - Click → dropdown listing all non-archived architectures for the project (oldest first, matching the Default-resolution rule from spec #1).
   - Selecting a different architecture navigates to the equivalent URL with the new `architectureId` segment, which propagates through context to all consumers.

3. **Initial-load behaviour**
   - Direct URL with explicit `architectureId` → use it.
   - URL without `architectureId` (e.g. `/projects/:projectId/...` from a bookmark or old link) → resolve to the project's Default (oldest non-archived, same rule as spec #1) and **redirect** to the canonical URL with the segment present. This preserves spec #1's "no silent defaults at the API layer" — the silent-default lives only at the URL-resolution edge.

4. **Backend / gateway**
   - **No changes** in this spec. URL routing is entirely a frontend concern. Backend Bucket A endpoints already require `architectureId` per spec #1.

**Out of scope (deferred to later specs):**
- Architecture CRUD (create / rename / archive / tags) → spec #3.
- Discovery Service `architectureId` integration → spec #4.
- LLM persona/task save-target resolution → spec #5.
- Full clone → spec #6.
- Selective cross-architecture copy → spec #7.

**Key constraints:**
- Functionally additive — does not break any spec #1 behaviour.
- URL is source of truth; context is a derived mirror.
- Old URLs (without `architectureId`) gracefully redirect to canonical form, not error.
- Spec #1's "no silent defaults at the API layer" property is preserved — every API call still includes a real, resolved `architectureId`.
