package com.example.schemaapply;

import java.io.File;
import java.nio.file.Paths;
import java.sql.Connection;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.sql.DataSource;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.ExitCodeGenerator;
import org.springframework.stereotype.Component;

import com.example.schemaapply.trace.HaikaiTrace;

import liquibase.Contexts;
import liquibase.LabelExpression;
import liquibase.Liquibase;
import liquibase.database.Database;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.ClassLoaderResourceAccessor;
import liquibase.resource.DirectoryResourceAccessor;
import liquibase.resource.ResourceAccessor;

/**
 * Applies the generated pack's Liquibase changelog to the target datasource as
 * the app boots, self-scoring the apply as {@code EXEC.SCHEMA.*} predicates and
 * carrying the verdict out as the process exit code.
 *
 * <p>Generic by construction: it drives Liquibase against whatever changelog it
 * is pointed at. Every source/target engine specific (type mappings, dialect
 * rewrites, phase ordering) is baked into the pack content by the generator —
 * this runner never names an engine.</p>
 */
@Component
public class SchemaApplyRunner implements ApplicationRunner, ExitCodeGenerator {

    private static final String STAGE = "EXEC";

    // Constructed per instance so the tracer reads the current trace tier (the
    // test seam re-resolves the tier before constructing the runner).
    private final HaikaiTrace.Tracer trace = HaikaiTrace.forService("schema-apply");

    private final DataSource dataSource;
    private final SchemaApplyProperties props;

    private int exitCode = 0;

    public SchemaApplyRunner(DataSource dataSource, SchemaApplyProperties props) {
        this.dataSource = dataSource;
        this.props = props;
    }

    @Override
    public void run(ApplicationArguments args) {
        HaikaiTrace.Corr corr = HaikaiTrace.Corr.of()
            .run(props.getCorr().getRun())
            .project(props.getCorr().getProject())
            .arch(props.getCorr().getArch());

        Map<String, Object> config = new LinkedHashMap<>();
        config.put("git_sha", gitSha());
        config.put("db_creds_present", credsPresent());
        config.put("changelog", props.getChangelog());
        config.put("contexts", contextsLabel());
        config.put("pack_root_present", !props.getPackRoot().isBlank());
        trace.configHeader(config, corr);

        trace.stageStart(STAGE, corr);
        try {
            ApplyResult result = apply(corr);
            boolean clean = result.remaining == 0;
            trace.predicate(
                "EXEC.SCHEMA.01",
                "schema changelog applied",
                clean,
                "0 unrun changesets remain for contexts=" + contextsLabel(),
                result.applied + " changeset(s) applied, " + result.remaining + " unrun remaining",
                corr);
            trace.predicate(
                "EXEC.SCHEMA.02",
                "requested contexts fully applied",
                clean,
                "remaining=0",
                "remaining=" + result.remaining,
                corr);
            this.exitCode = clean ? 0 : 1;
        } catch (Exception ex) {
            String detail = ex.getClass().getSimpleName()
                + (ex.getMessage() != null ? ": " + ex.getMessage() : "");
            trace.predicate(
                "EXEC.SCHEMA.01",
                "schema changelog applied",
                false,
                "changelog applies cleanly against the target",
                "apply FAILED — " + detail,
                corr);
            trace.fail("schema apply FAILED — " + detail, corr);
            this.exitCode = 1;
        } finally {
            trace.stageEnd(STAGE, corr);
        }
    }

    @Override
    public int getExitCode() {
        return exitCode;
    }

    // -----------------------------------------------------------------------
    // Apply
    // -----------------------------------------------------------------------

    private ApplyResult apply(HaikaiTrace.Corr corr) throws Exception {
        Contexts contexts = props.getContexts().isBlank()
            ? new Contexts()
            : new Contexts(props.getContexts());
        LabelExpression labels = new LabelExpression();
        ResourceAccessor accessor = buildResourceAccessor();

        // The Liquibase instance owns the Database, which owns the JDBC
        // connection; closing it (try-with-resources) closes all three exactly
        // once. A one-shot apply, so returning one pooled connection is fine.
        Connection connection = dataSource.getConnection();
        Database database = DatabaseFactory.getInstance()
            .findCorrectDatabaseImplementation(new JdbcConnection(connection));
        try (Liquibase liquibase = new Liquibase(props.getChangelog(), accessor, database)) {
            int pending = liquibase.listUnrunChangeSets(contexts, labels).size();
            trace.step(
                "applying schema changelog — " + pending + " pending changeset(s), contexts="
                    + contextsLabel(),
                corr);
            liquibase.update(contexts, labels);
            int remaining = liquibase.listUnrunChangeSets(contexts, labels).size();
            int applied = pending - remaining;
            trace.ok(
                "schema apply COMPLETED — " + applied + " changeset(s) applied, " + remaining
                    + " remaining",
                corr);
            return new ApplyResult(applied, remaining);
        }
    }

    private ResourceAccessor buildResourceAccessor() throws Exception {
        if (props.getPackRoot().isBlank()) {
            // Changelog is on the classpath (tests, or a bundled changelog).
            return new ClassLoaderResourceAccessor();
        }
        return new DirectoryResourceAccessor(new File(props.getPackRoot()));
    }

    private String contextsLabel() {
        return props.getContexts().isBlank() ? "(all)" : props.getContexts();
    }

    private boolean credsPresent() {
        String user = System.getenv("SCHEMA_APPLY_DB_USER");
        return user != null && !user.isBlank();
    }

    private String gitSha() {
        String sha = System.getenv("HAIKAI_GIT_SHA");
        if (sha == null || sha.isBlank()) {
            sha = System.getenv("GIT_SHA");
        }
        return (sha == null || sha.isBlank()) ? "unknown" : sha.trim();
    }

    /** Outcome of one apply: how many changesets ran, and how many remain unrun. */
    static final class ApplyResult {
        final int applied;
        final int remaining;

        ApplyResult(int applied, int remaining) {
            this.applied = applied;
            this.remaining = remaining;
        }
    }

    // Retained for symmetry with future callers that pass an absolute changelog
    // path; currently unused but documents the intended resolution.
    @SuppressWarnings("unused")
    private static String toAbsolute(String packRoot, String changelog) {
        return Paths.get(packRoot, changelog).toString();
    }
}
