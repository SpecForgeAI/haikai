package com.example.architecturemodel.controller;

import com.example.architecturemodel.service.DiscoveryRunService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Controller tests for {@code DELETE /discovery/runs/{runId}} -- the
 * architecture-scoped run-delete that powers the Discovery Runs UI's
 * right-click "Delete" action.
 *
 * Two properties:
 * <ol>
 *   <li>A delete the service confirms (run found in scope) returns 204 and the
 *       controller passes the URL's (runId, projectId, architectureId) straight
 *       through.</li>
 *   <li>A delete the service rejects as out-of-scope (run absent / bound to a
 *       different architecture) returns 404 -- no cross-architecture deletes.</li>
 * </ol>
 */
@WebMvcTest(DiscoveryRunController.class)
class DiscoveryRunControllerDeleteTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private DiscoveryRunService discoveryRunService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_A = UUID.randomUUID();
    private static final UUID ARCHITECTURE_B = UUID.randomUUID();

    @Test
    @DisplayName("DELETE /runs/{id} returns 204 and forwards the scoped ids when the run is deleted")
    void deleteRun_returns204_whenDeleted() throws Exception {
        UUID runId = UUID.randomUUID();
        when(discoveryRunService.deleteRunInArchitecture(runId, PROJECT_ID, ARCHITECTURE_A))
            .thenReturn(true);

        mockMvc.perform(delete(
                "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}",
                PROJECT_ID, ARCHITECTURE_A, runId))
            .andExpect(status().isNoContent());

        verify(discoveryRunService).deleteRunInArchitecture(runId, PROJECT_ID, ARCHITECTURE_A);
    }

    @Test
    @DisplayName("DELETE /runs/{id} returns 404 when the run is not found in this architecture")
    void deleteRun_returns404_whenNotFoundInScope() throws Exception {
        UUID runId = UUID.randomUUID();
        // Service reports the run is not in (PROJECT_ID, ARCHITECTURE_B) scope.
        when(discoveryRunService.deleteRunInArchitecture(runId, PROJECT_ID, ARCHITECTURE_B))
            .thenReturn(false);

        mockMvc.perform(delete(
                "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}",
                PROJECT_ID, ARCHITECTURE_B, runId))
            .andExpect(status().isNotFound());
    }
}
