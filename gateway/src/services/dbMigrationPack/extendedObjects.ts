/**
 * Item-5 dispositions: source objects with NO like-for-like target shape
 * (SQL Server 16 -> PostgreSQL 18 pair programme, Spec 5.5, 2026-09-11).
 *
 * The doctrine: nothing deferred, no manual residue. Every such object is
 * EITHER emulated by the pack with a confirmable default OR gated by a
 * decision whose options are all actionable — and the objects the owner
 * ruled OUT (cross-database / linked-server references, indexed views) carry
 * a NAMED untranslatable reason so they are never silently attempted and
 * never silently dropped.
 *
 * This table is the ONE place the mapping lives: scan finding kind ->
 * decision category + options + default option + (optionally) the
 * translation-queue kind the object rides. The handler walks it; the
 * manifest renders its outcomes.
 *
 * PACK CODE — free to name engines; the generic core is not.
 */

import type { IrExtendedObject, PackDecision, PackDecisionCategory } from './types';

export interface ExtendedObjectDisposition {
  /** The pack decision bucket (AMS `chk_dmpd_category`, changeset 234). */
  category: PackDecisionCategory;
  /** Decision-key prefix: `<keyPrefix>--<schema.object>`. */
  keyPrefix: string;
  options: string[];
  /** The option the pack's own default behaviour corresponds to. */
  defaultOption: string;
  /** Translation-queue kind the object's body rides, when it has one. */
  translationKind?: string;
  /**
   * Named untranslatable reason stamped on the queue row. Present ONLY for
   * the shapes that are never attempted (owner ruling: items 1 and 6 are
   * OUT; CLR / Service Broker / FILESTREAM have no in-database equivalent).
   */
  untranslatableReason?: string;
  /** Ruleset `divergence_class` the citation is looked up by. */
  divergenceClass?: string;
  /** Renders the decision question for one object. */
  question: (objectRef: string, object: IrExtendedObject) => string;
}

