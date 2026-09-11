package com.example.dbsidecar.service;

import com.example.dbsidecar.model.IntrospectionResponse;
import com.example.dbsidecar.model.SidecarEngine;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;

/**
 * The per-engine catalog layer (SQL Server pair programme, SPEC-1 §1.3).
 *
 * <p>Everything ABOVE this interface is engine-neutral: {@link DbQueryService}
 * opens the connection, clamps the timeouts, masks passwords and shapes the
 * HTTP envelope. Everything BELOW it is engine knowledge -- the system-catalog
 * SQL, the status-bit decoders, the body reassembly. {@link SybaseCatalog}
 * carries the Sybase ASE reads VERBATIM as they were before the multi-engine
 * split; {@link MssqlCatalog} carries the SQL Server {@code sys.*} reads.</p>
 *
 * <p>An implementation returns a POPULATED {@link IntrospectionResponse} with
 * {@code ok=true}; it never catches its own connection failure (the caller owns
 * the error envelope) but it MAY null-out an individual enrichment group that
 * an older engine build does not expose -- that version tolerance is part of
 * the catalog's job, and the {@code capabilities[]} list is how the group's
 * availability reaches discovery.</p>
 */
public interface EngineCatalog {

    /** The engine this catalog reads. */
    SidecarEngine engine();

    /**
     * Engine version string ({@code @@version} on ASE,
     * {@code SERVERPROPERTY('ProductVersion')} on SQL Server). Best-effort:
     * any failure null-outs rather than aborting, because the version is
     * evidence, not a hard dependency.
     */
    String readServerVersion(Connection conn);

    /**
     * Engine edition string ({@code SERVERPROPERTY('Edition')} on SQL Server).
     * Null on engines that have no such concept (ASE).
     */
    default String readServerEdition(final Connection conn) {
        return null;
    }

    /**
     * The {@code /test-connection} probe: the engine's own identity read, run
     * on a freshly opened connection. UNLIKE {@link #readServerVersion} this
     * PROPAGATES its failure -- a login that cannot read the server identity is
     * not a usable connection, and {@code /test-connection} exists to say so.
     */
    ServerIdentity probe(Connection conn) throws SQLException;

    /** Server version + edition as read by {@link #probe}. */
    record ServerIdentity(String version, String edition) {
    }

    /**
     * The full introspection batch on an already-open connection. Returns
     * {@code ok=true} with every section populated.
     */
    IntrospectionResponse introspect(
            Connection conn,
            List<String> includeSchemas,
            List<String> includeTables,
            int queryTimeoutSeconds
    ) throws SQLException;

    // ------------------------------------------------------------------
    // Shared pure helpers (engine-neutral; used by every catalog)
    // ------------------------------------------------------------------

    /**
     * Cap on snippet body lengths (procedure / view / trigger) for the Sybase
     * {@code syscomments} reassembly path. SQL Server carries the full
     * {@code sys.sql_modules.definition} (wire contract §2) and does NOT trim.
     */
    int MAX_SNIPPET_CHARS = 4096;

    /**
     * Append a capability key to the list if not already present (the same
     * group key can be advertised from more than one read path -- e.g.
     * {@code collation} from both the per-column read and the DB-level read).
     */
    static void addCapability(final List<String> capabilities, final String key) {
        if (capabilities != null && !capabilities.contains(key)) {
            capabilities.add(key);
        }
    }

    /**
     * Quote a Sybase identifier with brackets, escaping any embedded closing
     * bracket. Used only for the internal {@code MAX(col)} scan whose
     * identifiers come from the ASE catalog (not caller input).
     */
    static String quoteIdent(final String ident) {
        if (ident == null) {
            return "[]";
        }
        return "[" + ident.replace("]", "]]") + "]";
    }

    /**
     * Returns true if the given name passes the include filter (or the
     * filter is empty / null, which means "no filter").
     */
    static boolean matchesSchemaFilter(final String name, final List<String> include) {
        if (include == null || include.isEmpty()) {
            return true;
        }
        for (final String s : include) {
            if (s != null && s.equalsIgnoreCase(name)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Like {@link #matchesSchemaFilter} but for table names. Empty filter
     * means "no filter".
     */
    static boolean matchesTableFilter(final String name, final List<String> include) {
        if (include == null || include.isEmpty()) {
            return true;
        }
        for (final String t : include) {
            if (t != null && t.equalsIgnoreCase(name)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Trim a snippet to {@link #MAX_SNIPPET_CHARS}.
     */
    static String trimSnippet(final String body) {
        if (body == null) {
            return "";
        }
        if (body.length() <= MAX_SNIPPET_CHARS) {
            return body;
        }
        return body.substring(0, MAX_SNIPPET_CHARS) + "...[truncated]";
    }
}
