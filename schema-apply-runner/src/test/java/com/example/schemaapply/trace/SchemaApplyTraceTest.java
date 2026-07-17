package com.example.schemaapply.trace;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import com.example.schemaapply.SchemaApplyProperties;
import com.example.schemaapply.SchemaApplyRunner;

/**
 * Verifies that a schema apply self-scores as predicates on the shared trace
 * log. Lives in the {@code trace} package so it can flip the trace tier via the
 * package-private {@link HaikaiTrace#resetForTest} seam (the runner's tracer is
 * constructed per instance, so the tier is read when the runner is created —
 * after the reset here).
 */
class SchemaApplyTraceTest {

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
        + "</databaseChangeLog>\n";

    @AfterEach
    void traceOff() {
        HaikaiTrace.resetForTest("off", null);
    }

    @Test
    void emitsSchemaApplyPredicatesAndScorecard(@TempDir Path work) throws Exception {
        Path traceFile = work.resolve("trace.log");
        HaikaiTrace.resetForTest("summary", traceFile.toString());

        Path packRoot = work.resolve("pack");
        Files.createDirectories(packRoot.resolve("liquibase"));
        Files.writeString(packRoot.resolve("liquibase/db.changelog-master.xml"), MASTER);

        DriverManagerDataSource ds = new DriverManagerDataSource();
        ds.setDriverClassName("org.h2.Driver");
        ds.setUrl("jdbc:h2:mem:tracetest;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE");
        ds.setUsername("sa");
        ds.setPassword("");

        SchemaApplyProperties props = new SchemaApplyProperties();
        props.setPackRoot(packRoot.toString());
        props.setContexts("");

        SchemaApplyRunner runner = new SchemaApplyRunner(ds, props);
        runner.run(new DefaultApplicationArguments());

        assertThat(runner.getExitCode()).isZero();

        String log = Files.readString(traceFile);
        assertThat(log).contains("HAIKAI_STAGE_START");
        assertThat(log).contains("HAIKAI_PREDICATE");
        assertThat(log).contains("EXEC.SCHEMA.01");
        assertThat(log).contains("\"verdict\":\"pass\"");
        assertThat(log).contains("HAIKAI_SCORECARD");
        assertThat(log).contains("\"stage\":\"EXEC\"");
    }
}
