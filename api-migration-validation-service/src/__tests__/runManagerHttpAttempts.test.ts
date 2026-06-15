/**
 * Focused tests for the new per-scenario HTTP-attempt counter on `runManager`.
 *
 * Spec: 2026-05-16 API Behaviour Capture Fixes -- Task Group 1 sub-task 1.1.
 *
 * Scope:
 *   - `start()` initialises `scenarioHttpAttempts = 0`.
 *   - `beginScenario(sessionId)` resets `scenarioHttpAttempts` alongside the
 *     existing `currentScenarioRounds` reset.
 *   - `incrementHttpAttempts(sessionId)` returns 1, 2, 3 on successive calls
 *     and the value is readable via `get(sessionId)?.scenarioHttpAttempts`.
 *   - `incrementHttpAttempts` throws on an unknown session (mirrors
 *     `incrementScenarioRounds`).
 *
 * The existing scenario-round counter behaviour is intentionally not
 * re-tested here -- it is exercised by predecessor-spec coverage.
 */

import { RunManager } from '../services/runManager';

const SESSION_ID = 'session-rm-http-1';
const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';

describe('runManager -- scenarioHttpAttempts', () => {
  it('initialises scenarioHttpAttempts=0 on start()', () => {
    const rm = new RunManager();
    const state = rm.start({
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      architectureId: ARCH_ID,
    });
    expect(state.scenarioHttpAttempts).toBe(0);
    expect(rm.get(SESSION_ID)?.scenarioHttpAttempts).toBe(0);
    rm.end(SESSION_ID);
  });

  it('beginScenario(sessionId) resets scenarioHttpAttempts to 0 alongside currentScenarioRounds', () => {
    const rm = new RunManager();
    rm.start({
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      architectureId: ARCH_ID,
    });
    // Pump both counters first.
    rm.incrementScenarioRounds(SESSION_ID);
    rm.incrementScenarioRounds(SESSION_ID);
    rm.incrementHttpAttempts(SESSION_ID);
    rm.incrementHttpAttempts(SESSION_ID);
    rm.incrementHttpAttempts(SESSION_ID);
    expect(rm.get(SESSION_ID)?.currentScenarioRounds).toBe(2);
    expect(rm.get(SESSION_ID)?.scenarioHttpAttempts).toBe(3);

    rm.beginScenario(SESSION_ID);
    expect(rm.get(SESSION_ID)?.currentScenarioRounds).toBe(0);
    expect(rm.get(SESSION_ID)?.scenarioHttpAttempts).toBe(0);
    rm.end(SESSION_ID);
  });

  it('incrementHttpAttempts returns 1, 2, 3 on successive calls and survives a read via get()', () => {
    const rm = new RunManager();
    rm.start({
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      architectureId: ARCH_ID,
    });
    expect(rm.incrementHttpAttempts(SESSION_ID)).toBe(1);
    expect(rm.incrementHttpAttempts(SESSION_ID)).toBe(2);
    expect(rm.incrementHttpAttempts(SESSION_ID)).toBe(3);
    expect(rm.get(SESSION_ID)?.scenarioHttpAttempts).toBe(3);
    expect(rm.getScenarioHttpAttempts(SESSION_ID)).toBe(3);
    rm.end(SESSION_ID);
  });

  it('incrementHttpAttempts throws on an unknown session (mirrors incrementScenarioRounds contract)', () => {
    const rm = new RunManager();
    expect(() => rm.incrementHttpAttempts('does-not-exist')).toThrow(
      /no live run for session/i,
    );
  });
});
