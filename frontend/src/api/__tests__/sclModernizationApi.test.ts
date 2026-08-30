/**
 * sclModernizationApi tests — 2026-08-18 SCL pipeline
 * ("Intermediate modernization decisions").
 *
 * Strategy mirrors `migrationDiscoveryContextApi.test.ts`: vi.fn() shims
 * globalThis.fetch; the wire contract (URLs, snake_case bodies, parse shapes)
 * is what matters. `deriveDecisionCode` is pure and tested directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  confirmModernizationDecisions,
  deriveDecisionCode,
  extractSavedTargetValue,
  fetchModernizationReview,
  retryModernizationProposals,
  SclModernizationApiError,
  slugForDecisionCode,
  type SclModernizationConfirmPayload,
  type SclModernizationReview,
} from '../sclModernizationApi';

const PROJECT_ID = 'proj-aaa';
const ARCH_ID = 'arch-bbb';

function reviewFixture(
  overrides: Partial<SclModernizationReview> = {},
): SclModernizationReview {
  return {
    scan_id: 'scan-1',
    target_architecture_id: 'target-ccc',
    rows: [
      {
        family: 'dates',
        matcher_key: 'org.joda.time.LocalDate',
        usage_count: 61,
        example_cites: [{ symbol: 'OrderService#ship', source_path: 'src/OrderService.java' }],
        matched_rule_code: null,
        from: 'org.joda.time.LocalDate',
        default_to: 'java.time.LocalDate',
        provenance: 'ruleset_default',
        notes: null,
      },
    ],
    existing_decisions: [],
    ...overrides,
  };
}

describe('deriveDecisionCode', () => {
  it('uses the matched rule code verbatim when present', () => {
    expect(
      deriveDecisionCode('dates', 'org.joda.time.LocalDate', 'modernize.dates.joda-localdate'),
    ).toBe('modernize.dates.joda-localdate');
  });

  it('ignores a blank matched rule code and derives instead', () => {
    expect(deriveDecisionCode('dates', 'org.joda.time.LocalDate', '   ')).toBe(
      'modernize.dates.org-joda-time-localdate',
    );
  });

  it("derives modernize.<family>.<slug-of-from> when no rule matched: 'org.joda.time.LocalDate' -> 'modernize.dates.org-joda-time-localdate'", () => {
    expect(deriveDecisionCode('dates', 'org.joda.time.LocalDate', null)).toBe(
      'modernize.dates.org-joda-time-localdate',
    );
  });

  it('slug: lowercase, non-alphanumeric runs collapse to single dashes, edges trimmed', () => {
    expect(slugForDecisionCode('java.util.Vector<String>')).toBe('java-util-vector-string');
    expect(slugForDecisionCode('  @Weird!! Name  ')).toBe('weird-name');
    expect(deriveDecisionCode('collections', 'java.util.Vector', undefined)).toBe(
      'modernize.collections.java-util-vector',
    );
  });

  it("slug: each '[]' maps to '-array' so array/raw pairs stay DISTINCT (Kiro third bug — 98 posted, 96 landed)", () => {
    // The old trim swallowed a trailing '[]': String and String[] collided
    // on modernize.types.string and the store silently kept one of the pair.
    expect(slugForDecisionCode('String')).toBe('string');
    expect(slugForDecisionCode('String[]')).toBe('string-array');
    expect(slugForDecisionCode('String[][]')).toBe('string-array-array');
    expect(slugForDecisionCode('String [ ]')).toBe('string-array');
    expect(slugForDecisionCode('List<String[]>')).toBe('list-string-array');
    expect(slugForDecisionCode('List<String>')).toBe('list-string');
    expect(deriveDecisionCode('types', 'AttributeDescriptor[]', null)).toBe(
      'modernize.types.attributedescriptor-array',
    );
    expect(deriveDecisionCode('types', 'AttributeDescriptor', null)).toBe(
      'modernize.types.attributedescriptor',
    );
  });
});

describe('extractSavedTargetValue', () => {
  it("unwraps the confirm write's JSON envelope to the plain '.to'", () => {
    const envelope = JSON.stringify({
      from: 'org.joda.time.LocalDate',
      to: 'java.time.LocalDate',
      family: 'dates',
      provenance: 'ruleset_default',
      usage_count: 61,
      example_cites: [],
    });
    expect(extractSavedTargetValue(envelope)).toBe('java.time.LocalDate');
  });

  it('returns a plain (non-JSON / non-envelope) value verbatim', () => {
    expect(extractSavedTargetValue('java.time.LocalDate')).toBe('java.time.LocalDate');
    expect(extractSavedTargetValue('{"no_to_key":true}')).toBe('{"no_to_key":true}');
  });
});

describe('sclModernizationApi wire calls', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('GETs the review URL and returns the snake_case shape verbatim', async () => {
    const fixture = reviewFixture();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => fixture,
    });

    const result = await fetchModernizationReview(PROJECT_ID, ARCH_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `/api/v1/projects/${PROJECT_ID}/architectures/${ARCH_ID}/scl/modernization/review`,
    );
    expect(options.method).toBe('GET');
    expect(result).toEqual(fixture);
    expect(result.rows[0].usage_count).toBe(61);
    expect(result.rows[0].example_cites[0].source_path).toBe('src/OrderService.java');
  });

  it('rejects the review GET with a status-carrying error on 404 (no scan)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ error: 'no structural scan for this architecture' }),
    });

    const err = await fetchModernizationReview(PROJECT_ID, ARCH_ID).catch((e) => e);
    expect(err).toBeInstanceOf(SclModernizationApiError);
    expect((err as SclModernizationApiError).status).toBe(404);
    expect((err as Error).message).toBe('no structural scan for this architecture');
  });

  it('POSTs the confirm payload verbatim (snake_case) and parses confirmed/failed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        confirmed: 1,
        failed: [{ code: 'modernize.dates.bad-row', error: 'unknown family' }],
      }),
    });

    const payload: SclModernizationConfirmPayload = {
      target_architecture_id: 'target-ccc',
      rows: [
        {
          code: 'modernize.dates.org-joda-time-localdate',
          family: 'dates',
          from: 'org.joda.time.LocalDate',
          to: 'java.time.LocalDate',
          provenance: 'ruleset_default',
          usage_count: 61,
          example_cites: [{ symbol: 'OrderService#ship', source_path: 'src/OrderService.java' }],
        },
      ],
    };

    const result = await confirmModernizationDecisions(PROJECT_ID, ARCH_ID, payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `/api/v1/projects/${PROJECT_ID}/architectures/${ARCH_ID}/scl/modernization/confirm`,
    );
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual(payload);

    expect(result.confirmed).toBe(1);
    expect(result.failed).toEqual([
      { code: 'modernize.dates.bad-row', error: 'unknown family' },
    ]);
  });

  it('POSTs the proposals-retry URL and returns the full review shape', async () => {
    const fixture = reviewFixture({
      proposal_pass: {
        status: 'ok',
        source: 'generated',
        eligible: 1,
        proposed: 1,
        error: null,
        generated_at: '2026-08-30T10:00:00Z',
      },
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => fixture,
    });

    const result = await retryModernizationProposals(PROJECT_ID, ARCH_ID);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `/api/v1/projects/${PROJECT_ID}/architectures/${ARCH_ID}/scl/modernization/review/proposals/retry`,
    );
    expect(options.method).toBe('POST');
    expect(result).toEqual(fixture);
  });

  it('rejects the confirm POST on 400 with the server error + offenders', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({
        error: 'target_architecture_id is required',
        offenders: ['modernize.dates.x'],
      }),
    });

    const err = await confirmModernizationDecisions(PROJECT_ID, ARCH_ID, {
      target_architecture_id: null,
      rows: [],
    }).catch((e) => e);

    expect(err).toBeInstanceOf(SclModernizationApiError);
    expect((err as SclModernizationApiError).status).toBe(400);
    expect((err as Error).message).toContain('target_architecture_id is required');
    expect((err as Error).message).toContain('modernize.dates.x');
  });
});
