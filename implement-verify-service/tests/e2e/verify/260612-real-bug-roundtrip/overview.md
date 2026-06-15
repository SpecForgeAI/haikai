# Honesty gate — one REAL un-mocked bug round-trip through haikai

The predict review's release condition: prove the bug path works end to end
with nothing mocked. Done.

## The run (every hop real)

1. Built a repo at workspace/bugco/mathx with a REAL bug: `median()` returned
   the lower-middle element for even-length lists. 2 of 3 pytest tests FAILED.
2. POST /api/v2/bugs/ (bearer auth) with bugDescription + bugType=reconciliation
   + callbackUrl=http://127.0.0.1:8791/cb + company/project. -> 202
   { bugId: bug-75c3d49e8a3a }.
3. The REAL worker claimed the job and launched a REAL Claude session running
   /haikai:debug then /haikai:fix against the repo (OAuth token, the actual
   prompt with the untrusted-delimited description).
4. haikai investigated, fixed `median` to average the two middle values, and
   kept the fix because the repo's tests passed (test-gated).
5. Worker computed outcome=success (VERDICT=FIXED + a real change on disk) and
   POSTed the SIGNED result to the callback receiver.

## Proof

- Repo tests AFTER: 3 passed (was 2 failed) -> the bug is genuinely fixed.
- Callback received (callback-received.jsonl): status=success,
  haikaiVerdict=FIXED, X-SX-Signature: sha256=23e6c7fe... (valid HMAC).

## Real-run finding (fixed same commit)

changedFiles showed "rc/mathx/stats.py" (missing 's') + __pycache__ noise:
porcelain.strip() ate the first line's leading space, shifting the parse by
one. Fixed _git_changed_files to parse porcelain without the outer strip and
to filter pycache/.pyc/dir entries; regression test added.

## What this validates

The whole chain Gary will use — submit -> queue -> worker -> haikai test-gated
fix -> signed success/failure callback — works for real, not just in mocks.
The earlier predict P1s (wrong command, no worker, lying heuristic, SSRF, path
traversal) are all resolved and this run exercised the resolved path.

## Teardown

API + worker + callback server stopped. Demo repo is local-temp only.
