# Sybase Discovery Sidecar - Dockerfile
#
# Spec: 2026-05-16 Database Discovery Packs - Task Group 4.
#
# Multi-stage build: first stage uses a Maven + JDK image to compile and
# produce the Spring Boot fat JAR; second stage uses a slim JRE base to
# minimise final image size and attack surface.
#
# Build:   docker build -t sybase-discovery-sidecar:dev .
# Run:     docker run --rm -p 8093:8093 sybase-discovery-sidecar:dev
# Compose: see docker-compose.yml in repo root for a wiring example.

# --- Stage 1: build -------------------------------------------------------
FROM maven:3.9-eclipse-temurin-17 AS builder
WORKDIR /workspace

# Copy pom.xml first to leverage Docker layer caching for dependencies.
COPY pom.xml ./
RUN mvn -B -q -DskipTests dependency:go-offline || true

COPY src ./src
RUN mvn -B -q -DskipTests package

# --- Stage 2: runtime -----------------------------------------------------
FROM eclipse-temurin:17-jre
WORKDIR /app

# Copy the Spring Boot fat JAR produced by stage 1. The artifactId is
# pinned in pom.xml so the file name is deterministic.
COPY --from=builder /workspace/target/sybase-discovery-sidecar-*.jar /app/sidecar.jar

# Default port - override via SERVER_PORT (Spring Boot convention).
EXPOSE 8093

# Non-root user for defense in depth.
RUN useradd --create-home --shell /usr/sbin/nologin sidecar \
    && chown -R sidecar:sidecar /app
USER sidecar

# user.timezone=UTC (2026-08-07): zoneless ASE datetimes round-trip through
# java.sql.Timestamp via the JVM default zone. Any zone with DST would corrupt
# wall-clock values inside spring-forward gaps; UTC has no gaps, so the
# read-format round trip in SybaseQueryService.normalizeWireValue is exact.
ENTRYPOINT ["java", "-Duser.timezone=UTC", "-jar", "/app/sidecar.jar"]
