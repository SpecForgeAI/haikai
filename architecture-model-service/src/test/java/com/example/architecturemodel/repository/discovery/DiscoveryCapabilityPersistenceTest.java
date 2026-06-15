package com.example.architecturemodel.repository.discovery;

import com.example.architecturemodel.model.dto.discovery.BulkCreateDiscoveryCapabilitiesRequest;
import com.example.architecturemodel.model.dto.discovery.CreateDiscoveryCapabilityRequest;
import com.example.architecturemodel.model.dto.discovery.DiscoveryCapabilityDto;
import com.example.architecturemodel.model.dto.discovery.DiscoveryCapabilityMemberDto;
import com.example.architecturemodel.model.dto.discovery.ReviewDiscoveryCapabilityRequest;
import com.example.architecturemodel.model.entity.discovery.DiscoveryCapabilityMemberEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryCapabilityReviewStatus;
import com.example.architecturemodel.service.discovery.DiscoveryCapabilityService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Persistence + service round-trip tests for the discovery capability +
 * polymorphic member store added by Liquibase changeset {@code 184}
 * ({@code discovery_capability} + {@code discovery_capability_member}).
 *
 * <p>Spec: D2 -- Capability Synthesis + Batch Spines (2026-06-14, Spec 2 of 6)
 * -- Task Group 1.</p>
 *
 * <p>Mirrors the {@code MigrationReconciliationBreakPersistenceTest} harness (the
 * {@code @DataJpaTest} + H2 PostgreSQL-mode + {@code CREATE DOMAIN JSONB AS JSON}
 * idiom) so the JSONB {@code detail_json} blobs round-trip through persist +
 * reload, and so the changeset's column DDL is exercised by the JPA mapping (the
 * entity mirrors the changeset 1:1). The {@link DiscoveryCapabilityService} is
 * instantiated directly over the two autowired repositories (the
 * {@code @DataJpaTest} slice does not register {@code @Service} beans),
 * exercising the full create / bulk-create / read / patch-review path.</p>
 *
 * <p>Focused tests (6 -- within the 2-8 budget per task 1.1):</p>
 * <ol>
 *   <li>create persists a capability + its polymorphic members atomically; read
 *       returns them with the JSONB {@code detail_json} (the JIL-DAG topology +
 *       {@code invocations[]} edges) surviving the round-trip.</li>
 *   <li>patch-review records {@code previous_review_status} and does NOT wipe the
 *       boxed {@code confidence} on a partial (review-only) update.</li>
 *   <li>the four polymorphic {@code member_type} values round-trip; an invalid
 *       {@code member_type} is rejected at create.</li>
 *   <li>bulk-create persists a batch of capabilities, each with its own members.</li>
 *   <li>list-by-run and list-by-project+architecture return the capabilities with
 *       members embedded.</li>
 *   <li>the {@code (member_type, member_id)} reverse-lookup finder resolves the
 *       capabilities that reference a given member (the indexed reverse key).</li>
 * </ol>
 *
 * <p>NOTE: the FK {@code ON DELETE CASCADE} is asserted statically in
 * {@link DiscoveryCapabilityLiquibaseSmokeTest} (the changeset SQL) -- it is NOT
 * exercised here because the {@code @DataJpaTest} profile generates the schema
 * from the JPA mappings via {@code ddl-auto=create-drop} (Liquibase disabled),
 * and the polymorphic {@code member_id} is a plain column (no JPA relationship),
 * so Hibernate emits no DB-level cascade. This mirrors the
 * {@code MigrationReconciliationBreakPersistenceTest} convention (DB cascade
 * verified by the changeset, not the H2 round-trip).</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:dcapabilitydb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class DiscoveryCapabilityPersistenceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private DiscoveryCapabilityRepository capabilityRepository;

    @Autowired
    private DiscoveryCapabilityMemberRepository memberRepository;

    private DiscoveryCapabilityService service;

    @BeforeEach
    void setUp() {
        service = new DiscoveryCapabilityService(capabilityRepository, memberRepository);
    }

    /** A small JIL-DAG-topology-ish detail_json payload for round-trip checks. */
    private static Map<String, Object> topologyDetail() {
        Map<String, Object> box = new LinkedHashMap<>();
        box.put("name", "BOX_RISK_LOAD");
        Map<String, Object> invocation = new LinkedHashMap<>();
        invocation.put("from", "load.sh");
        invocation.put("fromKind", "shell");
        invocation.put("to", "com.bank.risk.RiskLoader");
        invocation.put("toKind", "java_class");
        invocation.put("mechanism", "java_main");
        invocation.put("confidence", 0.8);
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("topology", box);
        detail.put("invocations", List.of(invocation));
        detail.put("behaviourBearing", List.of("com.bank.risk.RiskLoader"));
        return detail;
    }

    private static DiscoveryCapabilityMemberDto member(String memberType) {
        return new DiscoveryCapabilityMemberDto(null, null, memberType, UUID.randomUUID(), null);
    }

    private CreateDiscoveryCapabilityRequest capabilityRequest(
            String name, Double confidence, Map<String, Object> detail,
            List<DiscoveryCapabilityMemberDto> members) {
        return new CreateDiscoveryCapabilityRequest(
            name, "batch_pipeline", "Daily risk hierarchy load",
            confidence, detail, "jil_dag_closure", "capability_synthesis", members);
    }

    @Test
    @DisplayName("create persists a capability + its polymorphic members atomically; detail_json JSONB round-trips")
    void createPersistsCapabilityAndMembersWithJsonb() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();

        List<DiscoveryCapabilityMemberDto> members = List.of(
            member("discovery_finding"),
            member("discovery_candidate"));

        DiscoveryCapabilityDto created = service.create(projectId, architectureId, runId,
            capabilityRequest("Daily Risk Hierarchy Load Pipeline", 0.9, topologyDetail(), members));
        entityManager.flush();
        entityManager.clear();

        assertThat(created.id()).isNotNull();
        assertThat(created.projectId()).isEqualTo(projectId);
        assertThat(created.architectureId()).isEqualTo(architectureId);
        assertThat(created.runId()).isEqualTo(runId);
        assertThat(created.reviewStatus()).isEqualTo(DiscoveryCapabilityReviewStatus.PENDING_REVIEW);
        assertThat(created.kind()).isEqualTo("batch_pipeline");
        assertThat(created.members()).hasSize(2);

        DiscoveryCapabilityDto reloaded = service.get(created.id());
        assertThat(reloaded.members()).hasSize(2);
        // The capability id binds every member.
        assertThat(reloaded.members())
            .allSatisfy(m -> assertThat(m.capabilityId()).isEqualTo(created.id()));
        // The JSONB detail_json (JIL-DAG topology + invocations[] edges) survives.
        assertThat(reloaded.detailJson()).containsKey("topology");
        Object invocations = reloaded.detailJson().get("invocations");
        assertThat(invocations).isInstanceOf(List.class);
        assertThat((List<?>) invocations).hasSize(1);
        assertThat(reloaded.detailJson()).containsKey("behaviourBearing");
    }

    @Test
    @DisplayName("patch-review records previous_review_status and does NOT wipe boxed confidence on a partial update")
    void patchReviewRecordsPreviousAndPreservesConfidence() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();

        DiscoveryCapabilityDto created = service.create(projectId, architectureId, runId,
            capabilityRequest("Monitoring Capability", 0.77, topologyDetail(),
                List.of(member("architecture_element"))));
        UUID capabilityId = created.id();
        assertThat(created.confidence()).isEqualTo(0.77);
        assertThat(created.previousReviewStatus()).isNull();

        // Review-only PATCH: approve. confidence/detail_json/members NOT supplied.
        DiscoveryCapabilityDto approved = service.review(capabilityId,
            new ReviewDiscoveryCapabilityRequest(DiscoveryCapabilityReviewStatus.APPROVED, "looks right"));
        entityManager.flush();
        entityManager.clear();

        DiscoveryCapabilityDto reloaded = service.get(capabilityId);
        assertThat(reloaded.reviewStatus()).isEqualTo(DiscoveryCapabilityReviewStatus.APPROVED);
        assertThat(reloaded.previousReviewStatus())
            .as("previous_review_status must capture the prior disposition")
            .isEqualTo(DiscoveryCapabilityReviewStatus.PENDING_REVIEW);
        assertThat(reloaded.confidence())
            .as("boxed confidence must survive a review-only PATCH (no primitive 0.0 wipe)")
            .isEqualTo(0.77);
        assertThat(reloaded.members())
            .as("members must survive a review-only PATCH")
            .hasSize(1);
        // The reviewer note is folded into detail_json (no dedicated column in D2).
        assertThat(reloaded.detailJson()).containsEntry("reviewerNotes", "looks right");
        // detail_json topology is preserved alongside the note.
        assertThat(reloaded.detailJson()).containsKey("topology");
    }

    @Test
    @DisplayName("all four polymorphic member_type values round-trip; an invalid member_type is rejected at create")
    void memberTypesRoundTripAndInvalidRejected() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();

        List<DiscoveryCapabilityMemberDto> allTypes = List.of(
            member("discovery_finding"),
            member("discovery_candidate"),
            member("architecture_element"),
            member("discovery_relationship"));

        DiscoveryCapabilityDto created = service.create(projectId, architectureId, runId,
            capabilityRequest("Polymorphic Capability", 0.5, topologyDetail(), allTypes));
        entityManager.flush();
        entityManager.clear();

        DiscoveryCapabilityDto reloaded = service.get(created.id());
        assertThat(reloaded.members()).hasSize(4);
        assertThat(reloaded.members().stream().map(DiscoveryCapabilityMemberDto::memberType))
            .containsExactlyInAnyOrder(
                "discovery_finding", "discovery_candidate",
                "architecture_element", "discovery_relationship");

        // An unknown member_type is rejected (service-layer validation).
        assertThatThrownBy(() -> service.create(projectId, architectureId, runId,
                capabilityRequest("Bad Capability", 0.5, topologyDetail(),
                    List.of(member("not_a_real_member_type")))))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Invalid discovery capability member_type");
    }

    @Test
    @DisplayName("bulk-create persists a batch of capabilities, each with its own members")
    void bulkCreatePersistsBatch() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();

        BulkCreateDiscoveryCapabilitiesRequest request = new BulkCreateDiscoveryCapabilitiesRequest(List.of(
            capabilityRequest("Pipeline A", 0.9, topologyDetail(), List.of(member("discovery_finding"))),
            capabilityRequest("Pipeline B", 0.8, topologyDetail(),
                List.of(member("discovery_candidate"), member("discovery_relationship")))));

        List<DiscoveryCapabilityDto> created =
            service.bulkCreate(projectId, architectureId, runId, request);
        entityManager.flush();
        entityManager.clear();

        assertThat(created).hasSize(2);
        assertThat(created.get(0).members()).hasSize(1);
        assertThat(created.get(1).members()).hasSize(2);

        List<DiscoveryCapabilityDto> readBack = service.listByRun(projectId, architectureId, runId);
        assertThat(readBack).hasSize(2);
        assertThat(readBack).extracting(DiscoveryCapabilityDto::name)
            .containsExactly("Pipeline A", "Pipeline B");
    }

    @Test
    @DisplayName("list-by-run and list-by-project+architecture return the capabilities with members embedded")
    void listReadsReturnMembers() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();

        service.create(projectId, architectureId, runId,
            capabilityRequest("Listed Capability", 0.6, topologyDetail(),
                List.of(member("discovery_finding"), member("architecture_element"))));
        entityManager.flush();
        entityManager.clear();

        List<DiscoveryCapabilityDto> byRun = service.listByRun(projectId, architectureId, runId);
        assertThat(byRun).hasSize(1);
        assertThat(byRun.get(0).members()).hasSize(2);

        List<DiscoveryCapabilityDto> byProjectArch =
            service.listByProjectAndArchitecture(projectId, architectureId);
        assertThat(byProjectArch).hasSize(1);
        assertThat(byProjectArch.get(0).members()).hasSize(2);

        // A different run sees nothing.
        assertThat(service.listByRun(projectId, architectureId, UUID.randomUUID())).isEmpty();
    }

    @Test
    @DisplayName("the (member_type, member_id) reverse-lookup finder resolves capabilities that reference a given member")
    void reverseLookupFinderResolvesByMember() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();

        // A specific finding id that two capabilities will both reference.
        UUID sharedFindingId = UUID.randomUUID();
        DiscoveryCapabilityMemberDto sharedA =
            new DiscoveryCapabilityMemberDto(null, null, "discovery_finding", sharedFindingId, null);
        DiscoveryCapabilityMemberDto sharedB =
            new DiscoveryCapabilityMemberDto(null, null, "discovery_finding", sharedFindingId, null);

        service.create(projectId, architectureId, runId,
            capabilityRequest("Cap One", 0.9, topologyDetail(), List.of(sharedA, member("discovery_candidate"))));
        service.create(projectId, architectureId, runId,
            capabilityRequest("Cap Two", 0.8, topologyDetail(), List.of(sharedB)));
        entityManager.flush();
        entityManager.clear();

        // The reverse lookup keyed on (member_type, member_id) finds BOTH edges.
        List<DiscoveryCapabilityMemberEntity> edges =
            memberRepository.findByMemberTypeAndMemberId("discovery_finding", sharedFindingId);
        assertThat(edges).hasSize(2);
        assertThat(edges).allSatisfy(e -> assertThat(e.getMemberId()).isEqualTo(sharedFindingId));

        // A different (type, id) pair resolves nothing.
        assertThat(memberRepository.findByMemberTypeAndMemberId("discovery_finding", UUID.randomUUID()))
            .isEmpty();
    }
}
