/**
 * Pre-start compensation-preflight warning builders (CSD Spec 3 gap fix,
 * 2026-08-19). Pins: clean preflight = no prompt; missing-effect-map list
 * rendered verbatim with elision past 10; unresolvable model = the
 * compensation-INACTIVE warning; unavailable-check variant names the error.
 */

import { describe, it, expect } from 'vitest';
import {
  buildCompensationPreflightWarning,
  buildPreflightUnavailableWarning,
} from './compensationPreflightSupport';

describe('buildCompensationPreflightWarning', () => {
  it('returns null when the model resolves and every write endpoint has an effect map', () => {
    expect(
      buildCompensationPreflightWarning({
        model_resolvable: true,
        write_endpoints_without_effect_map: [],
        note: null,
      }),
    ).toBeNull();
  });

  it('lists the unmapped write endpoints verbatim with the refusal + remedy wording', () => {
    const warning = buildCompensationPreflightWarning({
      model_resolvable: true,
      write_endpoints_without_effect_map: ['DELETE /orders/{id}', 'POST /orders'],
      note: 'x',
    });
    expect(warning).toContain('2 write endpoint(s) will be REFUSED at capture time');
    expect(warning).toContain('DELETE /orders/{id}');
    expect(warning).toContain('POST /orders');
    expect(warning).toContain('save-back the endpoint data effects');
    expect(warning).toContain('Start anyway?');
    expect(warning).not.toContain('more)');
  });

  it('elides past 10 endpoints with an explicit +N more count', () => {
    const missing = Array.from({ length: 14 }, (_, i) => `POST /things/${i}`);
    const warning = buildCompensationPreflightWarning({
      model_resolvable: true,
      write_endpoints_without_effect_map: missing,
    });
    expect(warning).toContain('14 write endpoint(s)');
    expect(warning).toContain('POST /things/9');
    expect(warning).not.toContain('POST /things/10');
    expect(warning).toContain('(+4 more)');
  });

  it('warns compensation-INACTIVE when the committed model cannot be read', () => {
    const warning = buildCompensationPreflightWarning({
      model_resolvable: false,
      write_endpoints_without_effect_map: [],
    });
    expect(warning).toContain('compensation will be INACTIVE');
    expect(warning).toContain('Start anyway?');
  });
});

describe('buildPreflightUnavailableWarning', () => {
  it('names the failure and still asks before proceeding', () => {
    const warning = buildPreflightUnavailableWarning('HTTP 503 from gateway');
    expect(warning).toContain('could not run (HTTP 503 from gateway)');
    expect(warning).toContain('Start anyway?');
  });
});
