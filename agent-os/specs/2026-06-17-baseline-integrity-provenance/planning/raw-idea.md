Topic: Baseline integrity & provenance — make the pinned API-behaviour baseline (the oracle) tamper-EVIDENT and auditable, and stamp it with how it was produced (incl. the coverage score from the coverage-scoring spec).

Problem: Today the baseline's immutability is enforced only by the ABSENCE of a mutation path — there is no content hash/signature, so silent tampering or drift of a pinned oracle is undetectable. There is also no provenance recorded ON the baseline (which capture session produced it, against which environment, when it was pinned/activated) and no at-a-glance view of how thorough the oracle is.

Decisions ALREADY made (fixed constraints, do not relitigate):
1. CONTENT HASH: each pinned baseline gets a deterministic content hash computed over its behavioural content (the set of baseline items — status, headers, body, volatile envelope, etc.), via a canonical/stable serialization. The hash is recomputed-and-verified on read/at reconcile time to detect tampering or drift; a mismatch is surfaced as a visible integrity warning (never silent).
2. PROVENANCE stamped on the baseline at pin/activate time: capture session id, environment name, pinned/activated timestamp, and the COVERAGE SCORE produced by the oracle-coverage-scoring spec (Spec A of this series), plus relevant capture metadata (e.g. scenario/capture counts). Auditable.
3. SURFACE integrity status + provenance + coverage score in the baseline view UI so a reviewer can see at a glance how thorough + trustworthy the oracle is.
4. Preserve immutability: the baseline stays immutable once activated; integrity makes it tamper-EVIDENT (detect) ON TOP of the existing immutability-by-no-mutation-path. The hash captures exactly what is pinned; reconcile-time volatile tolerance is a SEPARATE concern (not part of the hash).

Dependencies & ordering: this is Spec C of a 3-spec series (A=oracle coverage scoring, B=reconcile full-response fidelity, C=this). It READS the coverage-summary field that Spec A adds (to embed the coverage score into provenance). Build order is A -> B -> C, so by build time A's coverage field and B's response-shape changes already exist. Next free Liquibase changeset after A=189 and B=190 is expected ~191 (builder verifies next-free at build time).

Out of scope: capture-side coverage scoring itself (Spec A); reconcile break-type fidelity (Spec B); cryptographic SIGNING / key management (a plain content hash is sufficient for tamper-EVIDENCE this iteration — note signing as a future follow-on); backfill of pre-existing baselines.
