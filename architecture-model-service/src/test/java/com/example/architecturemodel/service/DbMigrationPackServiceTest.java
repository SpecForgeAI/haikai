package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.BulkResolveDbMigrationPackDecisionsRequest;
import com.example.architecturemodel.model.dto.DbMigrationPackDecisionDto;
import com.example.architecturemodel.model.dto.DbMigrationPackDriftReportDto;
import com.example.architecturemodel.model.dto.DbMigrationPackDto;
import com.example.architecturemodel.model.dto.DbMigrationPackFileDto;
import com.example.architecturemodel.model.dto.ResolveDbMigrationPackDecisionRequest;
import com.example.architecturemodel.model.dto.UpdateDbMigrationPackRequest;
import com.example.architecturemodel.model.dto.UpsertDbMigrationPackRequest;
import com.example.architecturemodel.model.entity.DbMigrationPackDecisionEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackStatus;
import com.example.architecturemodel.repository.entity.DbMigrationPackDecisionRepository;
import com.example.architecturemodel.repository.entity.DbMigrationPackRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Focused service-layer tests for the DB migration pack persistence stack --
 * Task Group 1, sub-task 1.1 (6 tests; the changeset-apply check lives in
 * {@code DbMigrationPackChangesetTest}).
 *
 * <p>Uses {@code @DataJpaTest} + the in-memory H2 JSONB-domain-aliased DB,
 * modeled on {@link GeneratedMigrationBookOfWorkServiceTest}, with an
 * {@code @Import} of the service-under-test.</p>
 *
 * <p>Coverage (per tasks.md 1.1):</p>
 * <ol>
 *   <li>(a) create pack + files + read-back round trip (snake_case wire,
 *       manifest_json intact).</li>
 *   <li>(b) one-active-pack-per project+architecture: regeneration updates
 *       the pack row IN PLACE and replaces files while decisions + drift
 *       reports survive by pack id.</li>
 *   <li>(c1) decision resolve flips {@code open -> resolved} with
 *       resolution_json persisted (single + bulk; invalid resolve 400s).</li>
 *   <li>(c2) decision_key uniqueness within a pack re-links rather than
 *       duplicates on upsert (resolution preserved).</li>
 *   <li>(d) drift reports are append-only history (second append leaves the
 *       first untouched).</li>
 *   <li>(e) sparse PATCH of work_item_id updates only that field -- coverage
 *       counts and seed_margin untouched (boxed-type/null-guard check).</li>
 * </ol>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:dbmigpackservicedb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
@Import(DbMigrationPackService.class)
class DbMigrationPackServiceTest {

    @Autowired
    private DbMigrationPackService service;

    @Autowired
    private DbMigrationPackRepository packRepository;

    @Autowired
    private DbMigrationPackDecisionRepository decisionRepository;

    @Autowired
    private TestEntityManager entityManager;

    // -----------------------------------------------------------------
    // Fixture builders
    // -----------------------------------------------------------------

    private static DbMigrationPackFileDto file(String path, String kind, String content, Integer order) {
        return new DbMigrationPackFileDto(null, null, path, kind, content, order);
    }

    private static DbMigrationPackDecisionDto decision(String key, String category, String question) {
        return new DbMigrationPackDecisionDto(
            null, null, key, "dbo.orders.rowver", category, question,
            List.of("bytea", "drop", "application-managed"),
            null, null, null, null, null);
    }

    private static UpsertDbMigrationPackRequest buildUpsertRequest(
        UUID architectureId,
        List<DbMigrationPackFileDto> files,
        List<DbMigrationPackDecisionDto> decisions) {
        Map<String, Object> manifest = new LinkedHashMap<>();
        manifest.put("phase_ordering", List.of(
            "structural", "bulk_load", "fks_and_indexes", "reseed", "incremental"));
        manifest.put("expected_schema", Map.of("tables", List.of("dbo.orders")));
        return new UpsertDbMigrationPackRequest(
            architectureId,
            null,                         // status -> defaults to generated
            null,                         // stale_reason
            "sha256:abc123",
            null,                         // work_item_id -> preserved
            10, 2, 3,                     // translated / skipped / flagged
            1000L,                        // seed_margin
            manifest,
            files,
            decisions
        );
    }

    private static List<DbMigrationPackFileDto> defaultFiles() {
        return List.of(
            file("liquibase/db.changelog-master.xml", "liquibase_master", "<include .../>", 0),
            file("liquibase/changesets/010-tables/dbo.orders.sql", "liquibase_changeset",
                "--changeset table--dbo.orders", 1),
            file("manifest.json", "manifest", "{}", 2));
    }

