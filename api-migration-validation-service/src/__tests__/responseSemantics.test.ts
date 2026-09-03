/**
 * responseSemantics -- focused tests (Spec: 2026-06-23 Semantics-aware API
 * Behaviour Baseline coverage, Task Group 1 sub-task 1.1).
 *
 * Kept to the 2-8 highly-focused tests the spec asks for. Each test pins ONE
 * critical classifier behaviour; exhaustive enumeration of every marker / body
 * shape is deliberately skipped.
 */

import {
  classifyObservedBehaviour,
  resolveConfig,
  DEFAULT_NOT_FOUND_MARKERS,
  DEFAULT_BAD_REQUEST_MARKERS,
  USE_BUILT_IN_DEFAULTS,
  type ResponseSemanticsConfig,
} from '../services/responseSemantics';

describe('classifyObservedBehaviour -- not_found', () => {
  it('classifies a 404, a 2xx with an empty/[]/{} body, and a not_found marker', () => {
    // (a) HTTP 404.
    const byStatus = classifyObservedBehaviour(404, { message: 'gone' });
    expect(byStatus.bucket).toBe('not_found');
    expect(byStatus.observed).toBe(true);
    expect(byStatus.anomaly).toBeNull();

    // (b) 2xx with empty body shapes => not_found, flagged as a deviation.
    for (const empty of ['', null, [], {}] as const) {
      const r = classifyObservedBehaviour(200, empty);
      expect(r.bucket).toBe('not_found');
      expect(r.observed).toBe(true);
      expect(r.observation).not.toBeNull();
    }

    // (c) 2xx carrying a not_found marker => not_found + "200 for missing".
    const byMarker = classifyObservedBehaviour(200, { detail: 'record not found' });
    expect(byMarker.bucket).toBe('not_found');
    expect(byMarker.observed).toBe(true);
    expect(byMarker.observation).toMatch(/missing resource/i);
  });
});

describe('classifyObservedBehaviour -- client_error', () => {
  it('classifies a 4xx and a bad-request marker', () => {
    const byStatus = classifyObservedBehaviour(400, { error: 'bad' });
    expect(byStatus.bucket).toBe('client_error');
    expect(byStatus.observed).toBe(true);
    expect(byStatus.anomaly).toBeNull();

    // A 200 body that nonetheless reports a validation error is a deviation,
    // still observed (a usable oracle), bucketed client_error.
    const byMarker = classifyObservedBehaviour(200, { error: 'validation failed' });
    expect(byMarker.bucket).toBe('client_error');
    expect(byMarker.observed).toBe(true);
    expect(byMarker.observation).not.toBeNull();
  });
});

describe('classifyObservedBehaviour -- success + auth', () => {
  it('classifies a 2xx non-empty non-error body as success, and 401/403 as auth', () => {
    const ok = classifyObservedBehaviour(200, { id: 7, name: 'thing' });
    expect(ok.bucket).toBe('success');
    expect(ok.observed).toBe(true);
    expect(ok.observation).toBeNull();
    expect(ok.anomaly).toBeNull();

    for (const status of [401, 403]) {
      const auth = classifyObservedBehaviour(status, { error: 'unauthorized' });
      expect(auth.bucket).toBe('auth');
      expect(auth.observed).toBe(true);
      expect(auth.anomaly).toBeNull();
    }
  });
});

describe('classifyObservedBehaviour -- 5xx crash vs deliberate validation-reject', () => {
  it('treats a validation-body 5xx as a usable oracle but an unrecognized 5xx as a crash (safe default)', () => {
    // 5xx + bad-request marker => observed client_error, no anomaly.
    const validation = classifyObservedBehaviour(500, { error: 'invalid payload' });
    expect(validation.bucket).toBe('client_error');
    expect(validation.observed).toBe(true);
    expect(validation.anomaly).toBeNull();
    expect(validation.observation).toMatch(/500 for bad input/i);

    // 5xx + no recognizable validation body => NOT observed, crash anomaly.
    const crash = classifyObservedBehaviour(500, { stack: 'NullPointerException' });
    expect(crash.bucket).toBe('client_error');
    expect(crash.observed).toBe(false);
    expect(crash.anomaly).toMatch(/possible crash/i);

    // Transport failure (status null) with no body => NOT observed.
    const transport = classifyObservedBehaviour(null, null);
    expect(transport.observed).toBe(false);
    expect(transport.anomaly).toMatch(/transport failure/i);

    // config.fiveXxIsBadInput flips an otherwise-crash 5xx into a usable oracle.
    const declared = classifyObservedBehaviour(
      500,
      { stack: 'NullPointerException' },
      { fiveXxIsBadInput: true },
    );
    expect(declared.observed).toBe(true);
    expect(declared.anomaly).toBeNull();
  });
});

