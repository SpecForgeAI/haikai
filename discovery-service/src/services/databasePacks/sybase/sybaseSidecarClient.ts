/**
 * Sybase-flavoured facade over the multi-engine DB discovery sidecar client.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 4 (this module WAS
 * the whole client). SQL Server 16 -> PostgreSQL 18 pair programme, Spec 2
 * (2026-09-11): the transport, the wire types and the SQL guard moved up one
 * level to `../sidecarClient.ts` so every engine pack shares ONE client and
 * every request carries the `engine` discriminator (WIRE-CONTRACT v2 §1).
 *
 * What is left here is deliberately thin: the same four exported call
 * helpers, each pinning `engine: 'sybase'` on the credentials before it
 * delegates. Nothing Sybase-specific about the WIRE lives here any more --
 * the engine value is the only thing this file adds. Every existing importer
 * (the pack, the profiler, the proc harvest, the introspection mapper, the
 * six enrichment test suites) keeps its import path and its behaviour.
 *
 * Base-URL resolution, the readonly-SELECT guard, and the full
 * `SidecarIntrospectionResponse` wire shape are re-exported verbatim from
 * the shared module.
 */

import {
  callSidecarIntrospect as callSidecarIntrospectEngine,
  callSidecarQuery as callSidecarQueryEngine,
  callSidecarTestConnection as callSidecarTestConnectionEngine,
  type SidecarCredentials,
  type SidecarIntrospectionResponse,
  type SidecarQueryResponse,
  type SidecarTestConnectionResponse,
} from '../sidecarClient';

export {
  resolveSidecarBaseUrl,
  type SidecarCredentials,
  type SidecarIntrospectionResponse,
  type SidecarQueryResponse,
  type SidecarTestConnectionResponse,
  type SybaseDriverChoice,
} from '../sidecarClient';

/** Pin the Sybase engine on a credential bundle for every outbound call. */
function asSybase(creds: SidecarCredentials): SidecarCredentials {
  return creds.engine === 'sybase' ? creds : { ...creds, engine: 'sybase' };
}

/**
 * Call the sidecar's {@code /test-connection} endpoint on the Sybase engine.
 * Returns the sidecar's response verbatim.
 */
export async function callSidecarTestConnection(
  creds: SidecarCredentials,
): Promise<SidecarTestConnectionResponse> {
  return callSidecarTestConnectionEngine(asSybase(creds));
}

/**
 * Call the sidecar's {@code /introspect} endpoint on the Sybase engine. The
 * sidecar composes the actual catalog queries against Sybase
 * {@code sysusers}, {@code sysobjects}, {@code syscolumns}, etc.; we just
 * supply filters.
 */
export async function callSidecarIntrospect(
  creds: SidecarCredentials,
  filters: {
    includeSchemas?: string[] | null;
    includeTables?: string[] | null;
    queryTimeoutSeconds?: number;
  },
): Promise<SidecarIntrospectionResponse> {
  return callSidecarIntrospectEngine(asSybase(creds), filters);
}

/**
 * Call the sidecar's {@code /query} endpoint on the Sybase engine. The SQL is
 * guarded client-side BEFORE the HTTP request (inside the shared client) --
 * the first layer of the spec-mandated three-layer SELECT-only enforcement.
 */
export async function callSidecarQuery(
  creds: SidecarCredentials,
  query: { sql: string; queryTimeoutSeconds?: number; maxRows?: number },
): Promise<SidecarQueryResponse> {
  return callSidecarQueryEngine(asSybase(creds), query);
}