    // -----------------------------------------------------------------
    // Tests
    // -----------------------------------------------------------------

    @Test
    @DisplayName("(a) create pack + files round trip: manifest_json intact, files ordered, snake_case wire")
    void createPackWithFilesRoundTrip() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        DbMigrationPackDto created = service.upsertPack(
            projectId, buildUpsertRequest(architectureId, defaultFiles(), null));

        assertThat(created.id()).isNotNull();
        assertThat(created.projectId()).isEqualTo(projectId);
        assertThat(created.architectureId()).isEqualTo(architectureId);
        assertThat(created.status()).isEqualTo(DbMigrationPackStatus.GENERATED);
        assertThat(created.inputSnapshotHash()).isEqualTo("sha256:abc123");
        assertThat(created.generatedAt()).isNotNull();
        assertThat(created.translatedCount()).isEqualTo(10);
        assertThat(created.seedMargin()).isEqualTo(1000L);

        // Reload from DB: manifest JSONB survives the round trip intact.
        entityManager.flush();
        entityManager.clear();
        DbMigrationPackDto reloaded = service.getPack(projectId, created.id());
        assertThat(reloaded.manifestJson()).containsKey("phase_ordering");
        assertThat(reloaded.manifestJson()).containsKey("expected_schema");

        // Files read back in deterministic sort order with content intact.
        List<DbMigrationPackFileDto> files = service.listFiles(projectId, created.id());
        assertThat(files).hasSize(3);
        assertThat(files).extracting(DbMigrationPackFileDto::filePath).containsExactly(
            "liquibase/db.changelog-master.xml",
            "liquibase/changesets/010-tables/dbo.orders.sql",
            "manifest.json");
        assertThat(files.get(1).content()).isEqualTo("--changeset table--dbo.orders");
        assertThat(files.get(1).fileKind()).isEqualTo("liquibase_changeset");