const detailString = (object: IrExtendedObject, key: string): string | null => {
  const v = object.detail?.[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};

/** Scan finding kind -> its disposition. Keys are the `IrExtendedObject.kind`s. */
export const EXTENDED_OBJECT_DISPOSITIONS: Record<string, ExtendedObjectDisposition> = {
  clr_object_detected: {
    category: 'clr_object',
    keyPrefix: 'clr_object',
    options: ['rewrite_in_app', 'external_service', 'drop'],
    defaultOption: 'rewrite_in_app',
    translationKind: 'clr_object',
    untranslatableReason: 'clr_object',
    question: (ref, o) =>
      `'${ref}' is SQL CLR code` +
      (detailString(o, 'assemblyName') ? ` bound to assembly '${detailString(o, 'assemblyName')}'` : '') +
      `. Its body is managed .NET inside an assembly, not T-SQL, so there is NOTHING to ` +
      `translate — the object is queued with the named untranslatable reason 'clr_object' and ` +
      `its binding carried for review, never attempted. Choose rewrite_in_app (RECOMMENDED — ` +
      `the logic moves into the calling application, which is where .NET already runs), ` +
      `external_service (stand it up as a service the database calls out to) or drop (the ` +
      `capability is lost on the target, on record).`,
  },
  service_broker_detected: {
    category: 'service_broker',
    keyPrefix: 'service_broker',
    options: ['rewrite_in_app', 'external_service', 'drop'],
    defaultOption: 'rewrite_in_app',
    translationKind: 'service_broker_object',
    untranslatableReason: 'service_broker_object',
    question: (ref) =>
      `'${ref}' is a Service Broker object (in-database transactional messaging). PostgreSQL ` +
      `has no equivalent: LISTEN/NOTIFY is fire-and-forget and carries no queue, no ordering ` +
      `guarantee and no transactional delivery, so substituting it would silently change ` +
      `delivery semantics. The object is queued with the named untranslatable reason ` +
      `'service_broker_object', never attempted. Choose rewrite_in_app (RECOMMENDED — the ` +
      `application owns the queue, e.g. an outbox table it polls, or its existing broker), ` +
      `external_service (a real message broker) or drop (the messaging path is lost, on record).`,
  },
  filestream: {
    category: 'filestream',
    keyPrefix: 'filestream',
    options: ['rewrite_in_app', 'external_service', 'drop'],
    defaultOption: 'rewrite_in_app',
    question: (ref) =>
      `'${ref}' uses FILESTREAM: the bytes live on the server filesystem, not in the table, and ` +
      `every application path that opens the Win32 file handle depends on that. PostgreSQL has ` +
      `no FILESTREAM. Choose rewrite_in_app (RECOMMENDED — the content loads into a bytea ` +
      `column and the file-handle paths become ordinary reads/writes), external_service (an ` +
      `object store; the table keeps a key) or drop (the content is not migrated, on record).`,
  },
  synonym_detected: {
    category: 'synonym',
    keyPrefix: 'synonym',
    options: ['view', 'search_path', 'drop'],
    defaultOption: 'view',
    translationKind: 'synonym',
    question: (ref, o) =>
      `Synonym '${ref}' aliases '${detailString(o, 'baseObject') ?? 'another object'}'. ` +
      `PostgreSQL has no CREATE SYNONYM. Choose view (RECOMMENDED — the pack queues a ` +
      `CREATE VIEW with the synonym's name over the base object, so every existing reference ` +
      `keeps resolving), search_path (a SCHEMA-level alias handled by putting the base schema ` +
      `on the search_path — only valid when the synonym's name equals its base object's name) ` +
      `or drop (every reference must be rewritten to the base object). A synonym pointing at ` +
      `ANOTHER DATABASE is a cross-database reference and is untranslatable for that reason.`,
  },
  user_defined_table_type: {
    category: 'user_defined_table_type',
    keyPrefix: 'user_defined_table_type',
    options: ['composite_type', 'drop'],
    defaultOption: 'composite_type',
    translationKind: 'user_defined_table_type',
    question: (ref) =>
      `User-defined TABLE TYPE '${ref}' backs one or more table-valued (READONLY) parameters. ` +
      `Choose composite_type (RECOMMENDED — the pack queues a CREATE TYPE ... AS (...) ` +
      `composite; every routine that took the TVP takes an array of it, and the call sites move ` +
      `with the signature) or drop (the routines that used it must be re-shaped by hand first).`,
  },
  indexed_view: {
    category: 'indexed_view',
    keyPrefix: 'indexed_view',
    options: ['rewrite_in_app', 'materialized_view_manual_refresh', 'drop'],
    defaultOption: 'rewrite_in_app',
    untranslatableReason: 'indexed_view',
    question: (ref) =>
      `'${ref}' is an INDEXED VIEW — a materialized, engine-maintained result set the optimizer ` +
      `substitutes into queries automatically. This is OUT by owner ruling and is never ` +
      `translated: PostgreSQL's MATERIALIZED VIEW is NOT maintained automatically and is never ` +
      `substituted into a plan, so emitting one would silently serve stale rows. The object ` +
      `carries the named untranslatable reason 'indexed_view'. Choose rewrite_in_app ` +
      `(the querying application owns the aggregate), materialized_view_manual_refresh (a ` +
      `MATERIALIZED VIEW plus an EXPLICIT refresh schedule you own — staleness becomes visible ` +
      `and bounded) or drop.`,
  },
  cross_database_reference: {
    category: 'cross_database_reference',
    keyPrefix: 'cross_database_reference',
    options: ['rewrite_in_app', 'foreign_data_wrapper', 'drop'],
    defaultOption: 'rewrite_in_app',
    untranslatableReason: 'cross_database_reference',
    question: (ref, o) =>
      `'${ref}' reaches outside this database (three-/four-part name, linked server or ` +
      `OPENQUERY${Array.isArray(o.detail?.['references']) ? `: ${(o.detail!['references'] as unknown[]).slice(0, 5).join(', ')}` : ''}). ` +
      `This is OUT by owner ruling and is never translated: PostgreSQL has no cross-database ` +
      `query at all. The object carries the named untranslatable reason ` +
      `'cross_database_reference'. Choose rewrite_in_app (the application reads both sides and ` +
      `joins them), foreign_data_wrapper (postgres_fdw / tds_fdw — a DEPLOYMENT decision with ` +
      `its own credentials, latency and transaction semantics) or drop.`,
  },
  fulltext_catalog: {
    category: 'fulltext_index',
    keyPrefix: 'fulltext_index',
    options: ['tsvector_gin', 'drop_index'],
    defaultOption: 'tsvector_gin',
    divergenceClass: 'fulltext',
    question: (ref) =>
      `Full-text catalog '${ref}' is registered on the source database. The pack emulates ` +
      `full-text search with a generated tsvector column plus a GIN index per indexed table ` +
      `(tsvector_gin, RECOMMENDED) and rewrites CONTAINS / FREETEXT to to_tsquery / ` +
      `plainto_tsquery; ranking and stemming differ, so result ORDER is advisory. The ` +
      `alternative is drop_index — full-text search is not reproduced on the target, on record.`,
  },
};

/** One object's resolved outcome: the decision (if open) + manifest rows. */
export interface ExtendedObjectOutcomeResult {
  outcomes: ExtendedObjectOutcome[];
  decisions: PackDecision[];
}

export interface ExtendedObjectOutcome {
  kind: string;
  objectRef: string;
  decisionKey: string;
  option: string;
  resolved: boolean;
  untranslatableReason: string | null;
  translationKind: string | null;
  sourceBody: string | null;
  findingIds: string[];
  note: string;
}

/**
 * Walk the IR's extended objects, raise the decision each needs while it is
 * unresolved, and return the outcome rows the manifest + translation queue
 * consume. Deterministic: objects are processed in IR order (already sorted
 * by kind then qualified name).
 */
export function buildExtendedObjectOutcomes(args: {
  extendedObjects: readonly IrExtendedObject[];
  resolvedDecisions: Record<string, Record<string, unknown>>;
  ruleCite: (divergenceClass: string) => string | null;
}): ExtendedObjectOutcomeResult {
  const outcomes: ExtendedObjectOutcome[] = [];
  const decisions: PackDecision[] = [];
  for (const object of args.extendedObjects) {
    const disposition = EXTENDED_OBJECT_DISPOSITIONS[object.kind];
    if (!disposition) continue;
    const objectRef = object.schemaName
      ? `${object.schemaName}.${object.objectName}`
      : object.objectName;
    const decisionKey = `${disposition.keyPrefix}--${objectRef}`;
    const resolution = args.resolvedDecisions[decisionKey];
    const resolvedOption =
      resolution && typeof resolution['option'] === 'string'
        ? (resolution['option'] as string)
        : null;
    const option = resolvedOption ?? disposition.defaultOption;
    if (!resolvedOption) {
      const cite = disposition.divergenceClass
        ? args.ruleCite(disposition.divergenceClass)
        : null;
      decisions.push({
        decisionKey,
        objectRef,
        category: disposition.category,
        question:
          disposition.question(objectRef, object) + (cite ? ` See ${cite}.` : ''),
        options: [...disposition.options],
      });
    }
    const reason = object.untranslatableReason ?? disposition.untranslatableReason ?? null;
    outcomes.push({
      kind: object.kind,
      objectRef,
      decisionKey,
      option,
      resolved: resolvedOption !== null,
      untranslatableReason: reason,
      translationKind:
        option === 'drop' || option === 'drop_index' ? null : disposition.translationKind ?? null,
      sourceBody: object.sourceBody ?? null,
      findingIds: [...object.findingIds],
      note: resolvedOption
        ? `${object.kind}: '${option}' per resolved decision '${decisionKey}'.`
        : `${object.kind}: OPEN decision '${decisionKey}' (the pack's default is '${option}').`,
    });
  }
  return { outcomes, decisions };
}
