/**
 * AMS client for the routine catalog + proc behaviour data plane
 * (Stored Proc & Function Behaviour Program, Specs 1 + 3). Kept SEPARATE
 * from `archModelClient` (the API behaviour surface) so the proc path has no
 * dependency on the API session model. Snake_case wire, verbatim.
 */

import axios, { AxiosError, AxiosInstance } from 'axios';
import { ARCHITECTURE_MODEL_SERVICE_BASE_URL } from '../config';
import { redactLogString } from './redactor';
import type {
  ProcBaselineDto,
  ProcBaselineItemDto,
  ProcCaptureDto,
  ProcCaptureSessionDto,
  ProcDiagnosticDto,
  ProcScenarioDto,
  RoutineCatalogRow,
} from './procCapture/types';

export class ProcBehaviourClientError extends Error {
  public readonly status: number | null;
  public readonly endpoint: string;
  constructor(message: string, endpoint: string, status: number | null) {
    super(message);
    this.name = 'ProcBehaviourClientError';
    this.endpoint = endpoint;
    this.status = status;
  }
}

export interface ProcBehaviourClientSurface {
  listRoutines(projectId: string, architectureId: string, kind?: string): Promise<RoutineCatalogRow[]>;
  getSession(projectId: string, architectureId: string, sessionId: string): Promise<ProcCaptureSessionDto>;
  patchSession(
    projectId: string,
    architectureId: string,
    sessionId: string,
    patch: Partial<ProcCaptureSessionDto>,
  ): Promise<ProcCaptureSessionDto>;
  upsertScenarios(projectId: string, architectureId: string, sessionId: string, scenarios: ProcScenarioDto[]): Promise<ProcScenarioDto[]>;
  listScenarios(projectId: string, architectureId: string, sessionId: string): Promise<ProcScenarioDto[]>;
  createCaptures(projectId: string, architectureId: string, sessionId: string, captures: ProcCaptureDto[]): Promise<ProcCaptureDto[]>;
  listCaptures(projectId: string, architectureId: string, sessionId: string): Promise<ProcCaptureDto[]>;
  createDiagnostics(projectId: string, architectureId: string, sessionId: string, diagnostics: ProcDiagnosticDto[]): Promise<ProcDiagnosticDto[]>;
  listDiagnostics(projectId: string, architectureId: string, sessionId: string): Promise<ProcDiagnosticDto[]>;
  createBaseline(
    projectId: string,
    architectureId: string,
    body: { session_id: string; name: string; kind: 'current' | 'target'; s0_fingerprint_json: Record<string, unknown> | null; items: ProcBaselineItemDto[] },
  ): Promise<ProcBaselineDto>;
  pinBaseline(projectId: string, architectureId: string, baselineId: string): Promise<ProcBaselineDto>;
  getPinnedBaseline(projectId: string, architectureId: string, kind: 'current' | 'target'): Promise<ProcBaselineDto | null>;
  listBaselineItems(projectId: string, architectureId: string, baselineId: string): Promise<ProcBaselineItemDto[]>;
  /** Spec 4: persist one proc parity report (the comparator's snake_case body, verbatim). */
  saveProcParityReport(projectId: string, architectureId: string, report: Record<string, unknown> | object): Promise<{ id: string }>;
}

class ProcBehaviourClient implements ProcBehaviourClientSurface {
  private readonly client: AxiosInstance;

