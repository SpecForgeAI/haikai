/**
 * Focused tests for the per-scenario persisted-capture counter on `runManager`.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 *       misleading-COMPLETED follow-up.
 *
 * Scope:
 *   - `start()` initialises `scenarioCapturesPersisted = 0`.
 *   - `beginScenario(sessionId)` resets `scenarioCapturesPersisted` alongside
 *     the existing `scenarioHttpAttempts` / `currentScenarioRounds` resets.
 *   - `incrementCapturesPersisted(sessionId)` returns 1, 2, ... on successive
 *     calls and the value is readable via `getScenarioCapturesPersisted`.
 *   - `incrementCapturesPersisted` throws on an unknown session (mirrors
 *     `incrementHttpAttempts`).
 */

import { RunManager } from '../services/runManager';

const SESSION_ID = 'session-rm-captures-1';
const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';

describe('runManager -- scenarioCapturesPersisted', () => {
  it('initialises scenarioCapturesPersisted=0 on start()', () => {
    const rm = new RunManager();
    const state = rm.start({ sessionId: SESSION_ID, projectId: PROJECT_ID, architectureId: ARCH_ID });
    expect(state.scenarioCapturesPersisted).toBe(0);
    expect(rm.getScenarioCapturesPersisted(SESSION_ID)).toBe(0);
    rm.end(SESSION_ID);
  });

  it('beginScenario(sessionId) resets scenarioCapturesPersisted to 0 alongside the attempt counter', () => {
    const rm = new RunManager();
    rm.start({ sessionId: SESSION_ID, projectId: PROJECT_ID, architectureId: ARCH_ID });
    rm.incrementCapturesPersisted(SESSION_ID);
    rm.incrementCapturesPersisted(SESSION_ID);
    rm.incrementHttpAttempts(SESSION_ID);
    expect(rm.getScenarioCapturesPersisted(SESSION_ID)).toBe(2);
    expect(rm.getScenarioHttpAttempts(SESSION_ID)).toBe(1);

    rm.beginScenario(SESSION_ID);
    expect(rm.getScenarioCapturesPersisted(SESSION_ID)).toBe(0);
    expect(rm.getScenarioHttpAttempts(SESSION_ID)).toBe(0);
    rm.end(SESSION_ID);
  });

  it('incrementCapturesPersisted returns 1, 2, 3 on successive calls and survives a read via getScenarioCapturesPersisted', () => {
    const rm = new RunManager();
    rm.start({ sessionId: SESSION_ID, projectId: PROJECT_ID, architectureId: ARCH_ID });
    expect(rm.incrementCapturesPersisted(SESSION_ID)).toBe(1);
    expect(rm.incrementCapturesPersisted(SESSION_ID)).toBe(2);
    expect(rm.incrementCapturesPersisted(SESSION_ID)).toBe(3);
    expect(rm.getScenarioCapturesPersisted(SESSION_ID)).toBe(3);
    rm.end(SESSION_ID);
  });

  it('incrementCapturesPersisted throws on an unknown session (mirrors incrementHttpAttempts contract)', () => {
    const rm = new RunManager();
    expect(() => rm.incrementCapturesPersisted('does-not-exist')).toThrow(
      /no live run for session/i,
    );
  });

  it('getScenarioCapturesPersisted returns undefined for an unknown session', () => {
    const rm = new RunManager();
    expect(rm.getScenarioCapturesPersisted('nope')).toBeUndefined();
  });
});
