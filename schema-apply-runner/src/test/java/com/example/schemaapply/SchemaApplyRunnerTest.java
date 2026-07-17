package com.example.schemaapply;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * Behavioural tests for {@link SchemaApplyRunner} against an in-memory H2
 * (PostgreSQL mode) target. Trace is OFF here (default), so these assert the
 * apply outcome + exit code; {@code SchemaApplyTraceTest} covers predicate
 * emission. The live Sybase->PostgreSQL apply of a real generated pack is a
 * work-machine shakedown.
 */
class SchemaApplyRunnerTest {

    private static final String MASTER =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
        + "<databaseChangeLog\n"
        + "    xmlns=\"http://www.liquibase.org/xml/ns/dbchangelog\"\n"
        + "    xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n"
        + "    xsi:schemaLocation=\"http://www.liquibase.org/xml/ns/dbchangelog"
        + " http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-latest.xsd\">\n"
        + "  <changeSet id=\"t-structural\" author=\"test\" context=\"structural\">\n"
        + "    <sql>CREATE TABLE demo (id INT PRIMARY KEY)</sql>\n"
        + "  </changeSet>\n"
        + "  <changeSet id=\"t-post-load\" author=\"test\" context=\"post-load\">\n"
        + "    <sql>CREATE INDEX idx_demo_id ON demo (id)</sql>\n"
        + "  </changeSet>\n"
        + "</databaseChangeLog>\n";

    private static final String MASTER_BROKEN =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
        + "<databaseChangeLog\n"
        + "    xmlns=\"http://www.liquibase.org/xml/ns/dbchangelog\"\n"
        + "    xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n"
        + "    xsi:schemaLocation=\"http://www.liquibase.org/xml/ns/dbchangelog"
        + " http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-latest.xsd\">\n"
        + "  <changeSet id=\"t-broken\" author=\"test\" context=\"structural\">\n"
        + "    <sql>CREATE TABLE demo (id NOTATYPE)</sql>\n"
        + "  </changeSet>\n"
        + "</databaseChangeLog>\n";

    @Test
    void appliesAllChangesetsWhenNoContexts(@TempDir Path packRoot) throws Exception {
        DriverManagerDataSource ds = h2("applyall");
        writeMaster(packRoot, MASTER);
        SchemaApplyRunner runner = new SchemaApplyRunner(ds, props(packRoot, ""));

        runner.run(new DefaultApplicationArguments());

        assertThat(runner.getExitCode()).isZero();
        assertThat(changelogCount(ds)).isEqualTo(2);
        assertThat(tableExists(ds, "DEMO")).isTrue();
    }

    @Test
    void appliesOnlyStructuralContext(@TempDir Path packRoot) throws Exception {
        DriverManagerDataSource ds = h2("structuralonly");
        writeMaster(packRoot, MASTER);
        SchemaApplyRunner runner = new SchemaApplyRunner(ds, props(packRoot, "structural"));

        runner.run(new DefaultApplicationArguments());

        assertThat(runner.getExitCode()).isZero();
        // Only the structural changeset ran; the post-load index did not.
        assertThat(changelogCount(ds)).isEqualTo(1);
        assertThat(tableExists(ds, "DEMO")).isTrue();
    }

    @Test
    void reportsFailureOnBadChangelog(@TempDir Path packRoot) throws Exception {
        DriverManagerDataSource ds = h2("failure");
        writeMaster(packRoot, MASTER_BROKEN);
        SchemaApplyRunner runner = new SchemaApplyRunner(ds, props(packRoot, ""));

        runner.run(new DefaultApplicationArguments());

        assertThat(runner.getExitCode()).isEqualTo(1);
    }

    @Test
    void rerunIsIdempotent(@TempDir Path packRoot) throws Exception {
        DriverManagerDataSource ds = h2("idempotent");
        writeMaster(packRoot, MASTER);

        SchemaApplyRunner first = new SchemaApplyRunner(ds, props(packRoot, ""));
        first.run(new DefaultApplicationArguments());
        assertThat(first.getExitCode()).isZero();
        assertThat(changelogCount(ds)).isEqualTo(2);

        SchemaApplyRunner second = new SchemaApplyRunner(ds, props(packRoot, ""));
        second.run(new DefaultApplicationArguments());
        assertThat(second.getExitCode()).isZero();
        // Nothing new applied on the second pass.
        assertThat(changelogCount(ds)).isEqualTo(2);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private static DriverManagerDataSource h2(String name) {
        DriverManagerDataSource ds = new DriverManagerDataSource();
        ds.setDriverClassName("org.h2.Driver");
        ds.setUrl("jdbc:h2:mem:" + name + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE");
        ds.setUsername("sa");
        ds.setPassword("");
        return ds;
    }

    private static SchemaApplyProperties props(Path packRoot, String contexts) {
        SchemaApplyProperties p = new SchemaApplyProperties();
        p.setPackRoot(packRoot.toString());
        p.setContexts(contexts);
        return p;
    }

    private static void writeMaster(Path packRoot, String xml) throws Exception {
        Path dir = packRoot.resolve("liquibase");
        Files.createDirectories(dir);
        Files.writeString(dir.resolve("db.changelog-master.xml"), xml);
    }

    private static int changelogCount(DriverManagerDataSource ds) throws Exception {
        try (Connection c = ds.getConnection();
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery("SELECT COUNT(*) FROM DATABASECHANGELOG")) {
            rs.next();
            return rs.getInt(1);
        }
    }

    private static boolean tableExists(DriverManagerDataSource ds, String table) throws Exception {
        try (Connection c = ds.getConnection();
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery(
                 "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '" + table + "'")) {
            rs.next();
            return rs.getInt(1) > 0;
        }
    }
}
