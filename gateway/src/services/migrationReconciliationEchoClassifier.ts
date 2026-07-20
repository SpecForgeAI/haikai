/**
 * Data-echo attribution for API reconcile breaks (Residual 1, 2026-07-20).
 *
 * When the operator BREAK-GLASSED past the DB-plane data-parity gate, the
 * Service plane's API reconcile runs under KNOWN data divergence — a break can
 * be a service-code defect OR an echo of the divergent data. Naively mixing
 * them burns the second oracle to use the first one's failure, so every break
 * is deterministically PARTITIONED:
 *
 *   - `possible_data_echo` — the break's endpoint carries committed
 *     data-effect references that mention one of the divergent tables frozen
 *     at override time. Honest label: unreadable-until-parity-is-fixed.
 *   - `unexplained`        — no such reference. FULL oracle authority: treat
 *     as a real defect.
 *
 * Deterministic and conservative by construction: the divergent-table set is
 * the one FROZEN on the run's decision log at the moment of override (not
 * whatever parity looks like later); matching is textual containment over the
 * endpoint's OWN committed data-effect material (effect metadata +
 * data-entity-point refs — single-sourced from discovery, never invented
 * here); and an endpoint with NO data-effect metadata classifies
 * `unexplained` — missing metadata must never hide a real defect behind an
 * "echo" label.
 */
import { getConfig } from '../config';
import { pathMatchesTemplate } from './migrationCodeSpecCarriage';

/**
 * The LATEST `data_parity_override` entry's frozen divergent tables, or null
 * when the run never break-glassed (clean-context reconcile — no
 * classification applies).
 */
export function extractOverrideDivergentTables(
  decisionLog: Array<Record<string, unknown>> | null | undefined
): { at: string | null; tables: string[] } | null {
  const entries = (decisionLog ?? []).filter(
    (e) => e['type'] === 'data_parity_override'
  );
  if (entries.length === 0) return null;
  const latest = entries[entries.length - 1];
  const rawTables = latest['divergent_tables'];
  const tables = Array.isArray(rawTables)
    ? rawTables.filter((t): t is string => typeof t === 'string')
    : [];
  const at = typeof latest['at'] === 'string' ? (latest['at'] as string) : null;
  return { at, tables };
}

/** The whole committed endpoint↔data-effect surface (UNfiltered). */
export interface EchoFacts {
  endpoints: Array<{ id: string; verb: string | null; path: string | null }>;
  effects: Array<{ endpointId: string; material: string }>;
}

export type FetchEchoFactsFn = (
  projectId: string,
  currentArchitectureId: string
) => Promise<EchoFacts>;

/**
 * One AMS full-model read, UNfiltered (the classifier must see every
 * endpoint's data effects — the carriage's facts reader scopes to a story's
 * endpoint ids, which is the wrong lens here). Same source of truth.
 */
export const defaultFetchEchoFacts: FetchEchoFactsFn = async (
  projectId,
  currentArchitectureId
) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(currentArchitectureId)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`AMS full-model read failed: HTTP ${response.status}`);
  }
  const model = (await response.json()) as {
    metaModel?: {
      entities?: {
        endpoints?: Array<{
          id?: string;
          operation_verb?: string | null;
          path_or_address?: string | null;
        }>;
      };
      relationships?: {
        endpoint_data_effects?: Array<{
          endpoint_id?: string;
          path_metadata_json?: unknown;
          data_entity_point_id?: string;
        }>;
      };
    };
  };
  const endpoints = (model.metaModel?.entities?.endpoints ?? [])
    .filter((e): e is { id: string } & typeof e => typeof e.id === 'string')
    .map((e) => ({
      id: e.id,
      verb: e.operation_verb ?? null,
      path: e.path_or_address ?? null,
    }));
  const effects = (model.metaModel?.relationships?.endpoint_data_effects ?? [])
    .filter((r) => typeof r.endpoint_id === 'string')
    .map((r) => ({
      endpointId: r.endpoint_id as string,
      material:
        `${r.data_entity_point_id ?? ''} ` +
        `${r.path_metadata_json != null ? JSON.stringify(r.path_metadata_json) : ''}`,
    }));
  return { endpoints, effects };
};

export interface EchoVerdict {
  classification: 'possible_data_echo' | 'unexplained';
  /** The divergent tables the endpoint's data effects reference (echo only). */
  tables: string[];
}

/**
 * Build the per-break classifier from the committed surface + the frozen
 * divergent-table set. Returns a pure `(method, path) => EchoVerdict`.
 */
export function buildEchoClassifier(
  facts: EchoFacts,
  divergentTables: string[]
): (method: string | null, path: string | null) => EchoVerdict {
  const materialByEndpoint = new Map<string, string>();
  for (const effect of facts.effects) {
    const prior = materialByEndpoint.get(effect.endpointId) ?? '';
    materialByEndpoint.set(
      effect.endpointId,
      `${prior} ${effect.material}`.toLowerCase()
    );
  }

  // Each divergent table matches on its qualified name AND its bare name —
  // effect metadata is not consistent about schema-qualification.
  const needles = divergentTables.map((qualified) => {
    const lower = qualified.toLowerCase();
    const bare = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : lower;
    return { qualified: lower, bare };
  });

  return (method, path) => {
    if (!path || needles.length === 0) {
      return { classification: 'unexplained', tables: [] };
    }
    const verb = (method ?? '').toUpperCase();
    const endpoint = facts.endpoints.find(
      (e) =>
        (e.verb ?? '').toUpperCase() === verb &&
        e.path !== null &&
        (e.path === path || pathMatchesTemplate(path, e.path))
    );
    if (!endpoint) return { classification: 'unexplained', tables: [] };
    const material = materialByEndpoint.get(endpoint.id);
    if (!material) return { classification: 'unexplained', tables: [] };
    const hit = needles
      .filter((n) => material.includes(n.qualified) || material.includes(n.bare))
      .map((n) => n.qualified);
    return hit.length > 0
      ? { classification: 'possible_data_echo', tables: hit }
      : { classification: 'unexplained', tables: [] };
  };
}
