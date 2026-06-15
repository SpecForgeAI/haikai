# Live rounds 2 + 3 — failure/self-repair and polyrepo gate, on real CI

Same rig as round 1 (local API :8745 + cloudflared tunnel + HMAC-signed
webhooks), new credentials, SPLIT dbs (VERIFICATION_DB_PATH != JOBS_DB_PATH —
exercising the round-1 reinvoke fix in live conditions).

## Round 2 — the full self-repair loop against LIVE GitHub Actions

1. Pushed a genuinely broken commit (`def add(a, b)` — missing colon) to
   OzzieBelazi/sx-verification-live-demo, binding recorded BEFORE push (D10.4).
2. Real Actions run FAILED. Webhooks delivered over the internet:
   verdicts `pending → pending → fail` (attempts 1–3).
3. `advance` on the live fail → **refused: red-gate advance (D5)**.
4. `open_repair` attempt 1; the repair-engine agent (following
   repair-engine.md) read the REAL CI failure log (pulled from the actual
   Actions run, delimited as untrusted per D10.7), made the minimal fix in
   the real clone, committed.
5. Fix SHA bound, pushed → real Actions run **SUCCESS** → webhooks:
   `pending → pending → pass` (attempts 4–6, last-writer D10.6).
6. `advance` → **opened**. Full loop: live fail → agent repair → live green.

## Round 3 — polyrepo gate (D1 premise) across two real repos

1. Second real repo OzzieBelazi/sx-live-demo-b; one orchestration
   `orch-poly/g1` with TWO cells: (sx-verification-live-demo, ci-trigger) +
   (sx-live-demo-b, ci-trigger); both bindings recorded before pushes.
2. Pushed B only → live CI green → webhook pass. Gate over BOTH cells →
   **refused: ('sx-verification-live-demo', 'ci-trigger'): no verdict** —
   one green repo is not enough.
3. Pushed A → live CI green → webhook pass. Gate → **advanced**.

## Operational notes

- The reinvoke-db fix held under split dbs (jobs land in JOBS_DB_PATH).
- Session friction: ~256 zombie ssh-agent processes (one per bash init via
  the shell profile) degraded process spawning mid-run; purged. Not a
  product issue — a dev-shell profile issue worth fixing in .bashrc.
- Teardown: both webhooks deleted, tunnel + API stopped, creds destroyed.
  Demo repos remain (READMEs mark them safe to delete):
  sx-verification-live-demo, sx-live-demo-b.
