# Raw Idea: Confirmed manifest -> target codebase artifact

## IMPORTANT: Full locked requirements pointer

The FULL LOCKED requirements for this spec live in:

`agent-os/planning/2026-06-24-vuln-target-state-6-spec-decisions.md`

Specifically the **"Spec 5"** section plus the shared **"Existing-code anchors"**, **"Cross-cutting decisions"**, and **"Build-safety guidance"** sections.

The shaping phase MUST use those sections verbatim and MUST NOT re-ask the user. All decisions are already made. Record this pointer prominently before doing any requirements work.

---

## Raw idea

On target-conversation confirmation, the user's confirmed dependency manifest becomes the real build file in the generated target codebase. Write the dependency DECLARATIONS VERBATIM (honor the curated versions chosen for vuln-reduction; the implementation may add scaffolding around them but must not change declared deps/versions). Mechanism: inject the manifest into an early spec's requirements as a "write this exact file" instruction — NO implement-verify-service (IVS) change for v1 (IVS has no seed-file input and reads manifests as analysis only). Lock the seeded build file as authoritative; instruct the implementation to build around it, never regenerate/replace it. Per-module placement by service mapping (multiple manifests possible). Committed at implementation start, riding the normal IVS build/PR flow.
