/**
 * Target-service serve-spec DEFAULTS derivation (stage-2 Start modal,
 * 2026-07-31).
 *
 * The stage-2 dialog mirrors the DB plane's declare-then-confirm pattern:
 * the tool DECLARES a serve spec (command / health path / port env) derived
 * from the target-state captured decisions (`service.framework`,
 * `service.language`, `service.runtime`, `build.tool`), and the operator
 * confirms or overrides it. Best-effort ONLY: any failure (no target
 * architecture, no decisions, unknown runtime) degrades to the generic
 * fallback — the dialog always opens, never errors.
 *
 * Host is always haibox's local backend (127.0.0.1) and the port is
 * OS-assigned at launch — neither is an input here.
 */
import { logger } from './logger';
import {
  fetchActiveTargetArchitectureId,
  fetchLatestCapturedDecisions,
} from './targetStateCapturedDecisionsClient';

export interface ServeSpecDefaults {
  command: string;
  health_path: string;
  port_env: string;
  readiness_timeout: number;
  /**
   * OPTIONAL bootstrap command run once before `command` (haibox `setup`,
   * 2026-08-01). '' = none needed: self-building run commands like
   * `mvn spring-boot:run` install their own dependencies, while `npm start`
   * style runtimes need an install step first.
   */
  setup: string;
  /** 'derived' when a runtime matched; 'fallback' when nothing did. */
  source: 'derived' | 'fallback';
  /** The decision text the derivation keyed on (operator context). */
  runtime_hint: string | null;
}

const FALLBACK: ServeSpecDefaults = {
  command: '',
  health_path: '/',
  port_env: 'PORT',
  readiness_timeout: 30,
  setup: '',
  source: 'fallback',
  runtime_hint: null,
};

/** Pure mapping from decision answers to serve-spec defaults. */
export function serveSpecDefaultsFromAnswers(answers: {
  framework?: string | null;
  language?: string | null;
  runtime?: string | null;
  buildTool?: string | null;
}): ServeSpecDefaults {
  const haystack = [answers.framework, answers.language, answers.runtime, answers.buildTool]
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .join(' | ');
  const lower = haystack.toLowerCase();
  const hint = haystack === '' ? null : haystack;

  if (lower.includes('spring')) {
    const gradle = lower.includes('gradle');
    return {
      command: gradle ? './gradlew bootRun' : 'mvn spring-boot:run',
      health_path: '/actuator/health',
      port_env: 'SERVER_PORT',
      readiness_timeout: 60,
      setup: '', // bootRun / spring-boot:run resolve dependencies themselves
      source: 'derived',
      runtime_hint: hint,
    };
  }
  if (lower.includes('node') || lower.includes('express') || lower.includes('nest')) {
    return {
      command: 'npm start',
      health_path: '/health',
      port_env: 'PORT',
      readiness_timeout: 30,
      setup: 'npm install', // `npm start` cannot boot without node_modules
      source: 'derived',
      runtime_hint: hint,
    };
  }
  if (lower.includes('fastapi') || lower.includes('uvicorn') || lower.includes('python')) {
    return {
      command: 'uvicorn app.main:app --host 127.0.0.1 --port $PORT',
      health_path: '/health',
      port_env: 'PORT',
      readiness_timeout: 30,
      setup: 'pip install -r requirements.txt',
      source: 'derived',
      runtime_hint: hint,
    };
  }
  if (lower.includes('dotnet') || lower.includes('.net') || lower.includes('asp.net')) {
    return {
      command: 'dotnet run',
      health_path: '/health',
      port_env: 'ASPNETCORE_HTTP_PORTS',
      readiness_timeout: 60,
      setup: 'dotnet restore',
      source: 'derived',
      runtime_hint: hint,
    };
  }
  if (lower.includes('go ') || lower.includes('golang')) {
    return {
      command: 'go run .',
      health_path: '/health',
      port_env: 'PORT',
      readiness_timeout: 30,
      setup: '', // `go run` fetches modules itself
      source: 'derived',
      runtime_hint: hint,
    };
  }
  return { ...FALLBACK, runtime_hint: hint };
}

/**
 * Derive the defaults for a project from its ACTIVE target architecture's
 * captured decisions. Never throws.
 */
export async function deriveServeSpecDefaults(projectId: string): Promise<ServeSpecDefaults> {
  try {
    const active = await fetchActiveTargetArchitectureId(projectId);
    const targetArchitectureId = active.activeTargetArchitectureId;
    if (!targetArchitectureId) return { ...FALLBACK };
    const decisions = await fetchLatestCapturedDecisions(projectId, targetArchitectureId);
    const answer = (code: string): string | null => {
      const row = decisions.find((d) => d.decisionCode === code);
      const value = (row as { answerValue?: unknown } | undefined)?.answerValue;
      return typeof value === 'string' && value.trim() !== '' ? value : null;
    };
    return serveSpecDefaultsFromAnswers({
      framework: answer('service.framework'),
      language: answer('service.language'),
      runtime: answer('service.runtime'),
      buildTool: answer('build.tool'),
    });
  } catch (error) {
    logger.warn('[diag-gateway] serve_spec_defaults derivation_failed', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...FALLBACK };
  }
}
