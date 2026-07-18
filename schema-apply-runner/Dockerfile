# Schema Apply Runner (Spec X) — production image.
#
# Spec: agent-os/planning/2026-07-17-plane-based-migration-execution-shaping.md
# (§5, the schema half of the two "generate vs apply" runner gaps).
#
# This is the DISPATCH artefact for Spec X. The runner is a standalone JVM
# process the Node gateway CANNOT spawn — it is applied at DEPLOY time
# (Liquibase-on-boot) as the target service is stood up. This image is the
# runnable unit a deploy pipeline (IVS, compose, an init-container, a k8s Job)
# invokes; the sequencing lives in the deployment layer (see
# deploy/docker-compose.db-plane.yml + docs/deploy-dispatch.md), never in
# gateway code.
#
# Multi-stage: stage 1 (Maven + JDK 21) compiles the Spring Boot fat JAR; stage
# 2 (slim JRE) runs it. Mirrors sybase-discovery-sidecar/Dockerfile, bumped to
# Java 21 (this module targets java.version=21).
#
# Build:   docker build -t schema-apply-runner:dev .
# Run:     docker run --rm \
#            -e SCHEMA_APPLY_JDBC_URL=jdbc:postgresql://host:5432/target \
#            -e SCHEMA_APPLY_DB_USER=... -e SCHEMA_APPLY_DB_PASSWORD=... \
#            -e SCHEMA_APPLY_CONTEXTS=structural \
#            -v /path/to/pack:/pack -e SCHEMA_APPLY_PACK_ROOT=/pack \
#            schema-apply-runner:dev
# Compose: see deploy/docker-compose.db-plane.yml for the full DB-plane sequence.

# --- Stage 1: build -------------------------------------------------------
FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /workspace

# Copy pom.xml first to leverage Docker layer caching for dependencies.
COPY pom.xml ./
RUN mvn -B -q -DskipTests dependency:go-offline || true

COPY src ./src
RUN mvn -B -q -DskipTests package

# --- Stage 2: runtime -----------------------------------------------------
FROM eclipse-temurin:21-jre
WORKDIR /app

# Copy the Spring Boot fat JAR produced by stage 1. The artifactId + version
# are pinned in pom.xml, so the executable jar name is deterministic. The glob
# excludes the non-executable `*.jar.original` the repackage goal leaves behind.
COPY --from=builder /workspace/target/schema-apply-runner-*.jar /app/schema-apply-runner.jar

# Non-root user for defense in depth (matches sybase-discovery-sidecar). The
# shared trace file defaults to this user's ~/.haikai/trace.log; a deploy that
# sets HAIKAI_TRACE_FILE to a bind-mount must make that path writable by this
# UID (or use a named volume). Tracing is OFF by default and never fatal.
RUN useradd --create-home --shell /usr/sbin/nologin schemaapply \
    && chown -R schemaapply:schemaapply /app
USER schemaapply

# One-shot process: applies the requested Liquibase contexts, self-scores the
# apply as EXEC.SCHEMA.* predicates, and exits 0 (clean) / non-zero (failed) so
# the deploy orchestrator can gate the next step on the exit code. No port.
ENTRYPOINT ["java", "-jar", "/app/schema-apply-runner.jar"]