        // Snake_case wire: a vanilla ObjectMapper honours the explicit
        // @JsonProperty declarations on the record (the AMS global
        // SNAKE_CASE strategy produces the same shape in the service).
        String json = new ObjectMapper().writeValueAsString(reloaded);
        assertThat(json).contains("\"project_id\"");
        assertThat(json).contains("\"architecture_id\"");
        assertThat(json).contains("\"input_snapshot_hash\"");
        assertThat(json).contains("\"manifest_json\"");
        assertThat(json).contains("\"seed_margin\"");
        assertThat(json).doesNotContain("\"projectId\"");
    }

    @Test
    @DisplayName("(b) regeneration updates the pack in place and replaces files; decisions + drift reports survive by pack id")
    void regenerateInPlacePreservesDecisionsAndDriftHistory() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        DbMigrationPackDto first = service.upsertPack(projectId, buildUpsertRequest(
            architectureId, defaultFiles(),
            List.of(decision("type_mapping:dbo.orders.rowver", "type_mapping",
                "Sybase timestamp (rowversion): bytea, drop, or application-managed?"))));
        service.appendDriftReport(projectId, first.id(), new DbMigrationPackDriftReportDto(
            null, null, Map.of("schemas", List.of("dbo")), 5, 1, 2,
            Map.of("objects", List.of()), null, null));
        entityManager.flush();
        entityManager.clear();

        // Regenerate the SAME (project, architecture): different files, same
        // decision key re-flagged.
        List<DbMigrationPackFileDto> regeneratedFiles = List.of(
            file("liquibase/db.changelog-master.xml", "liquibase_master", "<include v2 .../>", 0),
            file("data/bulk/010-dbo.orders.sql", "bulk_load_script", "COPY ...", 1));
        DbMigrationPackDto second = service.upsertPack(projectId, buildUpsertRequest(
            architectureId, regeneratedFiles,
            List.of(decision("type_mapping:dbo.orders.rowver", "type_mapping",
                "Sybase timestamp (rowversion): bytea, drop, or application-managed?"))));
        entityManager.flush();
        entityManager.clear();

        // One active pack per project+architecture: the row was updated IN
        // PLACE (same id), not duplicated.
        assertThat(second.id()).isEqualTo(first.id());
        List<DbMigrationPackEntity> rows = packRepository.findByProjectIdOrderByCreatedAtDesc(projectId);
        assertThat(rows).hasSize(1);

        // Files were REPLACED wholesale.
        List<DbMigrationPackFileDto> files = service.listFiles(projectId, second.id());
        assertThat(files).extracting(DbMigrationPackFileDto::filePath).containsExactly(
            "liquibase/db.changelog-master.xml",
            "data/bulk/010-dbo.orders.sql");
        assertThat(files.get(0).content()).isEqualTo("<include v2 .../>");

        // Decisions + drift history SURVIVED by pack id.
        assertThat(service.listDecisions(projectId, second.id(), null, null)).hasSize(1);
        assertThat(service.listDriftReports(projectId, second.id())).hasSize(1);
    }

    @Test
    @DisplayName("(c1) resolve flips open -> resolved with resolution_json persisted and marks the pack stale; invalid resolve rejects")
    void resolveDecisionFlipsStatusAndMarksPackStale() {
        UUID projectId = UUID.randomUUID();
        DbMigrationPackDto pack = service.upsertPack(projectId, buildUpsertRequest(
            UUID.randomUUID(), null,
            List.of(
                decision("type_mapping:dbo.orders.rowver", "type_mapping", "rowversion?"),
                decision("collation:dbo.orders.name", "collation", "case-insensitive collation?"),
                decision("delta_key:dbo.audit_log", "delta_key", "no usable delta key"),
                // 2026-08-08 (changeset 221): the surrogate-PK category must
                // pass validateDecisions — the first live Regenerate 400d here.
                decision("surrogate_pk--tables_without_pk", "surrogate_pk",
                    "57 tables carry no primary key — add surrogate identity PKs?"))));

        List<DbMigrationPackDecisionDto> open =
            service.listDecisions(projectId, pack.id(), "open", null);
        assertThat(open).hasSize(4);

        // Invalid resolve: missing resolution_json -> 400 path.
        UUID firstId = open.get(0).id();
        assertThatThrownBy(() -> service.resolveDecision(
            projectId, pack.id(), firstId, new ResolveDbMigrationPackDecisionRequest(null)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("resolution_json");

        // Single resolve persists the payload + resolved_at.
        DbMigrationPackDecisionDto resolved = service.resolveDecision(
            projectId, pack.id(), firstId,
            new ResolveDbMigrationPackDecisionRequest(Map.of("choice", "bytea")));
        assertThat(resolved.status()).isEqualTo(DbMigrationPackDecisionEntity.STATUS_RESOLVED);
        assertThat(resolved.resolutionJson()).containsEntry("choice", "bytea");
        assertThat(resolved.resolvedAt()).isNotNull();

        // Resolving marked the pack stale (regenerate is explicit-only; the
        // service never triggers generation).
        DbMigrationPackDto stale = service.getPack(projectId, pack.id());
        assertThat(stale.status()).isEqualTo(DbMigrationPackStatus.STALE);
        assertThat(stale.staleReason()).isEqualTo(
            DbMigrationPackService.STALE_REASON_DECISION_RESOLVED);

        // Bulk resolve with the same option flips the remaining three.
        List<DbMigrationPackDecisionDto> bulk = service.resolveDecisionsBulk(
            projectId, pack.id(),
            new BulkResolveDbMigrationPackDecisionsRequest(
                List.of(open.get(1).id(), open.get(2).id(), open.get(3).id()),
                Map.of("choice", "accept_case_sensitive")));
        assertThat(bulk).hasSize(3);
        assertThat(service.listDecisions(projectId, pack.id(), "open", null)).isEmpty();
        assertThat(service.listDecisions(projectId, pack.id(), "resolved", null)).hasSize(4);

        // A foreign decision id rejects the WHOLE bulk (atomic).
        assertThatThrownBy(() -> service.resolveDecisionsBulk(
            projectId, pack.id(),
            new BulkResolveDbMigrationPackDecisionsRequest(
                List.of(UUID.randomUUID()), Map.of("choice", "x"))))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("does not belong to pack");
    }

    @Test
    @DisplayName("(c2) decision_key upsert re-links the existing row (same id) and preserves its resolution")
    void decisionKeyUpsertRelinksInsteadOfDuplicating() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        String key = "computed_column:dbo.orders.total";

        DbMigrationPackDto pack = service.upsertPack(projectId, buildUpsertRequest(
            architectureId, null,
            List.of(decision(key, "computed_column", "expression not token-translatable"))));
        DbMigrationPackDecisionDto original =
            service.listDecisions(projectId, pack.id(), null, null).get(0);
        service.resolveDecision(projectId, pack.id(), original.id(),
            new ResolveDbMigrationPackDecisionRequest(Map.of("choice", "stored_generated")));
        entityManager.flush();
        entityManager.clear();

        // Regeneration re-flags the same object: SAME decision_key, refreshed
        // question text.
        service.upsertPack(projectId, buildUpsertRequest(
            architectureId, null,
            List.of(decision(key, "computed_column", "expression not token-translatable (v2)"))));
        entityManager.flush();
        entityManager.clear();

        List<DbMigrationPackDecisionEntity> rows =
            decisionRepository.findByPackIdOrderByCreatedAtAsc(pack.id());
        assertThat(rows).as("re-link, never duplicate").hasSize(1);
        DbMigrationPackDecisionEntity relinked = rows.get(0);
        assertThat(relinked.getId()).isEqualTo(original.id());
        assertThat(relinked.getQuestion()).isEqualTo("expression not token-translatable (v2)");
        // The resolution lifecycle survived the re-link.
        assertThat(relinked.getStatus()).isEqualTo(DbMigrationPackDecisionEntity.STATUS_RESOLVED);
        assertThat(relinked.getResolutionJson()).containsEntry("choice", "stored_generated");
        assertThat(relinked.getResolvedAt()).isNotNull();
    }

    @Test
    @DisplayName("(d) drift reports are append-only history: a second append leaves the first untouched")
    void driftReportsAreAppendOnlyHistory() {
        UUID projectId = UUID.randomUUID();
        DbMigrationPackDto pack = service.upsertPack(
            projectId, buildUpsertRequest(UUID.randomUUID(), null, null));

        DbMigrationPackDriftReportDto firstAppend = service.appendDriftReport(
            projectId, pack.id(), new DbMigrationPackDriftReportDto(
                null, null, Map.of("schemas", List.of("dbo")), 40, 3, 2,
                Map.of("objects", List.of(Map.of("name", "dbo.orders", "classification", "match"))),
                null, null));
        assertThat(firstAppend.source()).as("source defaults to in_tool").isEqualTo("in_tool");
        entityManager.flush();
        entityManager.clear();

        service.appendDriftReport(projectId, pack.id(), new DbMigrationPackDriftReportDto(
            null, null, Map.of("tables", List.of("dbo.orders")), 45, 0, 0,
            Map.of("objects", List.of()), "in_tool", null));
        entityManager.flush();
        entityManager.clear();

        List<DbMigrationPackDriftReportDto> history =
            service.listDriftReports(projectId, pack.id());
        assertThat(history).hasSize(2);
        // The FIRST row is untouched: same id, same counts, same report_json.
        DbMigrationPackDriftReportDto preserved = history.stream()
            .filter(r -> r.id().equals(firstAppend.id()))
            .findFirst().orElseThrow();
        assertThat(preserved.matchCount()).isEqualTo(40);
        assertThat(preserved.missingCount()).isEqualTo(3);
        assertThat(preserved.mismatchCount()).isEqualTo(2);
        assertThat(preserved.scanScopeJson()).containsEntry("schemas", List.of("dbo"));
        assertThat(preserved.reportJson()).containsKey("objects");
    }

    @Test
    @DisplayName("(e) sparse PATCH of work_item_id updates only that field; counts and seed_margin untouched")
    void sparsePatchOfWorkItemIdLeavesCountsUntouched() {
        UUID projectId = UUID.randomUUID();
        DbMigrationPackDto pack = service.upsertPack(
            projectId, buildUpsertRequest(UUID.randomUUID(), null, null));
        entityManager.flush();
        entityManager.clear();

        // Sparse PATCH: ONLY work_item_id is present; status / stale_reason
        // omitted (null), counts and seed_margin not even on the surface.
        DbMigrationPackDto patched = service.updatePack(projectId, pack.id(),
            new UpdateDbMigrationPackRequest("epic-item-42", null, null));

        assertThat(patched.workItemId()).isEqualTo("epic-item-42");
        // Boxed-type/null-guard check: nothing else moved -- in particular no
        // numeric column wiped to 0 by primitive defaulting.
        assertThat(patched.translatedCount()).isEqualTo(10);
        assertThat(patched.skippedCount()).isEqualTo(2);
        assertThat(patched.flaggedCount()).isEqualTo(3);
        assertThat(patched.seedMargin()).isEqualTo(1000L);
        assertThat(patched.status()).isEqualTo(DbMigrationPackStatus.GENERATED);
        assertThat(patched.inputSnapshotHash()).isEqualTo("sha256:abc123");
        assertThat(patched.manifestJson()).containsKey("phase_ordering");

        // Invalid status on PATCH rejects.
        assertThatThrownBy(() -> service.updatePack(projectId, pack.id(),
            new UpdateDbMigrationPackRequest(null, "not-a-status", null)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Invalid status");

        // Blank work_item_id CLEARS the attachment (documented contract).
        DbMigrationPackDto cleared = service.updatePack(projectId, pack.id(),
            new UpdateDbMigrationPackRequest("", null, null));
        assertThat(cleared.workItemId()).isNull();
    }
}
