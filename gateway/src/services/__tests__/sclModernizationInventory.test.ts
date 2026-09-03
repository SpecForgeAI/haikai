/**
 * SCL modernization inventory (spec 5, 2026-08-18) — pure-function pins:
 *
 *  1. hand-built corpus fixtures produce the expected families / counts /
 *     matchedRuleCodes / provenance (joda shape field, Vector opaque typeRef,
 *     JAX-RS annotated table, 2 pojo shapes, 1 boundary, near-dup + dispatch
 *     findings in scan stats);
 *  2. blast-radius ordering (usageCount descending);
 *  3. empty corpus -> [] (the corpus drives the question set);
 *  4. cite caps + unmapped third-party types.
 */

import { SclContractWire } from '../sclAnnotationPass';
import { computeModernizationInventory, ObservedIdiom } from '../sclModernizationInventory';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function shape(
  key: string,
  body: Record<string, unknown>,
  overrides: Partial<SclContractWire> = {}
): SclContractWire {
  return {
    contract_key: key,
    kind: 'shape',
    source_path: `src/${key}.java`,
    source_symbol: key.replace(/^S-/, ''),
    fan_in: 1,
    roots_json: { roots: [] },
    body_json: body,
    gloss_json: null,
    ...overrides,
  };
}

function table(
  key: string,
  body: Record<string, unknown>,
  overrides: Partial<SclContractWire> = {}
): SclContractWire {
  return {
    contract_key: key,
    kind: 'behaviour_table',
    source_path: 'src/LegacyResource.java',
    source_symbol: `LegacyResource#${key}`,
    fan_in: 1,
    roots_json: { roots: [] },
    body_json: body,
    gloss_json: null,
    ...overrides,
  };
}

const JODA_SHAPE = shape('S-booking', {
  representation: 'pojo',
  fields: [
    { name: 'startDate', kind: 'date', sourceCarrier: 'org.joda.time.LocalDate' },
    { name: 'endDate', kind: 'date', sourceCarrier: 'org.joda.time.LocalDate' },
    { name: 'legacyBag', kind: 'opaque:java.util.Vector' },
  ],
  flags: ['sealed_variant_candidate'],
});

const POJO_SHAPE_2 = shape('S-customer', {
  representation: 'pojo',
  fields: [{ name: 'id', kind: 'string' }],
});

const JAXRS_TABLE = table('T-getView', {
  annotations: ['@GET', '@Path("/views/{viewId}")', '@Produces("application/json")'],
  signatureInputs: ['opaque:java.util.Vector', 'string'],
  rows: [{ condition: 'always', outcome: 'value: view' }],
});

const BOUNDARY = {
  contract_key: 'Q-bookingDao',
  kind: 'boundary',
  source_path: 'src/BookingDao.java',
  source_symbol: 'BookingDao',
  fan_in: 4,
  roots_json: { roots: [] },
  body_json: { sql: 'SELECT * FROM booking' },
  gloss_json: null,
} as SclContractWire;

const STATS_WITH_FINDINGS: Record<string, unknown> = {
  findings: [
    { kind: 'near_duplicate_cluster', detail: '2 variants', symbol: 'Utils#formatA' },
    { kind: 'near_duplicate_cluster', detail: '3 variants', symbol: 'Utils#formatB' },
    { kind: 'dispatch_ambiguity', detail: '2 impls', contract_key: 'T-dispatch' },
    { kind: 'annotation_failed', detail: 'unrelated finding kind — ignored' },
    { kind: 'data_derived_authorisation', detail: '1 authorisation predicate(s)', symbol: 'com.app.ViewResource#getView(String)' },
  ],
  parseErrors: [],
};

const ALL_CONTRACTS = [JODA_SHAPE, POJO_SHAPE_2, JAXRS_TABLE, BOUNDARY];

function byKey(rows: ObservedIdiom[], matcherKey: string): ObservedIdiom {
  const row = rows.find((r) => r.matcherKey === matcherKey);
  if (!row) {
    throw new Error(`expected idiom ${matcherKey}; got ${rows.map((r) => r.matcherKey).join(', ')}`);
  }
  return row;
}

// ---------------------------------------------------------------------------
// 1. Families / counts / rule matches / provenance
// ---------------------------------------------------------------------------

