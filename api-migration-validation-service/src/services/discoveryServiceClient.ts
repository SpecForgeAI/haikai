import axios, { AxiosInstance, AxiosError } from 'axios';
import { DISCOVERY_SERVICE_BASE_URL } from '../config';

/**
 * Lightweight HTTP client for discovery-service. Used by Workstream B's
 * `get_operation_payload_context` LLM tool to fetch repo-relative source
 * files from a discovery run's cached clone.
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
 * -- Task Group 8.
 *
 * URL shape (matches discovery-service routes/source.ts and routes/index.ts):
 *
 *   GET /discovery/projects/:projectId/architectures/:architectureId/runs/:runId/source/<repo-path>
 *
 * Outcomes the caller cares about (the tool encodes each as a typed return
 * shape rather than throwing):
 *
 *   - 200 OK            -> `{ kind: 'ok', content }`
 *   - 410 Gone          -> `{ kind: 'evicted' }`     (W-17 fallback path)
 *   - 404 Not Found     -> `{ kind: 'not_found' }`   (FQN resolved to a path
 *                          that does not exist in the cached clone)
 *   - Any other status  -> `{ kind: 'error', status, message }`
 *
 * No retries; the caller decides whether to swallow the failure (graceful
 * "DTO source unavailable" string) or surface it as a structured warning.
 */

export type FetchSourceResult =
  | { kind: 'ok'; content: string }
  | { kind: 'evicted' }
  | { kind: 'not_found' }
  | { kind: 'error'; status: number | null; message: string };

export interface DiscoveryServiceClient {
  fetchSourceFile(args: {
    projectId: string;
    architectureId: string;
    runId: string;
    repoPath: string;
  }): Promise<FetchSourceResult>;
}

class DefaultDiscoveryServiceClient implements DiscoveryServiceClient {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: DISCOVERY_SERVICE_BASE_URL,
      timeout: 15000,
      headers: {
        Accept: 'text/plain, application/json',
      },
      // The source endpoint returns 4xx/5xx via structured JSON bodies. We
      // examine them ourselves rather than letting axios throw, so the
      // transformer below relaxes the default 2xx-only validator.
      validateStatus: () => true,
    });
  }

  async fetchSourceFile(args: {
    projectId: string;
    architectureId: string;
    runId: string;
    repoPath: string;
  }): Promise<FetchSourceResult> {
    // The repo-relative path may contain `/` segments; we DO NOT
    // encodeURIComponent the path-as-a-whole because that would also
    // escape the legitimate `/` separators. Each segment is encoded
    // individually so spaces / non-ASCII chars survive the round trip.
    const safeSegments = args.repoPath.split('/').map((seg) => encodeURIComponent(seg));
    const safePath = safeSegments.join('/');
    const url =
      `/discovery/projects/${args.projectId}/architectures/${args.architectureId}` +
      `/runs/${args.runId}/source/${safePath}`;

    try {
      const res = await this.client.get<unknown>(url, {
        responseType: 'text',
        // We accept any status code via validateStatus above.
        transformResponse: [(body: unknown) => body],
      });
      const status = res.status;
      const body = res.data;

      if (status === 200) {
        return { kind: 'ok', content: typeof body === 'string' ? body : String(body) };
      }
      if (status === 410) {
        return { kind: 'evicted' };
      }
      if (status === 404) {
        return { kind: 'not_found' };
      }
      const msg = typeof body === 'string' ? body.slice(0, 200) : `HTTP ${status}`;
      return { kind: 'error', status, message: msg };
    } catch (err) {
      // Transport failure (no HTTP response at all -- e.g. DNS, connection
      // refused). Surface as a structured error so the caller can decide
      // how to fall back.
      const axiosErr = err as AxiosError;
      const status = axiosErr.response?.status ?? null;
      const msg = axiosErr.message || 'discovery-service request failed';
      return { kind: 'error', status, message: msg };
    }
  }
}

export const discoveryServiceClient: DiscoveryServiceClient =
  new DefaultDiscoveryServiceClient();
