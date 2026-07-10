/**
 * net_new `target_only` -> work-item matching (gateway-only; D6, Spec 6 of 6).
 *
 * The reconcile-time match the post-diff auto-disposition pass
 * ({@link triggerFullBaselineReconcile}) runs over each `target_only` break. The
 * api-migration-validation-service diff stays a PURE, provenance-agnostic
 * current-state diff -- ALL provenance knowledge lives HERE (and in the driver),
 * never in the diff runner.
 *
 * The match is deterministic + auditable (D1): a normalised `<METHOD> <path>`
 * key (the `InventoryReconciliationCalculator.operationKey` convention -- method
 * trimmed + upper-cased, path trimmed) is compared against the EXPLICIT,
 * human-owned `net_new_operations` lists captured on the add-item form and stored
 * on the `book_of_work_json` blob's `net_new` items. It deliberately does NOT use
 * `coveredEndpointIds` (model UUIDs -- unreliable/empty for non-endpoint stories)
 * nor spec parsing.
 *
 * Outcomes (D2 -- safe, never silently swallowed):
 *   - `auto_recognised` -- exactly ONE net_new item owns the key -> the break is
 *     auto-dispositioned to `expected_net_new` (RECORDING the additive endpoint;
 *     the oracle is never narrowed);
 *   - `ambiguous` -- the key is owned by MULTIPLE net_new items, OR a net_new
 *     item declares an operation on the SAME path but a different method (a
 *     near-miss) -> the break stays `open` + the attempt is recorded so the human
 *     sees why it was not auto-recognised;
 *   - `no_match` -- no net_new item references the path at all -> the break stays
 *     `open` exactly as today (no detail_json change).
 *
 * Spec: Non-Reconciling Work at Reconcile Time (2026-06-14, Spec 6 of 6 / D6) --
 * Task Group 3.
 */

/**
 * The minimal book-of-work item shape the match reads off the blob. Mirrors the
 * proven blob-read pattern (`migrationShapeSpecGenerationHandler` `isManualAdd`):
 * `provenance` + `kind` + the explicit `netNewOperations` list, plus the owning
 * work-item identity for the audit note. Only `provenance=net_new` + `kind=api`
 * items contribute keys.
 */
export interface ReconcileBookOfWorkItem {
  /** Blob-item id within `book_of_work_json`. */
  id: string;
  title: string;
  /** Saved WorkItem UUID (null when not yet saved to backlog). */
  workItemId: string | null;
  /** Provenance marker (`carry_over` | `net_new`); only `net_new` contributes. */
  provenance: string | null;
  /** Prompt flavour (`api` | `operational`); only `api` contributes. */
  kind: string | null;
  /** The explicit `<METHOD> <path>` list (the authoritative match source). */
  netNewOperations: string[] | null;
  /**
   * Item tags (Spec G stream/provenance markers). OPTIONAL + additive —
   * surfaced for the post-reconcile parity-verdict emission (Spec I §2–3,
   * Tier-1 batch) so code-carriage stories are identifiable off the same
   * projection. Absent on older projections; the net_new match ignores it.
   */
  tags?: string[] | null;
  /** The story's committed endpoint element ids (Spec G markers). Optional. */
  apiEndpointIds?: string[] | null;
}

/** One net_new item that owns a given operation key (for the audit note). */
export interface NetNewKeyOwner {
  bookItemId: string;
  workItemId: string | null;
  title: string;
  /** The owning item's RAW operation string (pre-normalisation) for the note. */
  operationRaw: string;
}

/** A lookup of normalised `<METHOD> <path>` key -> owning net_new item(s). */
export interface NetNewOperationLookup {
  /** key -> owners (length>1 means ambiguous). */
  byKey: Map<string, NetNewKeyOwner[]>;
  /** Normalised path (lower) -> owners, for same-path/different-method near-miss. */
  byPath: Map<string, NetNewKeyOwner[]>;
}

/**
 * The `<METHOD> <path>` key convention shared with AMS
 * `InventoryReconciliationCalculator.operationKey` (method trimmed + upper-cased,
 * path trimmed, single space separator). Returns null when neither part is set.
 */
export function operationKey(
  method: string | null | undefined,
  path: string | null | undefined,
): string | null {
  const m = (method ?? '').trim().toUpperCase();
  const p = (path ?? '').trim();
  if (m.length === 0 && p.length === 0) return null;
  return `${m} ${p}`;
}

