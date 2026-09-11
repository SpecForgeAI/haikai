/**
 * Pair-neutral translation prompts (second-pair programme, Spec 6 §6.1–6.4).
 *
 * Pins: the profile is data from the ruleset (display, dialect, catalog
 * refusal, scheduler, untranslatable constructs, token conversions,
 * conventions); the SQL Server prompt never says "Sybase" and the Sybase
 * prompt never says "SQL Server"; the neutral profile names no engine; the
 * error/transaction conventions and the continue-after-error fact reach the
 * translator AND the judge; trigger conventions reach trigger prompts; the
 * pre-pass honours pair-owned conversions/flags; named untranslatable
 * reasons seed rewrite_in_app proposals without overriding operator choices.
 */
import { resetPairRulesetCacheForTest, resolvePairRuleset } from '../migrationPairRules';
import {
  NEUTRAL_TRANSLATION_PROFILE,
  renderConventions,
  translationProfileFor,
} from '../services/dbMigrationPack/translationProfile';
import {
  buildJudgePrompt,
  buildTranslationPrompt,
  buildTranslationUpsertBatch,
  kindInstructions,
  resolveSeedSources,
  runDeterministicPrePass,
  untranslatableReasonForRoutine,
  type RoutineBodySource,
  type TranslationRow,
} from '../services/dbMigrationPack/translations';

beforeEach(() => {
  delete process.env.MIGRATION_PAIR;
  delete process.env.MIGRATION_PAIR_RULESET_PATH;
  resetPairRulesetCacheForTest();
});

const sybase = () => translationProfileFor(resolvePairRuleset({ sourceEngine: 'sybase' }));
const mssql = () => translationProfileFor(resolvePairRuleset({ sourceEngine: 'mssql' }));

const prePass = { convertedBody: 'select 1', conversionNotes: [], flags: [] };

describe('translationProfileFor', () => {
  it('reads the pair facts from each ruleset and derives conventions (ABI excluded)', () => {
    const s = sybase();
    expect(s.sourceDisplay).toBe('Sybase ASE');
    expect(s.catalogRefusal).toContain('sysobjects');
    expect(s.conventions.map((c) => c.ruleId)).toEqual(expect.arrayContaining(['SYBPG.PROC.TXN.001', 'SYBPG.PROC.TRIGGER.001', 'SYBPG.PROC.ERR.001']));
    expect(s.conventions.map((c) => c.ruleId)).not.toContain('SYBPG.PROC.ABI.001');
    const m = mssql();
    expect(m.sourceDisplay).toBe('SQL Server 2022 (16.x)');
    expect(m.catalogRefusal).toContain('sys.');
    expect(m.schedulerName).toBe('SQL Server Agent');
    const txn = m.conventions.find((c) => c.ruleId === 'MSPG.PROC.TXN.001');
    expect(txn?.entries.map((e) => e.key)).toEqual(expect.arrayContaining(['try_catch', 'xact_abort_off_continuation', 'nested_begin_tran']));
    expect(m.untranslatableReasons.cross_database_reference).toContain('OUT by ruling');
    expect(m.tokenConversions.some((t) => t.token === 'sysutcdatetime')).toBe(true);
  });

  it('the neutral profile names no engine', () => {
    expect(translationProfileFor(null)).toBe(NEUTRAL_TRANSLATION_PROFILE);
    expect(NEUTRAL_TRANSLATION_PROFILE.sourceDisplay).not.toMatch(/sybase|sql server/i);
  });

  it('renders conventions per translation kind', () => {
    expect(renderConventions(mssql(), 'trigger')).toContain('MSPG.PROC.TRIGGER.001');
    // TXN/ERR conventions apply to triggers too (object_kinds include trigger).
    expect(renderConventions(mssql(), 'trigger')).toContain('MSPG.PROC.TXN.001');
    expect(renderConventions(mssql(), 'stored_procedure')).toContain('MSPG.PROC.TXN.001');
    expect(renderConventions(mssql(), 'view')).toBe('');
  });
});