describe('classifyObservedBehaviour -- case-insensitivity', () => {
  it('matches markers regardless of case', () => {
    const upper = classifyObservedBehaviour(200, { detail: 'NOT FOUND' });
    expect(upper.bucket).toBe('not_found');

    const mixed = classifyObservedBehaviour(422, { error: 'VALIDATION error' });
    expect(mixed.bucket).toBe('client_error');
    expect(mixed.observed).toBe(true);
  });
});

describe('classifyObservedBehaviour -- per-API config override', () => {
  it('honours a status->bucket override and a marker-vocabulary extension', () => {
    // Status override: force 200 -> not_found for an API that 200s on missing.
    const mapped = classifyObservedBehaviour(200, { id: 1 }, {
      statusBucketOverride: { 200: 'not_found' },
    });
    expect(mapped.bucket).toBe('not_found');
    expect(mapped.observed).toBe(true);
    expect(mapped.observation).toMatch(/missing resource/i);

    // Vocabulary extension: a bespoke not_found marker now classifies a 4xx
    // body as not_found (markers outrank the 4xx status-class default).
    const extended: ResponseSemanticsConfig = {
      notFoundMarkers: { mode: 'extend', markers: ['gone for good'] },
    };
    const custom = classifyObservedBehaviour(404, { detail: 'gone for good' }, extended);
    expect(custom.bucket).toBe('not_found');
    const resolved = resolveConfig(extended);
    expect(resolved.notFoundMarkers).toEqual([...DEFAULT_NOT_FOUND_MARKERS, 'gone for good']);
  });
});

describe('resolveConfig -- absent config and the built-in-defaults sentinel', () => {
  it('treats absent config and the explicit sentinel as the built-in defaults', () => {
    // Absent / null config === built-in defaults (the valid empty state).
    const fromAbsent = resolveConfig(undefined);
    expect(fromAbsent.notFoundMarkers).toEqual(DEFAULT_NOT_FOUND_MARKERS);
    expect(fromAbsent.badRequestMarkers).toEqual(DEFAULT_BAD_REQUEST_MARKERS);
    expect(fromAbsent.fiveXxIsBadInput).toBe(false);
    expect(fromAbsent.statusBucketOverride).toEqual({});

    // The "(use built-in defaults)" sentinel resolves to the SAME effective
    // vocabulary as untouched -- "explicitly default" is distinct in the config
    // shape but identical in the resolved result.
    const fromSentinel = resolveConfig({
      notFoundMarkers: USE_BUILT_IN_DEFAULTS,
      badRequestMarkers: USE_BUILT_IN_DEFAULTS,
      statusBucketOverride: { 200: USE_BUILT_IN_DEFAULTS },
    });
    expect(fromSentinel.notFoundMarkers).toEqual(DEFAULT_NOT_FOUND_MARKERS);
    expect(fromSentinel.badRequestMarkers).toEqual(DEFAULT_BAD_REQUEST_MARKERS);
    expect(fromSentinel.statusBucketOverride).toEqual({});
  });
});

describe('classifyObservedBehaviour -- estate bad-input vocabulary (2026-09-03)', () => {
  it('treats ILLEGAL_PARAM / FATAL / "is not a valid" / "must be specified" bodies on a 5xx as observed client_error', () => {
    for (const body of [
      { code: 'ILLEGAL_PARAM', message: 'bad id' },
      { level: 'FATAL', message: 'cannot continue' },
      { message: '2026-13-01 is not a valid date' },
      { message: 'the view id must be specified' },
    ]) {
      const r = classifyObservedBehaviour(500, body);
      expect(r.bucket).toBe('client_error');
      expect(r.observed).toBe(true);
      expect(r.anomaly).toBeNull();
    }
    // The four are part of the built-in defaults (mirrored in the frontend step).
    for (const m of ['ILLEGAL_PARAM', 'FATAL', 'is not a valid', 'must be specified']) {
      expect(DEFAULT_BAD_REQUEST_MARKERS).toContain(m);
    }
  });
});