/** Split a raw `<METHOD> <path>` entry into its method + path halves. */
function splitOperationEntry(entry: string): { method: string; path: string } | null {
  const trimmed = entry.trim();
  if (trimmed.length === 0) return null;
  // First whitespace run separates method from path; the path may itself contain
  // no spaces (URL paths don't), so a single split is sufficient.
  const match = trimmed.match(/^(\S+)\s+(.+)$/);
  if (!match) {
    // A lone token (e.g. just a path) -- treat the whole thing as the path with
    // an empty method so it can still path-match for a near-miss note.
    return { method: '', path: trimmed };
  }
  return { method: match[1], path: match[2] };
}

/** The normalised path half of a raw operation entry (lower-cased, trimmed). */
function normalisedPath(rawPath: string): string {
  return rawPath.trim().toLowerCase();
}

/**
 * Build the reconcile-time lookup from the run's book of work. ONLY
 * `provenance=net_new` + `kind=api` items contribute (the reconcile match is for
 * additive API endpoints); operational / carry_over items are ignored. Each
 * item's `netNewOperations` entries are normalised with {@link operationKey} so
 * they line up with `diffItemToBreak`'s `detail_json.operation`.
 */
export function buildNetNewOperationLookup(
  items: ReconcileBookOfWorkItem[],
): NetNewOperationLookup {
  const byKey = new Map<string, NetNewKeyOwner[]>();
  const byPath = new Map<string, NetNewKeyOwner[]>();

  for (const item of items) {
    const isNetNew = (item.provenance ?? '').trim().toLowerCase() === 'net_new';
    const isApi = (item.kind ?? '').trim().toLowerCase() === 'api';
    if (!isNetNew || !isApi) continue;
    const ops = Array.isArray(item.netNewOperations) ? item.netNewOperations : [];
    for (const rawOp of ops) {
      if (typeof rawOp !== 'string') continue;
      const split = splitOperationEntry(rawOp);
      if (!split) continue;
      const owner: NetNewKeyOwner = {
        bookItemId: item.id,
        workItemId: item.workItemId ?? null,
        title: item.title,
        operationRaw: rawOp.trim(),
      };
      const key = operationKey(split.method, split.path);
      if (key) {
        const list = byKey.get(key) ?? [];
        list.push(owner);
        byKey.set(key, list);
      }
      const pathKey = normalisedPath(split.path);
      if (pathKey.length > 0) {
        const list = byPath.get(pathKey) ?? [];
        list.push(owner);
        byPath.set(pathKey, list);
      }
    }
  }

  return { byKey, byPath };
}

/** The result of matching one `target_only` break key against the lookup. */
export type NetNewMatchResult =
  | { outcome: 'auto_recognised'; owner: NetNewKeyOwner; key: string }
  | { outcome: 'ambiguous'; reason: 'multiple_owners' | 'method_mismatch'; owners: NetNewKeyOwner[]; key: string }
  | { outcome: 'no_match'; key: string };

/**
 * Classify a `target_only` diff's `<METHOD> <path>` key against the net_new
 * lookup. Returns:
 *   - `auto_recognised` when exactly one net_new item owns the exact key;
 *   - `ambiguous` (`multiple_owners`) when more than one owns the exact key;
 *   - `ambiguous` (`method_mismatch`) when no exact-key owner exists but a
 *     net_new item declares an operation on the SAME path (a near-miss the human
 *     should see -- e.g. they wrote `POST /accounts` but the target exposes
 *     `GET /accounts`);
 *   - `no_match` when nothing references the path.
 */
export function matchTargetOnlyOperation(
  method: string | null | undefined,
  path: string | null | undefined,
  lookup: NetNewOperationLookup,
): NetNewMatchResult {
  const key = operationKey(method, path) ?? '';
  const exact = lookup.byKey.get(key) ?? [];
  if (exact.length === 1) {
    return { outcome: 'auto_recognised', owner: exact[0], key };
  }
  if (exact.length > 1) {
    return { outcome: 'ambiguous', reason: 'multiple_owners', owners: exact, key };
  }
  // No exact-key owner: a same-path/different-method declaration is a near-miss.
  const pathKey = normalisedPath(path ?? '');
  const samePath = pathKey.length > 0 ? lookup.byPath.get(pathKey) ?? [] : [];
  if (samePath.length > 0) {
    return { outcome: 'ambiguous', reason: 'method_mismatch', owners: samePath, key };
  }
  return { outcome: 'no_match', key };
}