describe('prompts are pair-neutral templates', () => {
  it('SQL Server prompts never say Sybase; Sybase prompts never say SQL Server; neutral says neither', () => {
    const m = buildTranslationPrompt({ kind: 'stored_procedure', objectRef: 'dbo.p', prePass, schemaContext: '', profile: mssql() });
    expect(`${m.systemPrompt}\n${m.userPrompt}`).not.toMatch(/sybase/i);
    expect(m.systemPrompt).toContain('SQL Server 2022 (16.x)');
    expect(m.systemPrompt).toContain('sys.');
    const s = buildTranslationPrompt({ kind: 'stored_procedure', objectRef: 'dbo.p', prePass, schemaContext: '', profile: sybase() });
    expect(`${s.systemPrompt}\n${s.userPrompt}`).not.toMatch(/sql server/i);
    expect(s.systemPrompt).toContain('Sybase ASE');
    expect(s.systemPrompt).toContain('sysobjects');
    const n = buildTranslationPrompt({ kind: 'view', objectRef: 'dbo.v', prePass, schemaContext: '' });
    expect(`${n.systemPrompt}\n${n.userPrompt}`).not.toMatch(/sybase|sql server/i);
    expect(n.userPrompt).toContain('the T-SQL source engine');
  });

  it('kind instructions take the scheduler and dialect from the profile', () => {
    expect(kindInstructions('scheduled_job', mssql())).toContain('SQL Server Agent job');
    expect(kindInstructions('scheduled_job', sybase())).toContain('Sybase DB-resident scheduled job');
    expect(kindInstructions('trigger', mssql())).toContain('REFERENCING NEW TABLE AS inserted');
  });

  it('the error/transaction conventions and the continue-after-error fact reach translator and judge', () => {
    const t = buildTranslationPrompt({ kind: 'stored_procedure', objectRef: 'dbo.p', prePass, schemaContext: '', profile: mssql(), constructs: ['try_catch', 'error_continuation'] });
    expect(t.userPrompt).toContain('Pair conventions');
    expect(t.userPrompt).toContain('MSPG.PROC.TXN.001');
    expect(t.userPrompt).toContain('MSPG.PROC.ERR.001');
    expect(t.userPrompt).toContain('CONTINUES after a failed statement');
    const j = buildJudgePrompt({ kind: 'stored_procedure', objectRef: 'dbo.p', sourceBody: 'x', draftSql: 'y', schemaContext: '', profile: mssql(), constructs: ['error_continuation'] });
    expect(j.systemPrompt).toContain('continue_after_error_expected = true');
    expect(j.userPrompt).toContain('Source (SQL Server 2022 (16.x) T-SQL (SQL Server)):');
    const quiet = buildJudgePrompt({ kind: 'stored_procedure', objectRef: 'dbo.p', sourceBody: 'x', draftSql: 'y', schemaContext: '', profile: mssql() });
    expect(quiet.systemPrompt).not.toContain('continue_after_error_expected');
  });

  it('trigger prompts carry the trigger conventions', () => {
    const t = buildTranslationPrompt({ kind: 'trigger', objectRef: 'dbo.trg', prePass, schemaContext: '', profile: mssql() });
    expect(t.userPrompt).toContain('MSPG.PROC.TRIGGER.001');
    expect(t.userPrompt).toContain('instead_of_view');
  });
});

describe('deterministic pre-pass with a pair profile', () => {
  it('applies pair-owned token conversions and flags pair-owned untranslatable constructs (deduped)', () => {
    const r = runDeterministicPrePass("select sysutcdatetime(), * from openquery(lnk, 'select 1'); exec sp_send_dbmail @x = 1", mssql());
    expect(r.convertedBody).toContain("(now() AT TIME ZONE 'UTC')");
    expect(r.flags.some((f) => f.startsWith('OPENQUERY/OPENROWSET/OPENDATASOURCE:'))).toBe(true);
    expect(r.flags.some((f) => f.startsWith('sp_send_dbmail:'))).toBe(true);
    const s = runDeterministicPrePass('exec xp_sendmail @recipients = 1', sybase());
    expect(s.flags.filter((f) => f.startsWith('xp_sendmail:'))).toHaveLength(1);
    const bare = runDeterministicPrePass('select getdate()');
    expect(bare.convertedBody).toBe('select now()');
  });
});

describe('named untranslatable reasons', () => {
  const routine = (over: Partial<RoutineBodySource>): RoutineBodySource => ({
    id: 'r1', schema_name: 'dbo', routine_name: 'usp_x', routine_kind: 'procedure', full_body: 'select 1', ...over,
  });

  it('derive from the routine language and profile constructs', () => {
    expect(untranslatableReasonForRoutine(routine({ language: 'CLR' }))).toBe('clr_object');
    expect(untranslatableReasonForRoutine(routine({ profile_json: { constructs: ['three_part_name'] } }))).toBe('cross_database_reference');
    expect(untranslatableReasonForRoutine(routine({ profile_json: { constructs: ['service_broker'] } }))).toBe('service_broker_object');
    expect(untranslatableReasonForRoutine(routine({ profile_json: { constructs: ['try_catch'] } }))).toBeNull();
  });

  it('seed rewrite_in_app proposals, clear on re-scan, and never override an operator disposition', () => {
    const entries = [{ kind: 'stored_procedure', object_ref: 'dbo.usp_x', finding_ids: [] }];
    const crossDb = [routine({ profile_json: { constructs: ['cross_database'] } })];
    const seeds = resolveSeedSources(entries, [], crossDb);
    expect(seeds[0].untranslatable_reason).toBe('cross_database_reference');

    const fresh = buildTranslationUpsertBatch(seeds, []);
    expect(fresh.translations[0]).toMatchObject({ disposition: 'rewrite_in_app', untranslatable_reason: 'cross_database_reference', pipeline_state: 'pending' });

    const priorTranslate = { translation_key: seeds[0].translation_key, disposition: 'translate', review_status: 'unreviewed', draft_content: null, source_body_hash: seeds[0].source_body_hash, pipeline_state: 'pending', untranslatable_reason: null } as unknown as TranslationRow;
    expect(buildTranslationUpsertBatch(seeds, [priorTranslate]).translations[0].disposition).toBe('rewrite_in_app');

    const operatorDrop = { ...priorTranslate, disposition: 'drop' } as unknown as TranslationRow;
    expect(buildTranslationUpsertBatch(seeds, [operatorDrop]).translations[0].disposition).toBeUndefined();

    const cleanSeeds = resolveSeedSources(entries, [], [routine({})]);
    expect(cleanSeeds[0].untranslatable_reason).toBeNull();
    const proposedBefore = { ...priorTranslate, disposition: 'rewrite_in_app', untranslatable_reason: 'cross_database_reference' } as unknown as TranslationRow;
    const lifted = buildTranslationUpsertBatch(cleanSeeds, [proposedBefore]).translations[0];
    expect(lifted.untranslatable_reason).toBe('');
    expect(lifted.disposition).toBe('translate');
  });
});
