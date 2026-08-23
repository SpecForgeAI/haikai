/**
 * Live stored-object source harvest for the Sybase engine pack
 * (2026-08-23, Oracle Nine item 1).
 *
 * The repo can LIE about procs: duplicate divergent bodies in-tree and
 * hand-deployed live-only variants. The LIVE catalog is what production
 * executes, so the DB scan pulls every proc/function/trigger body from
 * `sysobjects` + `syscomments` (read-only SELECT via the sidecar''s guarded
 * /query endpoint — no sidecar changes needed) and stores the reassembled
 * sources on the run. The CODE scan later merges them with the repo harvest
 * (live wins; loud drift findings).
 */

import { callSidecarQuery, type SidecarCredentials } from './sybaseSidecarClient';
import type { LiveProcSource } from '../../../scl/sqlProcHarvester';

/** syscomments stores bodies in ordered 255-char segments; 20k rows covers
 *  hundreds of procs with headroom. */
const MAX_SOURCE_ROWS = 20000;

const SOURCE_SQL =
  "SELECT o.name AS obj_name, o.type AS obj_type, c.colid AS colid, c.text AS body_text " +
  "FROM sysobjects o JOIN syscomments c ON o.id = c.id " +
  "WHERE o.type IN ('P', 'F', 'TR') " +
  "ORDER BY o.name, o.type, c.colid";

/**
 * Harvest every stored proc/function/trigger source from the live catalog.
 * Throws on sidecar/query failure — the CALLER (orchestrator) soft-fails
 * with a warning finding; a missing harvest must be loud, never silent.
 */
export async function harvestLiveProcSources(
  creds: SidecarCredentials,
  queryTimeoutSeconds: number,
): Promise<LiveProcSource[]> {
  const r = await callSidecarQuery(creds, {
    sql: SOURCE_SQL,
    queryTimeoutSeconds,
    maxRows: MAX_SOURCE_ROWS,
  });
  const pieces = new Map<string, { objType: string; parts: string[] }>();
  const order: string[] = [];
  for (const row of r.rows ?? []) {
    const rec = row as Record<string, unknown>;
    const name = String(rec.obj_name ?? '').trim();
    if (!name) continue;
    const objType = String(rec.obj_type ?? '').trim();
    const key = `${name}\u0000${objType}`;
    let entry = pieces.get(key);
    if (!entry) {
      entry = { objType, parts: [] };
      pieces.set(key, entry);
      order.push(key);
    }
    entry.parts.push(String(rec.body_text ?? ''));
  }
  return order.map((key) => {
    const name = key.split('\u0000')[0];
    const entry = pieces.get(key) as { objType: string; parts: string[] };
    return { name, objType: entry.objType, text: entry.parts.join('') };
  });
}
