/**
 * coreTechPersistenceCheck -- validates a Service's "Core Tech" when the
 * service's parent application component is set to "Persistence Tier".
 *
 * Spec 2026-06-06: Persistence-Tier Core Tech expects a DATABASE scan pack.
 * Discovery can scan PostgreSQL and Sybase databases -- those are the only
 * registered database packs (discovery-service `databasePackFactory.ts`
 * registers exactly `postgres` and `sybase`). The actual scan engine is chosen
 * by the user in the subsequent scan modal; this check is MESSAGE-ONLY -- it
 * gives inline feedback while the Core Tech is being entered:
 *
 *   - PostgreSQL / Sybase                  -> recognised database pack (ok)
 *   - another database (Oracle, MySQL, ..) -> no scan pack available for it
 *   - a code-related tech (resolves to a   -> the parent component tier is wrong
 *     language / framework pack)              for a code pack
 *
 * Pure, DOM-free, and unit-tested in `coreTechPersistenceCheck.test.ts`. The
 * Persistence-Tier gate itself lives at the call site (GridCell derives the
 * parent tier via `deriveServiceTier`); this helper only classifies the text
 * once the caller has already established the parent is Persistence Tier.
 */

export type PersistenceCoreTechStatus = 'ok' | 'unsupported-db' | 'code-pack' | 'none';

export interface PersistenceCoreTechCheck {
  status: PersistenceCoreTechStatus;
  /** Canonical database name for 'ok' and 'unsupported-db'; undefined otherwise. */
  database?: string;
  /** User-facing message; null only for 'none'. */
  message: string | null;
}

interface DatabaseEntry {
  canonical: string;
  /** Lowercase, word-bounded match tokens. */
  aliases: string[];
}

/**
 * Databases discovery can actually scan -- MUST stay in lockstep with the
 * discovery-service database pack registry (`databasePackFactory.ts`, which
 * registers `postgres` and `sybase`). Aliases are lowercase.
 */
const SUPPORTED_DATABASES: DatabaseEntry[] = [
  { canonical: 'PostgreSQL', aliases: ['postgresql', 'postgres', 'postgre', 'pg'] },
  { canonical: 'Sybase', aliases: ['sybase', 'sap ase', 'sybase ase', 'sybase iq', 'adaptive server'] },
];

/**
 * Other databases we recognise by name but have NO scan pack for. Used only to
 * produce a precise "no database scan pack available for X" message; the list
 * is best-effort and need not be exhaustive.
 */
const OTHER_DATABASES: DatabaseEntry[] = [
  { canonical: 'Oracle', aliases: ['oracle', 'pl/sql', 'plsql'] },
  { canonical: 'MySQL', aliases: ['mysql'] },
  { canonical: 'MariaDB', aliases: ['mariadb'] },
  { canonical: 'SQL Server', aliases: ['sql server', 'sqlserver', 'mssql', 'microsoft sql server', 't-sql', 'tsql'] },
  { canonical: 'MongoDB', aliases: ['mongodb', 'mongo'] },
  { canonical: 'Db2', aliases: ['db2'] },
  { canonical: 'SQLite', aliases: ['sqlite'] },
  { canonical: 'Cassandra', aliases: ['cassandra'] },
  { canonical: 'Snowflake', aliases: ['snowflake'] },
  { canonical: 'Amazon Redshift', aliases: ['redshift'] },
  { canonical: 'CockroachDB', aliases: ['cockroachdb', 'cockroach'] },
  { canonical: 'IBM Informix', aliases: ['informix'] },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-bounded, case-insensitive match of any alias against the (already
 * lowercased) text. Word boundaries (vs. a naive `includes`) prevent false hits
 * such as the Sybase token "ase" matching inside the word "database".
 */
function matchDatabase(lowerText: string, list: DatabaseEntry[]): string | null {
  for (const db of list) {
    for (const alias of db.aliases) {
      const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(alias)}([^a-z0-9]|$)`);
      if (re.test(lowerText)) {
        return db.canonical;
      }
    }
  }
  return null;
}

/**
 * Classify a Persistence-Tier service's Core Tech.
 *
 * @param coreTech    The raw `core_tech` free text (e.g. "PostgreSQL 16").
 * @param hasCodePack Whether the Core Tech resolved to a language or framework
 *                    pack (from the cell's resolved view). A recognised database
 *                    name takes precedence over this -- a Persistence-Tier
 *                    service that names a database is judged on whether we can
 *                    scan that database, regardless of any spurious code-pack
 *                    resolution.
 */
export function checkPersistenceCoreTech(
  coreTech: string | null | undefined,
  hasCodePack: boolean,
): PersistenceCoreTechCheck {
  const lower = (coreTech ?? '').trim().toLowerCase();

  const supported = matchDatabase(lower, SUPPORTED_DATABASES);
  if (supported) {
    return {
      status: 'ok',
      database: supported,
      message: `${supported} database scan pack available — you'll choose the scan type next.`,
    };
  }

  const other = matchDatabase(lower, OTHER_DATABASES);
  if (other) {
    return {
      status: 'unsupported-db',
      database: other,
      message: `No database scan pack available for ${other}.`,
    };
  }

  // Not a recognised database. If the text resolved to a code pack, the parent
  // component's tier is wrong for it.
  if (hasCodePack) {
    return {
      status: 'code-pack',
      message:
        "This is a code related pack yet the parent application component is set to 'Persistence Tier' — please change.",
    };
  }

  return { status: 'none', message: null };
}
