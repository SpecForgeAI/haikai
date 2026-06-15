"""One shared build-results outcome vocabulary across BOTH callbacks (C3/L4).

Before this, the bug callback emitted {deployed|failed|rejected} and the
orchestration callback emitted {implemented|deployed|failed} — so a single Haikai
dispatcher keyed on `outcome` couldn't route them, and `failed` collapsed three
materially different states (couldn't-fix vs fix-kept-but-unserved vs build error)
into one token. This module is the single source of truth.

Dispatcher contract (what Haikai does with each):
  IMPLEMENTED   specs built + PR raised, NOT deployed        -> submit next spec
  DEPLOYED      built/fixed AND served at target_base_url    -> run reconciliation
                (ALWAYS carries target_base_url + box_id)
  FIX_UNSERVED  bug fix kept (tests green) but redeploy failed-> human review (fix exists!)
  NOT_FIXED     investigated, no fix kept                    -> human review / re-file
  REJECTED      target is actually correct (not a real bug)  -> close, no action
  ERROR         precondition/build/git/deploy failure        -> alert infra / retry

The load-bearing distinction the old `failed` destroyed: FIX_UNSERVED (code WAS
changed on disk, needs a human) must never look like NOT_FIXED (nothing changed,
safe to retry) or ERROR (never got to investigate).
"""

from __future__ import annotations

IMPLEMENTED = "implemented"
DEPLOYED = "deployed"
FIX_UNSERVED = "fix_unserved"
NOT_FIXED = "not_fixed"
REJECTED = "rejected"
ERROR = "error"

ALL = frozenset({IMPLEMENTED, DEPLOYED, FIX_UNSERVED, NOT_FIXED, REJECTED, ERROR})

# Outcomes that mean "a target is serving at target_base_url — go reconcile".
SERVED = frozenset({DEPLOYED})