describe('computeModernizationInventory — observed idioms', () => {
  const rows = computeModernizationInventory(ALL_CONTRACTS, STATS_WITH_FINDINGS);

  it('maps a joda shape field to the dates ruleset default (sourceCarrier channel)', () => {
    const joda = byKey(rows, 'sourceCarrier:org.joda.time.LocalDate');
    expect(joda.family).toBe('dates');
    expect(joda.usageCount).toBe(2); // two fields carry it
    expect(joda.matchedRuleCode).toBe('modernize.dates.joda-localdate');
    expect(joda.from).toBe('org.joda.time.LocalDate');
    expect(joda.defaultTo).toBe('java.time.LocalDate');
    expect(joda.provenance).toBe('ruleset_default');
    expect(joda.exampleCites).toEqual([{ symbol: 'booking', sourcePath: 'src/S-booking.java' }]);
  });

  it('counts Vector across shape opaque kinds AND table signatureInputs (typeReference channel)', () => {
    const vector = byKey(rows, 'typeReference:java.util.Vector');
    expect(vector.family).toBe('collections');
    expect(vector.usageCount).toBe(2); // shape field kind + table signature input
    expect(vector.matchedRuleCode).toBe('modernize.collections.vector');
    expect(vector.defaultTo).toBe('java.util.ArrayList');
    expect(vector.provenance).toBe('ruleset_default');
    expect(vector.exampleCites).toHaveLength(2); // two distinct cite sites
  });

  it('matches the JAX-RS annotated table to the one http annotation rule', () => {
    const jaxrs = byKey(rows, 'annotationPrefix:modernize.http.jaxrs-annotations');
    expect(jaxrs.family).toBe('http');
    expect(jaxrs.usageCount).toBe(3); // @GET + @Path + @Produces
    expect(jaxrs.matchedRuleCode).toBe('modernize.http.jaxrs-annotations');
    expect(jaxrs.defaultTo).toBe('Spring MVC annotations');
    expect(jaxrs.notes).toContain('@PathParam -> @PathVariable');
    expect(jaxrs.provenance).toBe('ruleset_default');
  });

  it('counts pojo shapes as one dto representation idiom', () => {
    const pojo = byKey(rows, 'representation:pojo');
    expect(pojo.family).toBe('dto');
    expect(pojo.usageCount).toBe(2); // two pojo shapes
    expect(pojo.matchedRuleCode).toBe('modernize.dto.pojo-record');
    expect(pojo.defaultTo).toBe('Java record');
    expect(pojo.provenance).toBe('ruleset_default');
  });

  it('rolls boundaries into one dataaccess idiom', () => {
    const dao = byKey(rows, 'boundaryClass');
    expect(dao.family).toBe('dataaccess');
    expect(dao.usageCount).toBe(1);
    expect(dao.matchedRuleCode).toBe('modernize.dataaccess.dao-jparepository');
    expect(dao.defaultTo).toBe('Spring Data JpaRepository interfaces');
    expect(dao.exampleCites).toEqual([{ symbol: 'BookingDao', sourcePath: 'src/BookingDao.java' }]);
  });

  it('maps the sealed_variant_candidate flag to the dto sealed-hierarchy rule', () => {
    const sealed = byKey(rows, 'flag:sealed_variant_candidate');
    expect(sealed.family).toBe('dto');
    expect(sealed.matchedRuleCode).toBe('modernize.dto.sealed-hierarchy');
    expect(sealed.defaultTo).toBe('sealed interface + records');
  });

  it('turns near-dup + dispatch findings into unmapped consolidation rows (other kinds ignored)', () => {
    const nearDup = byKey(rows, 'consolidation:near_duplicate_cluster');
    expect(nearDup.family).toBe('consolidation');
    expect(nearDup.usageCount).toBe(2);
    expect(nearDup.matchedRuleCode).toBeNull();
    expect(nearDup.defaultTo).toBeNull();
    expect(nearDup.provenance).toBe('unmapped');
    expect(nearDup.exampleCites.map((c) => c.symbol)).toEqual(['Utils#formatA', 'Utils#formatB']);

    const dispatch = byKey(rows, 'consolidation:dispatch_ambiguity');
    expect(dispatch.usageCount).toBe(1);
    expect(dispatch.provenance).toBe('unmapped');
    // BEHAV-05 (2026-09-03): data-derived authorisation surfaces as a decision row.
    const auth = byKey(rows, 'consolidation:data_derived_authorisation');
    expect(auth.usageCount).toBe(1);
    expect(auth.from).toBe('data-derived authorisation predicate');
    expect(auth.exampleCites.map((c) => c.symbol)).toEqual(['com.app.ViewResource#getView(String)']);
    expect(dispatch.exampleCites[0].symbol).toBe('T-dispatch');

    // The unrelated annotation_failed finding produced NO consolidation row.
    expect(rows.filter((r) => r.family === 'consolidation')).toHaveLength(3); // + data_derived_authorisation (BEHAV-05)
  });
});

// ---------------------------------------------------------------------------
// 2. Unmapped third-party types
// ---------------------------------------------------------------------------

describe('computeModernizationInventory — unmapped types', () => {
  it('surfaces an unknown sourceCarrier as unmapped with no default', () => {
    const rows = computeModernizationInventory(
      [
        shape('S-money', {
          fields: [{ name: 'amount', kind: 'decimal', sourceCarrier: 'com.thirdparty.Money' }],
        }),
      ],
      {}
    );
    const money = byKey(rows, 'sourceCarrier:com.thirdparty.Money');
    expect(money.provenance).toBe('unmapped');
    expect(money.matchedRuleCode).toBeNull();
    expect(money.defaultTo).toBeNull();
    expect(money.from).toBe('com.thirdparty.Money');
  });
});

// ---------------------------------------------------------------------------
// 3. Blast-radius ordering + empty corpus
// ---------------------------------------------------------------------------

describe('computeModernizationInventory — ordering + emptiness', () => {
  it('sorts by usageCount descending (blast radius first)', () => {
    const rows = computeModernizationInventory(ALL_CONTRACTS, STATS_WITH_FINDINGS);
    const counts = rows.map((r) => r.usageCount);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    expect(counts[0]).toBeGreaterThanOrEqual(counts[counts.length - 1]);
  });

  it('returns [] for an empty corpus — only observed idioms materialize', () => {
    expect(computeModernizationInventory([], {})).toEqual([]);
  });

  it('caps exampleCites at 3 while counting every use', () => {
    const shapes = Array.from({ length: 5 }, (_, i) =>
      shape(`S-d${i}`, {
        fields: [{ name: 'when', kind: 'date', sourceCarrier: 'org.joda.time.DateTime' }],
      })
    );
    const rows = computeModernizationInventory(shapes, {});
    const joda = byKey(rows, 'sourceCarrier:org.joda.time.DateTime');
    expect(joda.usageCount).toBe(5);
    expect(joda.exampleCites).toHaveLength(3);
  });
});
