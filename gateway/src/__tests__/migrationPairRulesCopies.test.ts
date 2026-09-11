/**
 * The pair-rules library is ONE file with byte-identical copies in the three
 * Node services (the trace.ts convention). The copies drifted silently once
 * (2026-09-11 audit: AMVS superset, discovery stale floor-vs-round); this
 * pin makes drift a red test. Skips honestly when a sibling service is not
 * checked out next to the gateway.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const HERE = join(__dirname, '..', 'migrationPairRules.ts');
const SIBLINGS = [
  join(__dirname, '..', '..', '..', 'api-migration-validation-service', 'src', 'migrationPairRules.ts'),
  join(__dirname, '..', '..', '..', 'discovery-service', 'src', 'migrationPairRules.ts'),
];

function normalise(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

describe('migrationPairRules.ts copies', () => {
  for (const sibling of SIBLINGS) {
    test(`${sibling.split(/[\\/]/).slice(-3, -2)[0]} copy is identical to the gateway copy`, () => {
      if (!existsSync(sibling)) {
        console.warn(`[migrationPairRulesCopies] sibling not checked out, skipping: ${sibling}`);
        return;
      }
      expect(normalise(readFileSync(sibling, 'utf8'))).toBe(normalise(readFileSync(HERE, 'utf8')));
    });
  }
});
