package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryClusterDto;
import com.example.architecturemodel.model.dto.DiscoveryClusterMemberDto;
import com.example.architecturemodel.service.DiscoveryClusterService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for DiscoveryClusterController.
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * Task Group 3: Cluster + ClusterMember JPA Stack (1c)
 *
 * Tests:
 * 1. POST bulk insert accepts array of cluster DTOs (each including members list) and returns persisted results
 * 2. GET by run ID returns all clusters for that run, each with their member lists
 * 3. GET by run ID with ?type=service_boundary filter returns only matching clusters
 * 4. GET /count returns the correct cluster count
 * 5. POST with a cluster containing duplicate members returns the cluster with deduplicated members
 *
 * Extended: Phase 1c Clustering and Cluster Adjudication (Increment 9)
 * Task Group 6: deleteByRunId for Cluster JPA Stack
 *
 * 6. DELETE returns 200 with count of deleted clusters
 */
@WebMvcTest(DiscoveryClusterController.class)
class DiscoveryClusterControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private DiscoveryClusterService discoveryClusterService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();
    private static final UUID RUN_ID = UUID.randomUUID();
    private static final String BASE_URL =
        "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/clusters";

    /**
     * Test 1: POST bulk insert accepts array of cluster DTOs (each including members list)
     * and returns persisted results.
     */
    @Test
    @DisplayName("Test 1: POST bulk insert accepts array of cluster DTOs with members and returns persisted results")
    void bulkInsert_acceptsArrayWithMembersAndPersists() throws Exception {
        // Given
        UUID clusterId = UUID.randomUUID();
        UUID memberId1 = UUID.randomUUID();
        UUID memberId2 = UUID.randomUUID();
        UUID atomId1 = UUID.randomUUID();
        UUID atomId2 = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryClusterMemberDto member1 = new DiscoveryClusterMemberDto(
            memberId1, clusterId, "atom", atomId1
        );
        DiscoveryClusterMemberDto member2 = new DiscoveryClusterMemberDto(
            memberId2, clusterId, "relationship", atomId2
        );

        DiscoveryClusterDto clusterDto = new DiscoveryClusterDto(
            clusterId, RUN_ID, "service_boundary", "User Service",
            0.85, List.of(member1, member2),
            Map.of("dominantLanguage", "Java", "directoryRoot", "src/main/java/user"),
            now.toString()
        );

        when(discoveryClusterService.bulkCreateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), anyList()))
            .thenReturn(List.of(clusterDto));

        // When/Then
        mockMvc.perform(post(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(List.of(clusterDto))))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].id").value(clusterId.toString()))
            .andExpect(jsonPath("$[0].run_id").value(RUN_ID.toString()))
            .andExpect(jsonPath("$[0].cluster_type").value("service_boundary"))
            .andExpect(jsonPath("$[0].name").value("User Service"))
            .andExpect(jsonPath("$[0].confidence").value(0.85))
            .andExpect(jsonPath("$[0].data.dominantLanguage").value("Java"))
            .andExpect(jsonPath("$[0].data.directoryRoot").value("src/main/java/user"))
            .andExpect(jsonPath("$[0].members.length()").value(2))
            .andExpect(jsonPath("$[0].members[0].id").value(memberId1.toString()))
            .andExpect(jsonPath("$[0].members[0].cluster_id").value(clusterId.toString()))
            .andExpect(jsonPath("$[0].members[0].member_type").value("atom"))
            .andExpect(jsonPath("$[0].members[0].member_id").value(atomId1.toString()))
            .andExpect(jsonPath("$[0].members[1].member_type").value("relationship"))
            .andExpect(jsonPath("$[0].members[1].member_id").value(atomId2.toString()));

        verify(discoveryClusterService).bulkCreateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), anyList());
    }

    /**
     * Test 2: GET by run ID returns all clusters for that run, each with their member lists.
     */
    @Test
    @DisplayName("Test 2: GET by run ID returns all clusters with their member lists")
    void listClusters_returnsAllClustersWithMembers() throws Exception {
        // Given
        UUID clusterId1 = UUID.randomUUID();
        UUID clusterId2 = UUID.randomUUID();
        UUID atomId = UUID.randomUUID();
        UUID relId = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryClusterMemberDto member1 = new DiscoveryClusterMemberDto(
            UUID.randomUUID(), clusterId1, "atom", atomId
        );

        DiscoveryClusterDto cluster1 = new DiscoveryClusterDto(
            clusterId1, RUN_ID, "service_boundary", "Auth Service",
            0.90, List.of(member1),
            Map.of("dominantLanguage", "TypeScript"),
            now.toString()
        );

        DiscoveryClusterMemberDto member2 = new DiscoveryClusterMemberDto(
            UUID.randomUUID(), clusterId2, "relationship", relId
        );

        DiscoveryClusterDto cluster2 = new DiscoveryClusterDto(
            clusterId2, RUN_ID, "data_domain", "User Data",
            0.75, List.of(member2),
            Map.of("dominantLanguage", "Java"),
            now.toString()
        );

        when(discoveryClusterService.getByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID, null))
            .thenReturn(List.of(cluster1, cluster2));

        // When/Then
        mockMvc.perform(get(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].cluster_type").value("service_boundary"))
            .andExpect(jsonPath("$[0].name").value("Auth Service"))
            .andExpect(jsonPath("$[0].members.length()").value(1))
            .andExpect(jsonPath("$[0].members[0].member_type").value("atom"))
            .andExpect(jsonPath("$[1].cluster_type").value("data_domain"))
            .andExpect(jsonPath("$[1].name").value("User Data"))
            .andExpect(jsonPath("$[1].members.length()").value(1))
            .andExpect(jsonPath("$[1].members[0].member_type").value("relationship"));

        verify(discoveryClusterService).getByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID, null);
    }

    /**
     * Test 3: GET by run ID with ?type=service_boundary filter returns only matching clusters.
     */
    @Test
    @DisplayName("Test 3: GET by run ID with ?type=service_boundary returns only matching clusters")
    void listClusters_withTypeFilter_returnsOnlyMatchingClusters() throws Exception {
        // Given
        UUID clusterId = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryClusterMemberDto member = new DiscoveryClusterMemberDto(
            UUID.randomUUID(), clusterId, "atom", UUID.randomUUID()
        );

        DiscoveryClusterDto serviceBoundaryCluster = new DiscoveryClusterDto(
            clusterId, RUN_ID, "service_boundary", "Payment Service",
            0.92, List.of(member),
            Map.of("dominantLanguage", "Java", "directoryRoot", "src/payment"),
            now.toString()
        );

        when(discoveryClusterService.getByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID, "service_boundary"))
            .thenReturn(List.of(serviceBoundaryCluster));

        // When/Then
        mockMvc.perform(get(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
                .param("type", "service_boundary"))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].cluster_type").value("service_boundary"))
            .andExpect(jsonPath("$[0].name").value("Payment Service"))
            .andExpect(jsonPath("$[0].confidence").value(0.92))
            .andExpect(jsonPath("$[0].members.length()").value(1));

        verify(discoveryClusterService).getByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID, "service_boundary");
    }

    /**
     * Test 4: GET /count returns the correct cluster count.
     */
    @Test
    @DisplayName("Test 4: GET /count returns the correct cluster count for a run")
    void countClusters_returnsCorrectCount() throws Exception {
        // Given
        when(discoveryClusterService.countByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(7L);

        // When/Then
        mockMvc.perform(get(BASE_URL + "/count", PROJECT_ID, ARCHITECTURE_ID, RUN_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.count").value(7));

        verify(discoveryClusterService).countByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID);
    }

    /**
     * Test 5: POST with a cluster containing duplicate members (same member_type and member_id)
     * returns the cluster with deduplicated members.
     */
    @Test
    @DisplayName("Test 5: POST with duplicate members returns cluster with deduplicated members")
    void bulkInsert_withDuplicateMembers_returnsDeduplicatedMembers() throws Exception {
        // Given
        UUID clusterId = UUID.randomUUID();
        UUID atomId = UUID.randomUUID();
        UUID deduplicatedMemberId = UUID.randomUUID();
        Instant now = Instant.now();

        // Input: two members referencing the same atom with same member_type
        DiscoveryClusterMemberDto duplicateMember1 = new DiscoveryClusterMemberDto(
            UUID.randomUUID(), clusterId, "atom", atomId
        );
        DiscoveryClusterMemberDto duplicateMember2 = new DiscoveryClusterMemberDto(
            UUID.randomUUID(), clusterId, "atom", atomId
        );

        DiscoveryClusterDto inputCluster = new DiscoveryClusterDto(
            clusterId, RUN_ID, "shared_library", "Common Utils",
            0.80, List.of(duplicateMember1, duplicateMember2),
            Map.of("dominantLanguage", "Java"),
            now.toString()
        );

        // Service returns deduplicated result (only one member)
        DiscoveryClusterMemberDto deduplicatedMember = new DiscoveryClusterMemberDto(
            deduplicatedMemberId, clusterId, "atom", atomId
        );

        DiscoveryClusterDto deduplicatedCluster = new DiscoveryClusterDto(
            clusterId, RUN_ID, "shared_library", "Common Utils",
            0.80, List.of(deduplicatedMember),
            Map.of("dominantLanguage", "Java"),
            now.toString()
        );

        when(discoveryClusterService.bulkCreateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), anyList()))
            .thenReturn(List.of(deduplicatedCluster));

        // When/Then
        mockMvc.perform(post(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(List.of(inputCluster))))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].cluster_type").value("shared_library"))
            .andExpect(jsonPath("$[0].name").value("Common Utils"))
            .andExpect(jsonPath("$[0].members.length()").value(1))
            .andExpect(jsonPath("$[0].members[0].member_type").value("atom"))
            .andExpect(jsonPath("$[0].members[0].member_id").value(atomId.toString()));

        verify(discoveryClusterService).bulkCreateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), anyList());
    }

    // ---- Phase 1c: deleteByRunId controller test (Increment 9, Task Group 6) ----

    /**
     * Task 6.1 Test 2: DELETE endpoint returns 200 with count of deleted clusters.
     *
     * Verifies that:
     * - DELETE /api/model/projects/{projectId}/discovery/runs/{runId}/clusters returns 200
     * - Response body contains {"deleted": <count>}
     * - The service deleteByRunId is called with the correct runId
     */
    @Test
    @DisplayName("Task 6.1 Test 2: DELETE endpoint returns 200 with count of deleted clusters")
    void deleteClusters_returns200WithDeletedCount() throws Exception {
        // Given: service reports 5 clusters were deleted
        when(discoveryClusterService.deleteByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(5L);

        // When/Then
        mockMvc.perform(delete(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.deleted").value(5));

        verify(discoveryClusterService).deleteByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID);
    }
}