  constructor(baseURL: string = ARCHITECTURE_MODEL_SERVICE_BASE_URL) {
    this.client = axios.create({
      baseURL,
      timeout: 60000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
  }

  private base(projectId: string, architectureId: string): string {
    return `/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}`;
  }

  private fail(err: unknown, endpoint: string, action: string): never {
    const axiosErr = err as AxiosError;
    const status = axiosErr?.response?.status ?? null;
    const body = axiosErr?.response?.data ? redactLogString(JSON.stringify(axiosErr.response.data)).slice(0, 300) : '';
    const message = err instanceof Error ? err.message : String(err);
    throw new ProcBehaviourClientError(
      `Failed to ${action} via AMS${status !== null ? ` (HTTP ${status})` : ''}: ${message}${body ? ` ${body}` : ''}`,
      endpoint,
      status,
    );
  }

  async listRoutines(projectId: string, architectureId: string, kind?: string): Promise<RoutineCatalogRow[]> {
    const endpoint = `${this.base(projectId, architectureId)}/db-routines${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`;
    try {
      const res = await this.client.get<RoutineCatalogRow[]>(endpoint);
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      return this.fail(err, endpoint, 'list routines');
    }
  }

  async getSession(projectId: string, architectureId: string, sessionId: string): Promise<ProcCaptureSessionDto> {
    const endpoint = `${this.base(projectId, architectureId)}/proc-behaviour/capture-sessions/${encodeURIComponent(sessionId)}`;
    try {
      const res = await this.client.get<ProcCaptureSessionDto>(endpoint);
      return res.data;
    } catch (err) {
      return this.fail(err, endpoint, 'get proc capture session');
    }
  }

  async patchSession(
    projectId: string,
    architectureId: string,
    sessionId: string,
    patch: Partial<ProcCaptureSessionDto>,
  ): Promise<ProcCaptureSessionDto> {
    const endpoint = `${this.base(projectId, architectureId)}/proc-behaviour/capture-sessions/${encodeURIComponent(sessionId)}`;
    try {
      const res = await this.client.patch<ProcCaptureSessionDto>(endpoint, patch);
      return res.data;
    } catch (err) {
      return this.fail(err, endpoint, 'patch proc capture session');
    }
  }

  async upsertScenarios(projectId: string, architectureId: string, sessionId: string, scenarios: ProcScenarioDto[]): Promise<ProcScenarioDto[]> {
    const endpoint = `${this.base(projectId, architectureId)}/proc-behaviour/capture-sessions/${encodeURIComponent(sessionId)}/scenarios`;
    try {
      const res = await this.client.post<ProcScenarioDto[]>(endpoint, { scenarios });
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      return this.fail(err, endpoint, 'upsert proc scenarios');
    }
  }

  async listScenarios(projectId: string, architectureId: string, sessionId: string): Promise<ProcScenarioDto[]> {
    const endpoint = `${this.base(projectId, architectureId)}/proc-behaviour/capture-sessions/${encodeURIComponent(sessionId)}/scenarios`;
    try {
      const res = await this.client.get<ProcScenarioDto[]>(endpoint);
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      return this.fail(err, endpoint, 'list proc scenarios');
    }
  }

  async createCaptures(projectId: string, architectureId: string, sessionId: string, captures: ProcCaptureDto[]): Promise<ProcCaptureDto[]> {
    const endpoint = `${this.base(projectId, architectureId)}/proc-behaviour/capture-sessions/${encodeURIComponent(sessionId)}/captures`;
    try {
      const res = await this.client.post<ProcCaptureDto[]>(endpoint, { captures });
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      return this.fail(err, endpoint, 'create proc captures');
    }
  }

  async listCaptures(projectId: string, architectureId: string, sessionId: string): Promise<ProcCaptureDto[]> {
    const endpoint = `${this.base(projectId, architectureId)}/proc-behaviour/capture-sessions/${encodeURIComponent(sessionId)}/captures`;
    try {
      const res = await this.client.get<ProcCaptureDto[]>(endpoint);
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      return this.fail(err, endpoint, 'list proc captures');
    }
  }

  async createDiagnostics(projectId: string, architectureId: string, sessionId: string, diagnostics: ProcDiagnosticDto[]): Promise<ProcDiagnosticDto[]> {
    const endpoint = `${this.base(projectId, architectureId)}/proc-behaviour/capture-sessions/${encodeURIComponent(sessionId)}/diagnostics`;
    try {
      const res = await this.client.post<ProcDiagnosticDto[]>(endpoint, { diagnostics });
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      return this.fail(err, endpoint, 'create proc diagnostics');
    }
  }

  async listDiagnostics(projectId: string, architectureId: string, sessionId: string): Promise<ProcDiagnosticDto[]> {
    const endpoint = `${this.base(projectId, architectureId)}/proc-behaviour/capture-sessions/${encodeURIComponent(sessionId)}/diagnostics`;
    try {
      const res = await this.client.get<ProcDiagnosticDto[]>(endpoint);
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      return this.fail(err, endpoint, 'list proc diagnostics');
    }
  }

  async createBaseline(
    projectId: string,
    architectureId: string,
    body: { session_id: string; name: string; kind: 'current' | 'target'; s0_fingerprint_json: Record<string, unknown> | null; items: ProcBaselineItemDto[] },
  ): Promise<ProcBaselineDto> {
    const endpoint = `${this.base(projectId, architectureId)}/proc-behaviour/baselines`;
    try {
      const res = await this.client.post<ProcBaselineDto>(endpoint, body);
      return res.data;
    } catch (err) {
      return this.fail(err, endpoint, 'create proc baseline');
    }
  }

  async pinBaseline(projectId: string, architectureId: string, baselineId: string): Promise<ProcBaselineDto> {
    const endpoint = `${this.base(projectId, architectureId)}/proc-behaviour/baselines/${encodeURIComponent(baselineId)}/pin`;
    try {
      const res = await this.client.post<ProcBaselineDto>(endpoint, {});
      return res.data;
    } catch (err) {
      return this.fail(err, endpoint, 'pin proc baseline');
    }
  }

  async getPinnedBaseline(projectId: string, architectureId: string, kind: 'current' | 'target'): Promise<ProcBaselineDto | null> {
    const endpoint = `${this.base(projectId, architectureId)}/proc-behaviour/baselines/pinned?kind=${encodeURIComponent(kind)}`;
    try {
      const res = await this.client.get<ProcBaselineDto>(endpoint);
      return res.data ?? null;
    } catch (err) {
      const status = (err as AxiosError)?.response?.status ?? null;
      if (status === 404) return null;
      return this.fail(err, endpoint, 'get pinned proc baseline');
    }
  }

  async listBaselineItems(projectId: string, architectureId: string, baselineId: string): Promise<ProcBaselineItemDto[]> {
    const endpoint = `${this.base(projectId, architectureId)}/proc-behaviour/baselines/${encodeURIComponent(baselineId)}/items`;
    try {
      const res = await this.client.get<ProcBaselineItemDto[]>(endpoint);
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      return this.fail(err, endpoint, 'list proc baseline items');
    }
  }

  async saveProcParityReport(projectId: string, architectureId: string, report: Record<string, unknown> | object): Promise<{ id: string }> {
    const endpoint = `${this.base(projectId, architectureId)}/proc-parity-reports`;
    try {
      const res = await this.client.post<{ id: string }>(endpoint, report);
      return res.data;
    } catch (err) {
      return this.fail(err, endpoint, 'save proc parity report');
    }
  }
}

export const procBehaviourClient: ProcBehaviourClientSurface = new ProcBehaviourClient();
export { ProcBehaviourClient };
