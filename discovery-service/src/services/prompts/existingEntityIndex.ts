/**
 * Lean existing-entity index builder for model-aware discovery.
 *
 * Spec: 2026-05-30 Model-Aware Discovery -- Task Group 2 (model-as-input).
 *
 * A model-aware discovery run loads the existing (project, architecture) model
 * and injects a LEAN compact index of the already-persisted entities into the
 * LLM prompt as a "these already exist -- don't restate; propose enrich/link
 * candidates that reference them BY NAME" nudge. The LLM is ONLY nudged: it
 * never does the load-bearing matching (that is deterministic in CODE at
 * save-back, Task Group 4).
 *
 * LEAN means: per entity we emit `{ id, type, name, parentOrTableHint }` ONLY.
 * We explicitly DROP attribute lists, descriptions, and relationship payloads
 * -- the index exists to let the LLM recognise a known concept by name, not to
 * re-feed the whole model back through the token budget.
 *
 * Conforms to the Architecture Meta-Model Reference
 * (`gateway/src/config/prompts/shared/architecture-context-explainer.md`):
 * the polymorphic `*_points` wrappers (`application_points`,
 * `data_entity_points`, `business_points`, `app_business_points`) are backend
 * AUTO-MANAGED and are NEVER included in the index -- the LLM must never see or
 * reference them.
 *
 * Scope (relevant-slice FIRST, because logical<->physical reconcile is
 * cross-cutting): the scanned service's subtree PLUS ALL data entities
 * (logical + physical). Whole-model is used when the serialised index is under
 * a size cap; if it exceeds the cap the caller narrows to the slice and emits a
 * Finding noting the model was too large to inject whole.
 */

/**
 * A single existing-entity index entry. LEAN by construction: id + type + name
 * + a single parent-or-table hint. NOTHING else (no attributes, no description,
 * no relationship payload).
 */
export interface ExistingEntityIndexItem {
  /** The persisted entity id (carried for traceability only -- the LLM must reference BY NAME, never by id). */
  id: string;
  /** The meta-model entity-array key this entity came from (e.g. `services`, `logical_data_entities`). */
  type: string;
  /** The entity's display name -- the ONLY handle the LLM is told to reference. */
  name: string;
  /**
   * A single compact parent / table hint, present when resolvable:
   *   - services / interfaces / endpoints / classes / attributes -> the parent FK value
   *   - physical_data_entities -> the table name (or physical type) when distinct from name
   * Omitted when nothing useful is available. Kept to ONE string so the index stays lean.
   */
  parentOrTableHint?: string;
}

/**
 * Result of building the lean index. `tooLarge` is true when the WHOLE-model
 * index exceeded the size cap and the returned `items` were narrowed to the
 * relevant slice -- the caller emits a Finding in that case (no silent
 * truncation).
 */
export interface LeanExistingEntityIndexResult {
  items: ExistingEntityIndexItem[];
  /** True when the whole-model index exceeded the cap and was narrowed to the slice. */
  tooLarge: boolean;
  /** Count of entities the whole model held (pre-narrowing) -- surfaced on the Finding. */
  wholeModelCount: number;
}

/**
 * Default serialised-size cap (chars of the JSON index) above which the whole
 * model is considered too large to inject in full. ~48KB of lean index is a
 * generous nudge budget; beyond it we narrow to the slice + emit a Finding.
 * Exposed as a parameter so tests can force the narrowing path with a small
 * model.
 */
export const DEFAULT_EXISTING_ENTITY_INDEX_CHAR_CAP = 48_000;

/**
 * The meta-model entity-array keys that hold DATA entities (logical +
 * physical). ALL of these are always in scope -- logical<->physical reconcile
 * (`link`) is cross-cutting, so a code scan must see every data entity to
 * propose a link even when the matching table lives outside the scanned
 * subtree.
 */
const DATA_ENTITY_KEYS: readonly string[] = [
  'logical_data_entities',
  'physical_data_entities',
];

