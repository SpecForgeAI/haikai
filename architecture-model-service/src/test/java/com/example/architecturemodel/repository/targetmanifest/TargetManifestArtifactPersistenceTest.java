package com.example.architecturemodel.repository.targetmanifest;

import com.example.architecturemodel.model.dto.targetmanifest.TargetManifestArtifactDto;
import com.example.architecturemodel.model.dto.targetmanifest.TargetManifestArtifactInput;
import com.example.architecturemodel.model.entity.targetmanifest.TargetManifestArtifactEntity;
import com.example.architecturemodel.service.targetmanifest.TargetManifestArtifactService;
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

/**
 * Persistence-layer slice tests for {@link TargetManifestArtifactEntity} +
 * {@link TargetManifestArtifactService} from Task Group 1 of the Confirmed
 * Manifest Producer Wiring spec (2026-06-25, Spec 5 Phase 2).
 *
 * <p>Covers ONLY the critical lifecycle (per the 2-8 focused-tests budget):</p>
 * <ol>
 *   <li>The service replace-latest write for the SAME
 *       {@code (project_id, target_architecture_id, tag)} flips the prior
 *       {@code is_latest=true} row to {@code false}, inserts a new
 *       {@code is_latest=true} row, and RETAINS the prior row (keep-history, no
 *       deletes); the latest read returns ONE row per tag and
 *       {@code @PrePersist} populates {@code created_at}.</li>
 *   <li>Verbatim {@code content} / {@code package_lock_content} TEXT round-trip
 *       (byte-for-byte, including a trailing newline + non-ASCII) and the
 *       {@code resolved_dependencies} JSONB round-trip.</li>
 *   <li>The {@code is_latest} flip is scoped per-tag -- writing a new latest for
 *       one tag does NOT demote a sibling tag's latest.</li>
 * </ol>
 *
 * <p>Uses the same H2-in-PostgreSQL-compat-mode pattern as
 * {@code VulnerabilityPersistenceTest} -- {@code JSONB} is registered as a domain
 * alias for {@code JSON} so the {@code JsonType} binding round-trips. Under
 * {@code @DataJpaTest} the schema is Hibernate-generated
 * ({@code ddl-auto=create-drop}, Liquibase disabled); the real
 * {@code 199-target-manifest-artifacts.sql} apply is proven separately by
 * {@code TargetManifestArtifactsChangesetTest}. The service is {@code @Import}ed
 * so its replace-latest logic is exercised against a real H2 (mirrors
 * {@code DataEntityPointBackfillIntegrationTest}).</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(TargetManifestArtifactService.class)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:targetmanifestdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class TargetManifestArtifactPersistenceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private TargetManifestArtifactRepository repository;

    @Autowired
    private TargetManifestArtifactService service;

    private static Map<String, Object> dep(String name, String version) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", name);
        m.put("version", version);
        return m;
    }

    private static TargetManifestArtifactInput input(String tag, String kind, String ecosystem,
                                                     String manifestPath, String content,
                                                     String lockContent,
                                                     List<Map<String, Object>> deps) {
        return new TargetManifestArtifactInput(
            tag, kind, ecosystem, manifestPath, content, lockContent, deps, List.of(), null);
    }

    @Test
    @DisplayName("Service replace-latest: re-write for the same (project, targetArchitecture, tag) flips the prior is_latest=false and RETAINS it (no delete); latest read returns ONE row per tag; @PrePersist sets created_at")
    void replaceLatestKeepsHistory() {
        UUID projectId = UUID.randomUUID();
        UUID targetArchitectureId = UUID.randomUUID();

        // First upload -> latest.
        List<TargetManifestArtifactDto> afterFirst = service.persistLatest(
            projectId, targetArchitectureId,
            List.of(input("orders", "pom", "MAVEN", "pom.xml",
                "<project>v1</project>", null, List.of(dep("g:a", "1.0.0")))));
        entityManager.clear();

        assertThat(afterFirst).hasSize(1);
        assertThat(afterFirst.get(0).content()).isEqualTo("<project>v1</project>");
        assertThat(afterFirst.get(0).isLatest()).isTrue();
        // @PrePersist populated created_at.
        assertThat(afterFirst.get(0).createdAt()).isNotNull();

        // Re-upload the SAME tag with new content -> replace latest, keep history.
        List<TargetManifestArtifactDto> afterSecond = service.persistLatest(
            projectId, targetArchitectureId,
            List.of(input("orders", "pom", "MAVEN", "pom.xml",
                "<project>v2</project>", null, List.of(dep("g:a", "2.0.0")))));
        entityManager.clear();

        // Latest read returns ONLY the new latest (one row for the tag).
        assertThat(afterSecond).hasSize(1);
        assertThat(afterSecond.get(0).content()).isEqualTo("<project>v2</project>");
        assertThat(afterSecond.get(0).isLatest()).isTrue();

        // History retained: BOTH rows still present (no delete) -- exactly one latest.
        List<TargetManifestArtifactEntity> all = repository.findAll();
        assertThat(all).hasSize(2);
        assertThat(all).filteredOn(e -> Boolean.TRUE.equals(e.getIsLatest())).hasSize(1);
        assertThat(all).filteredOn(e -> Boolean.FALSE.equals(e.getIsLatest()))
            .hasSize(1)
            .allSatisfy(prior -> assertThat(prior.getContent()).isEqualTo("<project>v1</project>"));

        // The latest finder filters is_latest=true and returns one per tag.
        List<TargetManifestArtifactEntity> latest =
            repository.findByProjectIdAndTargetArchitectureIdAndIsLatestTrueOrderByTagAsc(
                projectId, targetArchitectureId);
        assertThat(latest).hasSize(1);
        assertThat(latest.get(0).getContent()).isEqualTo("<project>v2</project>");
    }

    @Test
    @DisplayName("Verbatim round-trip: content + package_lock_content come back byte-for-byte (trailing newline + non-ASCII preserved); resolved_dependencies JSONB round-trips")
    void verbatimAndJsonbRoundTrip() {
        UUID projectId = UUID.randomUUID();
        UUID targetArchitectureId = UUID.randomUUID();

        // Trailing newline, internal newlines, a tab, and a non-ASCII char must
        // all survive byte-for-byte through the TEXT round-trip.
        String content = "{\n  \"name\": \"café-app\",\n  \"version\": \"1.0.0\"\n}\n";
        String lock = "{\n  \"lockfileVersion\": 3\n}\n";

        service.persistLatest(projectId, targetArchitectureId,
            List.of(input("web", "package_json", "NPM", "package.json", content, lock,
                List.of(dep("react", "18.2.0"), dep("left-pad", "1.3.0")))));
        entityManager.clear();

        List<TargetManifestArtifactEntity> rows =
            repository.findByProjectIdAndTargetArchitectureIdAndIsLatestTrueOrderByTagAsc(
                projectId, targetArchitectureId);
        assertThat(rows).hasSize(1);
        TargetManifestArtifactEntity reloaded = rows.get(0);

        // Byte-for-byte verbatim content + lockfile (no trim / re-encode / newline drift).
        assertThat(reloaded.getContent()).isEqualTo(content);
        assertThat(reloaded.getContent()).endsWith("}\n");
        assertThat(reloaded.getContent()).contains("café-app");
        assertThat(reloaded.getPackageLockContent()).isEqualTo(lock);

        // resolved_dependencies JSONB round-trip.
        assertThat(reloaded.getResolvedDependencies()).hasSize(2);
        assertThat(reloaded.getResolvedDependencies().get(0).get("name")).isEqualTo("react");
        assertThat(reloaded.getResolvedDependencies().get(0).get("version")).isEqualTo("18.2.0");
        assertThat(reloaded.getResolvedDependencies().get(1).get("name")).isEqualTo("left-pad");

        // Maven-style artifact: package_lock_content nullable.
        service.persistLatest(projectId, targetArchitectureId,
            List.of(input("api", "pom", "MAVEN", "pom.xml", "<project/>", null, List.of())));
        entityManager.clear();
        TargetManifestArtifactEntity mvn =
            repository.findFirstByProjectIdAndTargetArchitectureIdAndTagAndIsLatestTrue(
                projectId, targetArchitectureId, "api").orElseThrow();
        assertThat(mvn.getPackageLockContent()).isNull();
        assertThat(mvn.getResolvedDependencies()).isNotNull().isEmpty();
    }

    @Test
    @DisplayName("is_latest flip is scoped per-tag: writing a new latest for one tag does NOT demote a sibling tag's latest")
    void latestFlipIsScopedPerTag() {
        UUID projectId = UUID.randomUUID();
        UUID targetArchitectureId = UUID.randomUUID();

        // Two distinct tags, each gets a latest.
        service.persistLatest(projectId, targetArchitectureId, List.of(
            input("orders", "pom", "MAVEN", "pom.xml", "<orders>v1</orders>", null, List.of()),
            input("billing", "pom", "MAVEN", "pom.xml", "<billing>v1</billing>", null, List.of())));
        entityManager.clear();

        List<TargetManifestArtifactDto> twoTags = service.findLatest(projectId, targetArchitectureId);
        assertThat(twoTags).extracting(TargetManifestArtifactDto::tag)
            .containsExactly("billing", "orders"); // ordered by tag asc

        // Re-upload ONLY the orders tag.
        service.persistLatest(projectId, targetArchitectureId, List.of(
            input("orders", "pom", "MAVEN", "pom.xml", "<orders>v2</orders>", null, List.of())));
        entityManager.clear();

        // billing's latest is UNTOUCHED; orders advanced to v2.
        TargetManifestArtifactEntity billingLatest =
            repository.findFirstByProjectIdAndTargetArchitectureIdAndTagAndIsLatestTrue(
                projectId, targetArchitectureId, "billing").orElseThrow();
        assertThat(billingLatest.getContent()).isEqualTo("<billing>v1</billing>");

        TargetManifestArtifactEntity ordersLatest =
            repository.findFirstByProjectIdAndTargetArchitectureIdAndTagAndIsLatestTrue(
                projectId, targetArchitectureId, "orders").orElseThrow();
        assertThat(ordersLatest.getContent()).isEqualTo("<orders>v2</orders>");

        // Each tag still has exactly one latest; orders kept its prior as history.
        List<TargetManifestArtifactDto> latest = service.findLatest(projectId, targetArchitectureId);
        assertThat(latest).hasSize(2);
        assertThat(repository.findAll()).hasSize(3); // billing(1) + orders(2 incl. history)
    }

    @Test
    @DisplayName("tier2_facts JSONB round-trip: { friendly_name, coordinate } free-fact objects persist + read back intact; null reads back empty (Spec 2026-06-26 Task Group 7)")
    void tier2FactsJsonbRoundTrip() {
        UUID projectId = UUID.randomUUID();
        UUID targetArchitectureId = UUID.randomUUID();

        Map<String, Object> mcp = new LinkedHashMap<>();
        mcp.put("friendly_name", "MCP SDK");
        mcp.put("coordinate", "io.modelcontextprotocol.sdk");
        Map<String, Object> springAi = new LinkedHashMap<>();
        springAi.put("friendly_name", "Spring AI / LLM client");
        springAi.put("coordinate", "spring-ai-openai");

        service.persistLatest(projectId, targetArchitectureId,
            List.of(new TargetManifestArtifactInput(
                "orders", "pom", "MAVEN", "pom.xml", "<project/>", null,
                List.of(dep("g:a", "1.0.0")), List.of(mcp, springAi), null)));
        entityManager.clear();

        List<TargetManifestArtifactEntity> rows =
            repository.findByProjectIdAndTargetArchitectureIdAndIsLatestTrueOrderByTagAsc(
                projectId, targetArchitectureId);
        assertThat(rows).hasSize(1);
        TargetManifestArtifactEntity reloaded = rows.get(0);

        // The Tier-2 free facts JSONB round-trips intact (snake_case keys preserved).
        assertThat(reloaded.getTier2Facts()).hasSize(2);
        assertThat(reloaded.getTier2Facts().get(0).get("friendly_name")).isEqualTo("MCP SDK");
        assertThat(reloaded.getTier2Facts().get(0).get("coordinate"))
            .isEqualTo("io.modelcontextprotocol.sdk");
        assertThat(reloaded.getTier2Facts().get(1).get("friendly_name"))
            .isEqualTo("Spring AI / LLM client");

        // The DTO surfaces the same tier2_facts (one per tag).
        List<TargetManifestArtifactDto> latest = service.findLatest(projectId, targetArchitectureId);
        assertThat(latest).hasSize(1);
        assertThat(latest.get(0).tier2Facts()).hasSize(2);
        assertThat(latest.get(0).tier2Facts().get(0).get("coordinate"))
            .isEqualTo("io.modelcontextprotocol.sdk");

        // A fresh artifact with a NULL tier2_facts input reads back as empty (NOT null).
        service.persistLatest(projectId, targetArchitectureId,
            List.of(new TargetManifestArtifactInput(
                "billing", "pom", "MAVEN", "pom.xml", "<project/>", null, List.of(), null, null)));
        entityManager.clear();
        TargetManifestArtifactEntity billing =
            repository.findFirstByProjectIdAndTargetArchitectureIdAndTagAndIsLatestTrue(
                projectId, targetArchitectureId, "billing").orElseThrow();
        assertThat(billing.getTier2Facts()).isNotNull().isEmpty();
    }
}
