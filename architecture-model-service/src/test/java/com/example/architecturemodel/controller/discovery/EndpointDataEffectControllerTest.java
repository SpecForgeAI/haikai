package com.example.architecturemodel.controller.discovery;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.model.entity.discovery.EndpointDataEffectEntity;
import com.example.architecturemodel.repository.discovery.EndpointDataEffectRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc test for {@link EndpointDataEffectController}
 * (Spec 2026-07-06-f — T-SQL Affinity &amp; Consumer Revalidation).
 *
 * <p>Pins (REVERSE PIN): the reverse query by data-entity point returns
 * exactly the seeded effects; the endpoint-side batch read routes through the
 * `In` finder; neither-or-both params is a 400 (never an unfiltered dump).
 * The DTO carries explicit {@code @JsonProperty} snake_case declarations, so
 * even the standalone-MockMvc default ObjectMapper renders the real wire
 * names here.</p>
 */
@ExtendWith(MockitoExtension.class)
class EndpointDataEffectControllerTest {

    @Mock
    private EndpointDataEffectRepository repository;

    private MockMvc mockMvc;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ARCH_ID =
        UUID.fromString("22222222-2222-2222-2222-222222222222");

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
            .standaloneSetup(new EndpointDataEffectController(repository))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }

    private static EndpointDataEffectEntity effect(
            String id, String endpointId, String depId) {
        return EndpointDataEffectEntity.builder()
            .id(id)
            .modelFileId("mf-1")
            .endpointId(endpointId)
            .dataEntityPointId(depId)
            .accessMode("write")
            .confidence(0.9)
            .build();
    }

    @Test
    @DisplayName("REVERSE PIN: query by data_entity_point_ids returns exactly the seeded effects")
    void reverseQueryReturnsSeededEffects() throws Exception {
        when(repository.findByDataEntityPointIdIn(List.of("dep_phy_orders")))
            .thenReturn(List.of(
                effect("ede-1", "ep-1", "dep_phy_orders"),
                effect("ede-2", "ep-2", "dep_phy_orders")));

        mockMvc.perform(get(
                "/api/model/projects/{p}/architectures/{a}/endpoint-data-effects",
                PROJECT_ID, ARCH_ID)
                .param("data_entity_point_ids", "dep_phy_orders"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].endpoint_id").value("ep-1"))
            .andExpect(jsonPath("$[0].data_entity_point_id").value("dep_phy_orders"))
            .andExpect(jsonPath("$[1].endpoint_id").value("ep-2"));
    }

    @Test
    @DisplayName("endpoint_ids batch read routes through the In finder")
    void endpointBatchRead() throws Exception {
        when(repository.findByEndpointIdIn(List.of("ep-1", "ep-2")))
            .thenReturn(List.of(effect("ede-1", "ep-1", "dep_phy_orders")));

        mockMvc.perform(get(
                "/api/model/projects/{p}/architectures/{a}/endpoint-data-effects",
                PROJECT_ID, ARCH_ID)
                .param("endpoint_ids", "ep-1", "ep-2"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].data_entity_point_id").value("dep_phy_orders"));
        verify(repository, never()).findByDataEntityPointIdIn(anyCollection());
    }

    @Test
    @DisplayName("neither-or-both params is a 400 — never an unfiltered dump")
    void refusesUnfilteredOrAmbiguous() throws Exception {
        mockMvc.perform(get(
                "/api/model/projects/{p}/architectures/{a}/endpoint-data-effects",
                PROJECT_ID, ARCH_ID))
            .andExpect(status().isBadRequest());

        mockMvc.perform(get(
                "/api/model/projects/{p}/architectures/{a}/endpoint-data-effects",
                PROJECT_ID, ARCH_ID)
                .param("endpoint_ids", "ep-1")
                .param("data_entity_point_ids", "dep_phy_orders"))
            .andExpect(status().isBadRequest());
    }
}
