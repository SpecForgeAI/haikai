/**
 * Tests for the bounded-concurrency migration-plan LLM pool + its two
 * first-class env config knobs.
 *
 * Spec: 2026-06-11 Two-Phase Migration Delivery Plan Generation
 * (Skeleton → Expand) — Task Group 1 (sub-task 1.1).
 *
 * Test plan (focused per task 1.1 — no exhaustive cancellation/timing/queue
 * permutation coverage):
 *   1. At most N tasks run in-flight at once for limit N (instrumented tasks).
 *   2. Limit 1 runs fully serially, in submission order.
 *   3. One task's rejection does not stall the pool — remaining tasks still
 *      run and the rejection propagates to its own caller.
 *   4. Config reads MIGRATION_PLAN_LLM_CONCURRENCY /
 *      MIGRATION_PLAN_EXPANSION_BATCH_SIZE with defaults 4 / 12.
 *   5. Env overrides are honoured (incl. tunable-to-1 with NO code change).
 *   6. The shared pool is ONE instance, sized from the env knob.
 */

import { LlmConcurrencyPool } from '../services/llmConcurrencyPool';

const tick = (ms = 5) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('LlmConcurrencyPool — bounded concurrency (Spec 2026-06-11, Task Group 1)', () => {
  // Test 1: at most N in-flight for limit N
  it('runs at most N tasks concurrently for limit N', async () => {
    const pool = new LlmConcurrencyPool(2);
    let inFlight = 0;
    let maxInFlight = 0;

    const makeTask = () => async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await tick();
      inFlight -= 1;
      return 'done';
    };

    const results = await Promise.all(
      Array.from({ length: 6 }, () => pool.run(makeTask()))
    );

    expect(results).toEqual(Array(6).fill('done'));
    expect(maxInFlight).toBe(2);
  });

  // Test 2: limit 1 — fully serial, submission order
  it('limit 1 runs tasks fully serially in submission order', async () => {
    const pool = new LlmConcurrencyPool(1);
    const events: string[] = [];

    const makeTask = (label: number) => async () => {
      events.push(`start-${label}`);
      await tick();
      events.push(`end-${label}`);
      return label;
    };

    const results = await Promise.all(
      [0, 1, 2, 3].map((i) => pool.run(makeTask(i)))
    );

    expect(results).toEqual([0, 1, 2, 3]);
    // Fully serial: each task ends before the next one starts, and starts
    // follow submission order.
    expect(events).toEqual([
      'start-0', 'end-0',
      'start-1', 'end-1',
      'start-2', 'end-2',
      'start-3', 'end-3',
    ]);
  });

  // Test 3: rejection propagates to its caller and never stalls the pool
  it('a rejected task propagates its error to its own caller and the pool keeps running queued tasks', async () => {
    const pool = new LlmConcurrencyPool(1);
    const ran: string[] = [];

    const ok = (label: string) => async () => {
      ran.push(label);
      await tick();
      return label;
    };
    const boom = async () => {
      ran.push('boom');
      await tick();
      throw new Error('relay 504');
    };

    const first = pool.run(ok('first'));
    const failing = pool.run(boom);
    const last = pool.run(ok('last'));

    await expect(failing).rejects.toThrow('relay 504');
    await expect(first).resolves.toBe('first');
    // The task queued BEHIND the failure still runs to completion.
    await expect(last).resolves.toBe('last');
    expect(ran).toEqual(['first', 'boom', 'last']);
    expect(pool.inFlightCount).toBe(0);
  });
});

describe('Config — migration-plan LLM concurrency + expansion batch size knobs', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Required variable for loadConfig() regardless of which knobs are set.
    process.env.OPENAI_API_KEY = 'test-api-key';
    delete process.env.LLM_PROVIDER;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // Test 4: defaults — 4 / 12
  it('defaults MIGRATION_PLAN_LLM_CONCURRENCY to 4 and MIGRATION_PLAN_EXPANSION_BATCH_SIZE to 12', () => {
    delete process.env.MIGRATION_PLAN_LLM_CONCURRENCY;
    delete process.env.MIGRATION_PLAN_EXPANSION_BATCH_SIZE;

    const { loadConfig } = require('../config');
    const config = loadConfig();

    expect(config.migrationPlanLlmConcurrency).toBe(4);
    expect(config.migrationPlanExpansionBatchSize).toBe(12);
  });

  // Test 5: env overrides honoured — incl. the hard tunable-to-1 requirement
  it('reads both knobs from env — MIGRATION_PLAN_LLM_CONCURRENCY=1 yields fully serial config with no code change', () => {
    process.env.MIGRATION_PLAN_LLM_CONCURRENCY = '1';
    process.env.MIGRATION_PLAN_EXPANSION_BATCH_SIZE = '30';

    const { loadConfig } = require('../config');
    const config = loadConfig();

    expect(config.migrationPlanLlmConcurrency).toBe(1);
    expect(config.migrationPlanExpansionBatchSize).toBe(30);
  });

  // Test 6: ONE shared pool instance, sized from the env knob
  it('getMigrationPlanLlmPool returns ONE shared instance sized from MIGRATION_PLAN_LLM_CONCURRENCY', () => {
    process.env.MIGRATION_PLAN_LLM_CONCURRENCY = '1';

    const {
      getMigrationPlanLlmPool,
      resetMigrationPlanLlmPoolForTests,
    } = require('../services/llmConcurrencyPool');

    resetMigrationPlanLlmPoolForTests();
    const poolA = getMigrationPlanLlmPool();
    const poolB = getMigrationPlanLlmPool();

    expect(poolA).toBe(poolB);
    expect(poolA.concurrencyLimit).toBe(1);
  });
});
