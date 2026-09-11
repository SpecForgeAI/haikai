import { DbAdapter } from './DbAdapter';
import { PostgresAdapter } from './PostgresAdapter';
import { SybaseAdapter } from './SybaseAdapter';
import type { DbConnectionConfig } from '../../types/db';

/**
 * Factory: returns the right `DbAdapter` for the requested engine.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 *
 * Spec follow-up (2026-05-17): Sybase now returns a real adapter that
 * proxies through the `sybase-discovery-sidecar` JVM service for all JDBC
 * calls -- replacing the previous throwing stub. Future engines (Oracle,
 * MSSQL, MySQL) land here as additional `case` arms.
 */
export function createDbAdapter(config: DbConnectionConfig): DbAdapter {
  switch (config.dbType) {
    case 'postgres':
      return new PostgresAdapter(config);
    case 'sybase':
      return new SybaseAdapter(config);
    case 'mssql':
      // SQL Server 16 -> PostgreSQL 18 pair programme: the adapter lands in
      // Spec 3. The vocabulary is open (routes accept the value); the
      // runtime refuses loudly until then.
      throw new Error("dbType 'mssql' is recognised but its adapter is not built yet (pair programme Spec 3).");
    default: {
      // Exhaustive switch -- TypeScript will flag an unhandled engine.
      const _exhaustive: never = config.dbType;
      throw new Error(`Unsupported dbType: ${String(_exhaustive)}`);
    }
  }
}