/**
 * The application-architecture entity-array keys that make up a service's
 * subtree. We include the scanned service plus the interfaces / endpoints /
 * classes that hang off it (resolved by parent FK). These are the entities a
 * code scan of that service would plausibly re-discover.
 */
const SUBTREE_KEYS: readonly string[] = [
  'services',
  'interfaces',
  'endpoints',
  'classes',
  'methods',
  'business_logics',
];

/**
 * Per-key parent FK field used to resolve the `parentOrTableHint`. Mirrors the
 * save-back `CANDIDATE_TYPE_REGISTRY` parent-FK mapping so the hint is
 * meaningful to the same matcher that runs at save-back.
 */
const PARENT_FK_BY_KEY: Record<string, string | undefined> = {
  services: 'application_id',
  app_components: 'application_id',
  interfaces: 'service_id',
  endpoints: 'interface_id',
  classes: 'service_id',
  methods: 'class_id',
  business_logics: 'service_id',
  logical_data_attributes: 'logical_entity_id',
  physical_data_attributes: 'physical_entity_id',
};

/**
 * Safely read the entities map from a loaded model. The model shape is
 * `{ metaModel: { entities: { <key>: [...] }, relationships: {...} }, ... }`.
 * Returns an empty object for any missing / malformed shape so an absent or
 * first-run model produces an empty index rather than throwing.
 */
function readEntitiesMap(model: unknown): Record<string, unknown[]> {
  if (!model || typeof model !== 'object') return {};
  const metaModel = (model as Record<string, unknown>).metaModel;
  if (!metaModel || typeof metaModel !== 'object') return {};
  const entities = (metaModel as Record<string, unknown>).entities;
  if (!entities || typeof entities !== 'object') return {};
  const out: Record<string, unknown[]> = {};
  for (const [key, value] of Object.entries(entities as Record<string, unknown>)) {
    if (Array.isArray(value)) out[key] = value;
  }
  return out;
}

/**
 * Project a single persisted entity row into a lean index item. Resolves the
 * single parent-or-table hint when available. Returns null for rows lacking a
 * usable name (we never emit an unnamed entry -- the LLM references BY NAME).
 */
function projectEntity(
  key: string,
  row: unknown,
): ExistingEntityIndexItem | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (name.length === 0) return null;
  const id = typeof r.id === 'string' ? r.id : String(r.id ?? '');

  const item: ExistingEntityIndexItem = { id, type: key, name };

  // Parent FK hint (services/interfaces/endpoints/classes/attributes).
  const fkField = PARENT_FK_BY_KEY[key];
  if (fkField && typeof r[fkField] === 'string' && (r[fkField] as string).length > 0) {
    item.parentOrTableHint = r[fkField] as string;
  }

  // Physical-data-entity table hint: prefer an explicit table name when it
  // differs from the entity name; otherwise fall back to the physical type.
  if (key === 'physical_data_entities' && item.parentOrTableHint === undefined) {
    const tableName =
      typeof r.table_name === 'string' && r.table_name.length > 0
        ? (r.table_name as string)
        : typeof r.tableName === 'string' && r.tableName.length > 0
          ? (r.tableName as string)
          : '';
    if (tableName && tableName !== name) {
      item.parentOrTableHint = tableName;
    } else if (typeof r.physical_type === 'string' && (r.physical_type as string).length > 0) {
      item.parentOrTableHint = r.physical_type as string;
    }
  }

  return item;
}

/**
 * Build the lean index for a given set of entity-array keys.
 */
function buildForKeys(
  entitiesMap: Record<string, unknown[]>,
  keys: readonly string[],
): ExistingEntityIndexItem[] {
  const items: ExistingEntityIndexItem[] = [];
  for (const key of keys) {
    const rows = entitiesMap[key];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const projected = projectEntity(key, row);
      if (projected) items.push(projected);
    }
  }
  return items;
}

/**
 * Count entities across ALL entity-array keys (whole model), excluding the
 * auto-managed `*_points` wrappers.
 */
