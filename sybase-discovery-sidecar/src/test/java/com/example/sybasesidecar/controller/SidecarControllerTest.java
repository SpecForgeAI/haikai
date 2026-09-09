package com.example.sybasesidecar.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.sybasesidecar.service.SybaseCallService;
import com.example.sybasesidecar.service.SybaseMutationService;
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

    @Autowired
    private SybaseMutationService mutationService;

    @Autowired
    private SybaseCallService callService;

    /**
     * The {@code /query} endpoint returns HTTP 400 for a guard-rejected
     * SQL string. Demonstrates the controller surfaces guard rejections
     * separately from runtime failures so the discovery-service can
     * distinguish them.
     */
    @Test
    void queryReturns400OnGuardRejection() throws Exception {
        final SidecarController controller =
                new SidecarController(this.queryService, this.mutationService, this.callService);
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
     * The {@code /mutate} endpoint (Capture-State Discipline Spec 1) returns
     * HTTP 400 for a batch containing a statement outside the compensation
     * grammar — BEFORE any JDBC work, exactly like the {@code /query} guard.
     */
    @Test
    void mutateReturns400OnGuardRejection() throws Exception {
        final SidecarController controller =
                new SidecarController(this.queryService, this.mutationService, this.callService);
        final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
        final String body = "{"
                + "\"host\":\"h\","
                + "\"port\":5000,"
                + "\"database\":\"d\","
                + "\"username\":\"u\","
                + "\"password\":\"p\","
                + "\"statements\":[\"DELETE FROM t WHERE id = 1\",\"DROP TABLE t\"]"
                + "}";
        mockMvc.perform(post("/mutate")
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
        final SidecarController controller =
                new SidecarController(this.queryService, this.mutationService, this.callService);
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

    /**
     * Predicate EXEC.CALL.01 -- {@code /call} guard rejections are LOUD. A
     * routine name that is not a bare identifier is HTTP 400 BEFORE any JDBC
     * work, with the structured envelope shape (snake_case keys) the AMVS
     * adapter parses.
     */
    @Test
    void callReturns400OnGuardRejection() throws Exception {
        final SidecarController controller = new SidecarController(
                this.queryService, this.mutationService, this.callService);
        final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
        final String body = "{"
                + "\"host\":\"h\","
                + "\"port\":5000,"
                + "\"database\":\"d\","
                + "\"username\":\"u\","
                + "\"password\":\"p\","
                + "\"routineName\":\"upd_ledger_roll; drop table t\""
                + "}";
        mockMvc.perform(post("/call")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.ok").value(false))
                .andExpect(jsonPath("$.error").exists())
                .andExpect(jsonPath("$.outcome").value("error"))
                .andExpect(jsonPath("$.result_sets").isEmpty())
                .andExpect(jsonPath("$.update_counts").isEmpty())
                .andExpect(jsonPath("$.return_status").doesNotExist());
    }

    /**
     * A blocked system procedure is refused on the same 400 path -- the
     * invocation surface must not become a back door to {@code sp_configure}.
     */
    @Test
    void callReturns400OnSystemProcedure() throws Exception {
        final SidecarController controller = new SidecarController(
                this.queryService, this.mutationService, this.callService);
        final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
        final String body = "{"
                + "\"host\":\"h\","
                + "\"port\":5000,"
                + "\"database\":\"d\","
                + "\"username\":\"u\","
                + "\"password\":\"p\","
                + "\"routineName\":\"sp_configure\""
                + "}";
        mockMvc.perform(post("/call")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.ok").value(false))
                .andExpect(jsonPath("$.error").exists());
    }
}
