// TODO: consolidate with api-migration-validation-service/src/services/db/* once
// the shared layer lands. See spec 2026-05-16-database-discovery-packs.
//
// This file is DUPLICATED (and lightly adapted for the discovery-service
// engine set) from `api-migration-validation-service/src/services/db/
// dbAdapterFactory.ts` per D2 of the shaping notes.
//
// Group 3 status: the `'postgres'` arm is wired to the local `PostgresAdapter`
// (Group 3 -- 2026-05-16-database-discovery-packs). The `'sybase'` arm
// remains a throw-by-design until Group 4 wires the HTTP client to the JVM
// sidecar.

import type { DbAdapter, DbConnectionConfig } from './DbAdapter';
import { PostgresAdapter } from './PostgresAdapter';

/**
 * Factory: returns the right `DbAdapter` for the requested engine.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 2 / 3.
 *
 * Each engine arm is filled in by the corresponding pack group:
 *  - `postgres` -- Group 3 (`PostgresAdapter` direct via `pg`) -- WIRED.
 *  - `sybase`   -- Group 4 (`SybaseAdapter` HTTP client to the sidecar)
 *                  -- PENDING.
 */
export function createDbAdapter(config: DbConnectionConfig): DbAdapter {
  switch (config.dbType) {
    case 'postgres':
      return new PostgresAdapter(config);
    case 'sybase':
      throw new Error(
        'SybaseAdapter is not wired yet in discovery-service. ' +
          'Group 4 of spec 2026-05-16-database-discovery-packs fills this arm in.',
      );
    default: {
      // Exhaustive switch -- TypeScript will flag an unhandled engine.
      const _exhaustive: never = config.dbType;
      throw new Error(`Unsupported dbType: ${String(_exhaustive)}`);
    }
  }
}
