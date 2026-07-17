package com.example.schemaapply;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Bound from the {@code schema-apply.*} configuration (see application.yml),
 * which in turn reads the environment. Holds only non-secret apply inputs —
 * the target datasource (including credentials) is Spring's standard
 * {@code spring.datasource.*} DataSource, never mirrored here.
 */
@ConfigurationProperties(prefix = "schema-apply")
public class SchemaApplyProperties {

    /**
     * Filesystem root of the generated pack (the directory containing the
     * {@code liquibase/} folder). When blank, the changelog is resolved from the
     * classpath instead (used by tests and by classpath-bundled changelogs).
     */
    private String packRoot = "";

    /** Master changelog path, relative to {@link #packRoot} (or the classpath). */
    private String changelog = "liquibase/db.changelog-master.xml";

    /**
     * Comma-separated Liquibase contexts. Blank => apply ALL changesets. The
     * pack tags structural DDL {@code context:structural} and FKs/indexes/
     * sequence-reseed {@code context:post-load}, so the phased executor applies
     * {@code structural}, loads data, then applies {@code post-load}.
     */
    private String contexts = "";

    private Corr corr = new Corr();

    public String getPackRoot() {
        return packRoot;
    }

    public void setPackRoot(String packRoot) {
        this.packRoot = packRoot == null ? "" : packRoot;
    }

    public String getChangelog() {
        return changelog;
    }

    public void setChangelog(String changelog) {
        this.changelog = changelog;
    }

    public String getContexts() {
        return contexts;
    }

    public void setContexts(String contexts) {
        this.contexts = contexts == null ? "" : contexts;
    }

    public Corr getCorr() {
        return corr;
    }

    public void setCorr(Corr corr) {
        this.corr = corr;
    }

    /** Workflow-spanning correlation ids stamped onto every trace line. */
    public static class Corr {
        private String run = "";
        private String project = "";
        private String arch = "";

        public String getRun() {
            return run;
        }

        public void setRun(String run) {
            this.run = run;
        }

        public String getProject() {
            return project;
        }

        public void setProject(String project) {
            this.project = project;
        }

        public String getArch() {
            return arch;
        }

        public void setArch(String arch) {
            this.arch = arch;
        }
    }
}