function countWholeModel(entitiesMap: Record<string, unknown[]>): number {
  let n = 0;
  for (const [key, rows] of Object.entries(entitiesMap)) {
    if (key.endsWith('_points')) continue;
    if (Array.isArray(rows)) n += rows.length;
  }
  return n;
}

/**
 * Build the LEAN existing-entity index from a loaded model.
 *
 * Strategy:
 *   1. Build the relevant slice = scanned-service subtree + ALL data entities.
 *      (When `scopedServiceId` is absent -- project-level run -- the subtree
 *       collapses to ALL application-architecture entities, since there is no
 *       single service to narrow to.)
 *   2. Build the whole-model index (every non-`*_points` entity-array key).
 *   3. If the whole-model JSON is under the cap, return the whole-model index
 *      (`tooLarge: false`).
 *   4. Otherwise return the slice (`tooLarge: true`) so the caller emits a
 *      Finding noting the model was too large to inject whole.
 *
 * NEVER includes any `*_points` wrapper. Tolerates an empty / absent / malformed
 * model by returning an empty index.
 *
 * @param model         The loaded ArchitectureModelDto (or null on first run)
 * @param scopedServiceId  Optional id of the service being scanned, used to
 *                         narrow the subtree slice to that service's children
 * @param charCap       Serialised-size cap; defaults to {@link DEFAULT_EXISTING_ENTITY_INDEX_CHAR_CAP}
 */
export function buildLeanExistingEntityIndex(
  model: unknown,
  scopedServiceId?: string | null,
  charCap: number = DEFAULT_EXISTING_ENTITY_INDEX_CHAR_CAP,
): LeanExistingEntityIndexResult {
  const entitiesMap = readEntitiesMap(model);
  const wholeModelCount = countWholeModel(entitiesMap);

  if (wholeModelCount === 0) {
    return { items: [], tooLarge: false, wholeModelCount: 0 };
  }

  // --- Build the relevant slice (subtree + ALL data entities) ---
  const dataItems = buildForKeys(entitiesMap, DATA_ENTITY_KEYS);
  let subtreeItems = buildForKeys(entitiesMap, SUBTREE_KEYS);
  if (scopedServiceId && scopedServiceId.length > 0) {
    // Narrow the subtree to the scanned service + its first-level children.
    // We resolve children by parent FK against the scoped service id and the
    // ids of interfaces directly under it (for endpoints). Anything we cannot
    // confidently attribute to the scoped service is dropped from the slice --
    // ALL data entities remain in scope regardless (cross-cutting reconcile).
    const scopedInterfaceIds = new Set<string>();
    for (const iface of entitiesMap.interfaces ?? []) {
      const r = iface as Record<string, unknown>;
      if (r.service_id === scopedServiceId && typeof r.id === 'string') {
        scopedInterfaceIds.add(r.id);
      }
    }
    subtreeItems = subtreeItems.filter((it) => {
      if (it.type === 'services') return it.id === scopedServiceId;
      if (it.type === 'interfaces' || it.type === 'classes' || it.type === 'business_logics') {
        return it.parentOrTableHint === scopedServiceId;
      }
      if (it.type === 'endpoints') {
        return it.parentOrTableHint !== undefined && scopedInterfaceIds.has(it.parentOrTableHint);
      }
      // methods + anything else: keep (cheap, and rarely large).
      return true;
    });
  }
  const sliceItems = [...subtreeItems, ...dataItems];

  // --- Build the whole-model index (every non-`*_points` key) ---
  const wholeKeys = Object.keys(entitiesMap).filter((k) => !k.endsWith('_points'));
  const wholeItems = buildForKeys(entitiesMap, wholeKeys);

  const wholeSerializedSize = JSON.stringify(wholeItems).length;
  if (wholeSerializedSize <= charCap) {
    return { items: wholeItems, tooLarge: false, wholeModelCount };
  }

  // Whole-model index too large: narrow to the slice and signal the caller.
  return { items: sliceItems, tooLarge: true, wholeModelCount };
}
