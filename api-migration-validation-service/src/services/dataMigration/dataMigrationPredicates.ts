/**
 * Predicate self-scoring for the data-migration runner (Spec Y). Emits one
 * `EXEC.DATA.01` predicate per table plus the EXEC stage banner + scorecard, so
 * a data-migration run is judgeable from the shared trace log alone
 * (docs/run-judge). The tracer is injected — the runner report is pure, exactly
 * as the data-parity comparator delegates emission to its caller.
 */
import { Corr, Tracer } from '../../trace';
import { DataMigrationReportBody } from './types';

const STAGE = 'EXEC';

export function emitDataMigrationPredicates(
  report: DataMigrationReportBody,
  tracer: Tracer,
  corr?: Corr,
): void {
  tracer.stageStart(STAGE, corr);
  for (const t of report.tables) {
    const label = `${t.schema ? `${t.schema}.` : ''}${t.table}`;
    const cited = t.rulesCited.length ? ` rules=[${t.rulesCited.join(',')}]` : '';
    const actual =
      `status=${t.status} loaded=${t.loadedCount} ` +
      `source=${t.sourceCount ?? '?'} target=${t.targetCount ?? '?'}${cited}`;
    if (t.status === 'loaded' || t.status === 'empty') {
      tracer.predicate(
        'EXEC.DATA.01',
        'table data loaded and count-reconciled',
        true,
        `target row count == source for ${label}`,
        actual,
        corr,
      );
    } else if (t.status === 'reconciled_mismatch') {
      tracer.predicate(
        'EXEC.DATA.01',
        'table data loaded and count-reconciled',
        false,
        `target row count == source for ${label}`,
        actual,
        corr,
      );
    } else {
      tracer.predicateSkip('EXEC.DATA.01', `table data load — ${label}`, `${t.status}: ${t.reason ?? 'not verified'}`, corr);
    }
  }
  tracer.stageEnd(STAGE, corr);
}
