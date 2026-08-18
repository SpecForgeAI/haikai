/**
 * Baseline wire-format miner + section builders (2026-08-17).
 *
 * Pins the three live failure classes from the 0/470-match reconcile:
 *   - legacy date wire format (`31-Dec-9999` = dd-MMM-yyyy) mined from
 *     captured paths/bodies -> converter requirement + ISO-annotation ban;
 *   - >int64 identifier widths mined from captured path/query values ->
 *     BigInteger policy (never Long);
 *   - mixed request Accepts vs single captured response type -> mirror-legacy
 *     content-negotiation posture; custom headers carried as contract.
 * Plus: the wire-fidelity section appends idempotently, and the scaffold spec
 * carries the mined app-wide requirements block.
 */

jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  mineBaselineWireFacts,
  buildWireFidelitySpecSection,
  appendWireFidelitySection,
  buildScaffoldWireFormatRequirements,
} from '../migrationBaselineWireFacts';
import { ApiBehaviourBaselineItemWire } from '../migrationDriverAmsReads';
import { buildScaffoldBootstrapSpecText } from '../migrationScaffoldSpecCarriage';

function item(overrides: Partial<ApiBehaviourBaselineItemWire>): ApiBehaviourBaselineItemWire {
  return {
    id: 'i1',
    method: 'GET',
    path: '/x',
    scenario_name: 'default',
    request_json: { query: null, headers: { Accept: 'application/json' }, body: null },
    response_status: 200,
    response_json: { headers: { 'Content-Type': 'application/json' }, body: null },
    ...overrides,
  };
}

const WIDE_ID = '9'.repeat(34);

const ITEMS: ApiBehaviourBaselineItemWire[] = [
  item({
    method: 'GET',
    path: '/positions/31-Dec-9999',
    response_json: {
      headers: { 'Content-Type': 'application/json' },
      body: { asOf: '01-Jan-2024', nested: [{ maturity: '31-Dec-9999' }] },
    },
  }),
  item({
    method: 'POST',
    path: `/nodes/${WIDE_ID}`,
    request_json: {
      query: { from: '15-Mar-2023' },
      headers: { Accept: 'application/xml', system: 'sys-a', userName: 'u1' },
      body: null,
    },
  }),
  item({ method: 'GET', path: '/plain/123456789' }),
];

describe('mineBaselineWireFacts', () => {
  const facts = mineBaselineWireFacts(ITEMS);

  it('mines the legacy date pattern from paths, query values and response bodies', () => {
    expect(facts.dateFacts).toHaveLength(1);
    const f = facts.dateFacts[0];
    expect(f.pattern).toBe('dd-MMM-yyyy');
    expect(f.javaPattern).toBe('dd-MMM-uuuu');
    expect(f.examples).toContain('31-Dec-9999');
    expect(f.inRequests).toBe(true);
    expect(f.inResponses).toBe(true);
    expect(f.operations.join(' ')).toContain('GET /positions/31-Dec-9999');
    expect(f.operationCount).toBeGreaterThanOrEqual(2);
  });

  it('mines >int64 identifiers from addressing material, ignoring int64-safe values', () => {
    expect(facts.wideNumeric).not.toBeNull();
    expect(facts.wideNumeric?.maxDigits).toBe(34);
    expect(facts.wideNumeric?.examples).toContain(WIDE_ID);
    // 9-digit id never registers.
    expect(facts.wideNumeric?.operations.join(' ')).not.toContain('/plain/');
  });

  it('mines the mixed-Accept / single-response negotiation posture + custom headers', () => {
    expect(facts.media?.mixedAcceptSingleResponse).toBe(true);
    expect(facts.media?.requestAccepts).toEqual(
      expect.arrayContaining(['application/json', 'application/xml']),
    );
    expect(facts.media?.responseContentTypes).toEqual(['application/json']);
    expect(facts.customHeaderNames).toEqual(expect.arrayContaining(['system', 'userName']));
  });

  it('returns no facts for an idiomatic baseline (nothing fabricated)', () => {
    const clean = mineBaselineWireFacts([
      item({ path: '/things/123', response_json: { headers: null, body: { when: '2026-01-01' } } }),
    ]);
    expect(clean.dateFacts).toHaveLength(0);
    expect(clean.wideNumeric).toBeNull();
    expect(buildWireFidelitySpecSection(clean)).toBeNull();
  });
});

describe('buildWireFidelitySpecSection', () => {
  const facts = mineBaselineWireFacts(ITEMS);
  const section = buildWireFidelitySpecSection(facts) ?? '';

  it('states the rules with mined evidence and the ISO-annotation ban', () => {
    expect(section).toContain('Wire-format fidelity (mined from the captured API baseline)');
    expect(section).toContain('`dd-MMM-yyyy`');
    expect(section).toContain('`31-Dec-9999`');
    expect(section).toContain('@DateTimeFormat(iso = ...)');
    expect(section).toContain('RESPONSE bodies');
    expect(section).toContain('BigInteger');
    expect(section).toContain('NEVER `Long`');
    expect(section).toContain('regardless of Accept');
    expect(section).toContain('`system`');
  });

  it('carries the wire-replay acceptance criterion', () => {
    expect(section).toContain('@WebMvcTest');
    expect(section).toContain('CONCRETE captured path values');
    expect(section).toContain('no binding');
  });

  it('appends idempotently and no-ops on null', () => {
    const once = appendWireFidelitySection('SPEC BODY', section);
    expect(once).toContain('SPEC BODY');
    expect(once).toContain('Wire-format fidelity');
    expect(appendWireFidelitySection(once, section)).toBe(once);
    expect(appendWireFidelitySection('SPEC BODY', null)).toBe('SPEC BODY');
  });
});

describe('buildScaffoldWireFormatRequirements + scaffold carriage integration', () => {
  const facts = mineBaselineWireFacts(ITEMS);

  it('renders the three app-wide requirements, each citing mined evidence', () => {
    const reqs = buildScaffoldWireFormatRequirements(facts);
    expect(reqs).toHaveLength(3);
    const all = reqs.join('\n');
    expect(all).toContain('Converter<String, LocalDate>');
    expect(all).toContain('`dd-MMM-uuuu`');
    expect(all).toContain('Locale.ENGLISH');
    expect(all).toContain('RENDER dates as `dd-MMM-yyyy`');
    expect(all).toContain('BigInteger');
    expect(all).toContain('34 digits');
    expect(all).toContain('ContentNegotiationConfigurer');
    expect(all.match(/\[mined:/g)?.length).toBe(3);
  });

  it('the scaffold bootstrap spec carries the mined wire-format block', () => {
    const { text } = buildScaffoldBootstrapSpecText({
      story: { title: 'Scaffold', description: 'seed' },
      enrichmentText: '## SEED BUILD FILES — AUTHORITATIVE, WRITE FIRST\n\nWrite `pom.xml`.',
      decisions: [],
      wireFacts: facts,
    });
    expect(text).toContain('## Wire-format bootstrap requirements (mined from the captured API baseline)');
    expect(text).toContain('WIRE ORACLE');
    expect(text).toContain('Converter<String, LocalDate>');
    expect(text).toContain('BigInteger');
  });

  it('omits the block entirely without facts', () => {
    const { text } = buildScaffoldBootstrapSpecText({
      story: { title: 'Scaffold', description: 'seed' },
      enrichmentText: '## SEED BUILD FILES — AUTHORITATIVE, WRITE FIRST\n\nWrite `pom.xml`.',
      decisions: [],
      wireFacts: null,
    });
    expect(text).not.toContain('Wire-format bootstrap requirements');
  });
});
