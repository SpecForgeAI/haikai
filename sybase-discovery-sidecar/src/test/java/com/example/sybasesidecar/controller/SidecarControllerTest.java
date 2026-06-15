package com.example.sybasesidecar.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.sybasesidecar.service.SybaseQueryService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/**
 * Endpoint shape tests for {@link SidecarController}. These tests do NOT
 * spin up the full Spring context with a JDBC layer; they exercise the
 * controller's request/response mapping + the SQL guard wiring.
 */
@SpringBootTest
class SidecarControllerTest {

    @Autowired
    private SybaseQueryService queryService;

    /**
     * The {@code /query} endpoint returns HTTP 400 for a guard-rejected
     * SQL string. Demonstrates the controller surfaces guard rejections
     * separately from runtime failures so the discovery-service can
     * distinguish them.
     */
    @Test
    void queryReturns400OnGuardRejection() throws Exception {
        final SidecarController controller = new SidecarController(this.queryService);
        final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
        final String body = "{"
                + "\"host\":\"h\","
                + "\"port\":5000,"
                + "\"database\":\"d\","
                + "\"username\":\"u\","
                + "\"password\":\"p\","
                + "\"sql\":\"DELETE FROM t\""
                + "}";
        mockMvc.perform(post("/query")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.ok").value(false))
                .andExpect(jsonPath("$.error").exists());
    }

    /**
     * The {@code /test-connection} endpoint accepts the expected body
     * shape. Bad credentials produce HTTP 200 with {@code ok=false} - the
     * status code reflects "we processed the request"; the body carries
     * the failure detail.
     */
    @Test
    void testConnectionReturnsErrorShapeForBadHost() throws Exception {
        final SidecarController controller = new SidecarController(this.queryService);
        final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
        final String body = "{"
                + "\"host\":\"127.0.0.1\","
                + "\"port\":1,"
                + "\"database\":\"demo\","
                + "\"username\":\"user\","
                + "\"password\":\"pwd\""
                + "}";
        mockMvc.perform(post("/test-connection")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(false));
    }
}
