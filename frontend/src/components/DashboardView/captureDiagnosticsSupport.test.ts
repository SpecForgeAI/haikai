/** Spec 0 (2026-08-22): identical-message grouping — display-only collapse
 *  of per-scenario repeat walls into xN lines. */

import type { ApiBehaviourDiagnosticDto } from '../../api/apiBehaviourClient';
import { groupIdenticalMessages } from './captureDiagnosticsSupport';

function diag(id: string, message: string | null): ApiBehaviourDiagnosticDto {
  return { id, diagnostic_type: 'compensation_refused', message } as ApiBehaviourDiagnosticDto;
}

describe('groupIdenticalMessages', () => {
  it('collapses identical messages with a count, preserving first-seen order', () => {
    const grouped = groupIdenticalMessages([
      diag('a', 'table x: missing_pk'),
      diag('b', 'table y: missing_pk'),
      diag('c', 'table x: missing_pk'),
      diag('d', 'table x: missing_pk'),
    ]);
    expect(grouped).toEqual([
      { message: 'table x: missing_pk', count: 3, id: 'a' },
      { message: 'table y: missing_pk', count: 1, id: 'b' },
    ]);
  });

  it('null messages group under the placeholder', () => {
    const grouped = groupIdenticalMessages([diag('a', null), diag('b', null)]);
    expect(grouped).toEqual([{ message: '(no message)', count: 2, id: 'a' }]);
  });
});
