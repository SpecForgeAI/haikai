/**
 * TRANSIENT_SIGNATURES cross-service sync guard (gold standard 2026-08-07).
 *
 * The gateway's fallback transient-failure scan
 * (`migrationSpecRetryPolicy.TRANSIENT_SIGNATURES`) documents that it MIRRORS
 * `implement-verify-service/src/chat/transient_failure.py` — but nothing
 * enforced it, so either list could drift silently and misclassify failures
 * (a real failure endlessly retried, or a transient one halting a run).
 *
 * This guard reads the Python source from the monorepo and asserts every
 * gateway signature appears there (count == covered — the repo's guard-test
 * rule; never `>= N`). A signature added on either side without the other
 * fails here with the exact missing entries.
 */
import { readFileSync } from 'fs';
import * as path from 'path';
import { TRANSIENT_SIGNATURES } from '../services/migrationSpecRetryPolicy';

const IVS_TRANSIENT_PY = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'implement-verify-service',
  'src',
  'chat',
  'transient_failure.py'
);

describe('TRANSIENT_SIGNATURES cross-service sync', () => {
  it('every gateway signature appears in the IVS transient_failure.py source (count == covered)', () => {
    const py = readFileSync(IVS_TRANSIENT_PY, 'utf-8').toLowerCase();
    const missing = TRANSIENT_SIGNATURES.filter((sig) => !py.includes(sig.toLowerCase()));
    expect(missing).toEqual([]);
  });

  it('every IVS signature literal appears in the gateway list (reverse direction)', () => {
    const py = readFileSync(IVS_TRANSIENT_PY, 'utf-8');
    // The Python list holds one quoted lowercase literal per line inside
    // TRANSIENT_SIGNATURES = [...]; extract them structurally.
    const block = /TRANSIENT_SIGNATURES\s*(?::[^=]+)?=\s*[\[(]([\s\S]*?)[\])]/.exec(py);
    expect(block).toBeTruthy();
    const literals = [...block![1].matchAll(/"([^"]+)"|'([^']+)'/g)]
      .map((m) => (m[1] ?? m[2]).toLowerCase())
      .filter((s) => s.length > 0);
    expect(literals.length).toBeGreaterThan(0);
    const gateway = TRANSIENT_SIGNATURES.map((s) => s.toLowerCase());
    const missing = literals.filter((sig) => !gateway.includes(sig));
    expect(missing).toEqual([]);
  });
});
