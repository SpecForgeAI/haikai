/**
 * Prompt injection renderer for the V3 layered prompt system.
 *
 * Single renderer for both pack-output and IR injection points in the prompt
 * composition pipeline. No per-pack rendering hooks — both inputs are
 * serialized as compact JSON blobs (fenced for pack-output, plain compact
 * object for IR) so that the LLM sees a uniform, predictable structure.
 *
 * Spec: V3 Layered Prompt System — Task Group 2 (injection renderer).
 */

/**
 * Single pack-output candidate as rendered into the prompt.
 *
 * The adapter-produced candidates get projected into this compact shape
 * before being fenced as a JSON array. `hint` is an optional 1-line summary
 * the adapter may attach to help the LLM spot gaps without restating facts.
 *
 * Abstraction-mapping fields (`tableName`, `columnName`, `entityClassName`)
 * are included when the pack can resolve them so the LLM can recognise
 * Java↔SQL equivalences and avoid duplicating a concept across layers. For
 * example, a `physical_entity: Owner` candidate may carry `tableName: "owners"`
 * so the LLM knows a `CREATE TABLE owners` in a schema migration is NOT a
 * new fact.
 */
export interface PackOutputInjectionItem {
  type: string;
  name: string;
  filePath: string;
  hint?: string;
  /** SQL table name for a Java `@Entity` (on `physical_entity` candidates). */
  tableName?: string;
  /** SQL column name for a Java field (on `physical_attribute` candidates). */
  columnName?: string;
  /** Parent `@Entity` class name for `physical_attribute` / `entity_relationship`. */
  entityClassName?: string;
}

/**
 * IR injection payload — compact per-file structural summary.
 *
 * Only classes, methods, and imports are included — NOT a full AST. Keeping
 * this lean preserves token budget for the source file itself and avoids
 * leaking adapter internals into the prompt surface area.
 */
export interface IrInjectionPayload {
  classes?: unknown[];
  methods?: unknown[];
  imports?: unknown[];
}

/**
 * Render the pack-output injection block.
 *
 * Always emits a fenced ```json``` array. Empty input renders as the literal
 * `[]` — never omitted — so downstream prompt assembly is structurally
 * stable regardless of whether the pack found candidates.
 */
export function renderPackOutputInjection(
  packOutput: PackOutputInjectionItem[] | null | undefined,
): string {
  const items: PackOutputInjectionItem[] = Array.isArray(packOutput) ? packOutput : [];
  // Strip any unexpected fields so the prompt stays deterministic and compact.
  // Abstraction-mapping hints (tableName, columnName, entityClassName) survive
  // projection when present so the LLM can recognise Java↔SQL equivalences.
  const projected = items.map((item) => {
    const out: PackOutputInjectionItem = {
      type: item.type,
      name: item.name,
      filePath: item.filePath,
    };
    if (typeof item.hint === 'string' && item.hint.length > 0) {
      out.hint = item.hint;
    }
    if (typeof item.tableName === 'string' && item.tableName.length > 0) {
      out.tableName = item.tableName;
    }
    if (typeof item.columnName === 'string' && item.columnName.length > 0) {
      out.columnName = item.columnName;
    }
    if (typeof item.entityClassName === 'string' && item.entityClassName.length > 0) {
      out.entityClassName = item.entityClassName;
    }
    return out;
  });
  const body = JSON.stringify(projected);
  return '```json\n' + body + '\n```';
}

/**
 * Render the IR injection block.
 *
 * Emits a compact JSON object with only `classes`, `methods`, and `imports`.
 * Missing / null / undefined IR renders as the literal `{}` — never omitted.
 */
export function renderIrInjection(ir: IrInjectionPayload | null | undefined): string {
  if (!ir || typeof ir !== 'object') {
    return '{}';
  }
  const projected: IrInjectionPayload = {};
  if (Array.isArray(ir.classes)) projected.classes = ir.classes;
  if (Array.isArray(ir.methods)) projected.methods = ir.methods;
  if (Array.isArray(ir.imports)) projected.imports = ir.imports;
  // If nothing usable is present, still emit `{}` so structure stays stable.
  if (Object.keys(projected).length === 0) {
    return '{}';
  }
  return JSON.stringify(projected);
}

/**
 * One existing-entity index entry rendered into the prompt.
 *
 * LEAN by construction (Model-Aware Discovery, 2026-05-30): per entity we
 * carry `id` / `type` / `name` / `parentOrTableHint` ONLY -- NO attribute
 * lists, NO descriptions, NO relationship payloads. The section is a NUDGE so
 * the LLM recognises a known concept by name; the load-bearing match runs in
 * CODE at save-back.
 */
export interface ExistingEntityInjectionItem {
  id: string;
  type: string;
  name: string;
  parentOrTableHint?: string;
}

/**
 * Render the existing-entity injection block for the "these already exist"
 * prompt section.
 *
 * Emits a compact JSON array of `{ type, name, parentOrTableHint? }` entries.
 * The persisted `id` is INTENTIONALLY dropped from the rendered payload -- the
 * LLM is instructed to reference existing entities BY NAME, never by id, so
 * surfacing ids would only invite the model to echo them back. Empty / null /
 * undefined input renders as the literal `[]` so the surrounding section keeps
 * a stable shape whether or not the model held any entities.
 *
 * Spec: 2026-05-30 Model-Aware Discovery -- Task Group 2 (lean index injection).
 */
export function renderExistingEntityInjection(
  items: ExistingEntityInjectionItem[] | null | undefined,
): string {
  const list: ExistingEntityInjectionItem[] = Array.isArray(items) ? items : [];
  const projected = list.map((it) => {
    const out: { type: string; name: string; parentOrTableHint?: string } = {
      type: it.type,
      name: it.name,
    };
    if (typeof it.parentOrTableHint === 'string' && it.parentOrTableHint.length > 0) {
      out.parentOrTableHint = it.parentOrTableHint;
    }
    return out;
  });
  return JSON.stringify(projected);
}

/**
 * Unified injection renderer.
 *
 * Single entry point that routes to the appropriate renderer based on kind.
 * Retained as the canonical external surface per Task Group 2: "single
 * renderer for both pack-output and IR".
 */
export function renderInjection(
  kind: 'packOutput',
  value: PackOutputInjectionItem[] | null | undefined,
): string;
export function renderInjection(
  kind: 'ir',
  value: IrInjectionPayload | null | undefined,
): string;
export function renderInjection(
  kind: 'packOutput' | 'ir',
  value: unknown,
): string {
  if (kind === 'packOutput') {
    return renderPackOutputInjection(value as PackOutputInjectionItem[] | null | undefined);
  }
  return renderIrInjection(value as IrInjectionPayload | null | undefined);
}
