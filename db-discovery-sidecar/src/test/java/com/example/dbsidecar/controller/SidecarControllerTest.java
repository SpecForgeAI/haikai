package com.example.dbsidecar.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.dbsidecar.SidecarProperties;
import com.example.dbsidecar.model.ConnectionOptions;
import com.example.dbsidecar.model.SidecarEngine;
import com.example.dbsidecar.model.TestConnectionRequest;
import com.example.dbsidecar.service.RoutineCallService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.example.dbsidecar.service.DbMutationService;
import com.example.dbsidecar.service.DbQueryService;
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
    private DbQueryService queryService;

    @Autowired
    private DbMutationService mutationService;

    @Autowired
    private RoutineCallService callService;

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

    // ----------------------------------------------------------------------
    // The engine field (SPEC-1 §1.2; wire contract v2 §1)
    // ----------------------------------------------------------------------

    /**
     * A request with NO {@code engine} field binds to {@code sybase}. Every
     * consumer that predates SPEC-1 omits the field and the sidecar served
     * exactly one engine then, so the default is unambiguous back-compat -- it
     * must never become a 400.
     */
    @Test
    void missingEngineDefaultsToSybase() {
        final TestConnectionRequest req = new TestConnectionRequest();
        assertEquals(SidecarEngine.SYBASE, req.resolveEngine());
        assertEquals(SidecarEngine.SYBASE, req.toConnectionOptions().engine());
        // ...and the mssql-only options carry their documented defaults.
        assertEquals("sql", req.toConnectionOptions().authScheme());
        assertTrue(req.toConnectionOptions().encrypt());
        assertFalse(req.toConnectionOptions().trustServerCertificate());
    }

    /**
     * The {@code engine} field binds case-insensitively from the FLAT wire
     * shape, alongside the mssql connection options.
     */
    @Test
    void engineAndMssqlOptionsBindFromTheFlatWireShape() throws Exception {
        final ObjectMapper mapper = new ObjectMapper();
        final TestConnectionRequest req = mapper.readValue("{"
                + "\"engine\":\"MSSQL\","
                + "\"host\":\"h\",\"port\":1433,\"database\":\"d\","
                + "\"username\":\"u\",\"password\":\"p\","
                + "\"authScheme\":\"ntlm\",\"domain\":\"CORP\","
                + "\"encrypt\":false,\"trustServerCertificate\":true,"
                + "\"instanceName\":\"SQLDEV\""
                + "}", TestConnectionRequest.class);
        final ConnectionOptions options = req.toConnectionOptions();
        assertEquals(SidecarEngine.MSSQL, options.engine());
        assertEquals("ntlm", options.authScheme());
        assertEquals("CORP", options.domain());
        assertFalse(options.encrypt());
        assertTrue(options.trustServerCertificate());
        assertEquals("SQLDEV", options.instanceName());
        assertTrue(options.isNtlm());
    }

    /** Lower-case {@code sybase} binds too, and the wire value round-trips. */
    @Test
    void engineParsesCaseInsensitively() {
        assertEquals(SidecarEngine.SYBASE, SidecarEngine.fromJson("sybase"));
        assertEquals(SidecarEngine.SYBASE, SidecarEngine.fromJson("  SyBaSe "));
        assertEquals(SidecarEngine.MSSQL, SidecarEngine.fromJson("mssql"));
        assertEquals(SidecarEngine.MSSQL, SidecarEngine.fromJson("MSSQL"));
        assertEquals("mssql", SidecarEngine.MSSQL.wireValue());
        assertEquals("sybase", SidecarEngine.SYBASE.wireValue());
        // Absent / blank is the back-compat default, NOT an error.
        assertEquals(SidecarEngine.SYBASE, SidecarEngine.fromJson(null));
        assertEquals(SidecarEngine.SYBASE, SidecarEngine.fromJson("   "));
    }

    /**
     * An UNKNOWN engine is HTTP 400, never a silent fallback. Defaulting it
     * would run SQL Server catalog SQL against ASE (or the reverse) and report
     * the resulting empty introspection as though the database were empty --
     * a wrong answer that looks like a right one.
     */
    @Test
    void unknownEngineIsRejectedWith400() throws Exception {
        final SidecarController controller = new SidecarController(
                this.queryService, this.mutationService, this.callService);
        final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
        final String body = "{"
                + "\"engine\":\"oracle\","
                + "\"host\":\"h\",\"port\":1521,\"database\":\"d\","
                + "\"username\":\"u\",\"password\":\"p\""
                + "}";
        mockMvc.perform(post("/test-connection")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.ok").value(false))
                .andExpect(jsonPath("$.error").exists());

        // The enum itself is the gate, and it names what IS supported.
        final IllegalArgumentException thrown = assertThrows(
                IllegalArgumentException.class, () -> SidecarEngine.fromJson("oracle"));
        assertTrue(thrown.getMessage().contains("sybase"));
        assertTrue(thrown.getMessage().contains("mssql"));
    }

    /**
     * The guard still rejects a non-SELECT on {@code /query} when an engine IS
     * named -- the engine widens the catalog layer, never the guard.
     */
    @Test
    void queryGuardStillRejectsNonSelectOnMssql() throws Exception {
        final SidecarController controller = new SidecarController(
                this.queryService, this.mutationService, this.callService);
        final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
        final String body = "{"
                + "\"engine\":\"mssql\","
                + "\"host\":\"h\",\"port\":1433,\"database\":\"d\","
                + "\"username\":\"u\",\"password\":\"p\","
                + "\"sql\":\"SELECT * FROM sys.objects FOR XML AUTO, OPENROWSET\""
                + "}";
        mockMvc.perform(post("/query")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.ok").value(false));
    }

    /** The configurable defaults are bound and used, not hardcoded. */
    @Test
    void sidecarDefaultsAreBoundFromConfiguration() {
        final SidecarProperties defaults = new SidecarProperties();
        assertEquals(30, defaults.getDefaultQueryTimeoutSeconds());
        assertEquals(1000, defaults.getDefaultMaxRows());

        final SidecarProperties tuned = new SidecarProperties();
        tuned.setDefaultQueryTimeoutSeconds(90);
        tuned.setDefaultMaxRows(250);
        assertEquals(90, tuned.getDefaultQueryTimeoutSeconds());
        assertEquals(250, tuned.getDefaultMaxRows());
        // The 4-argument controller constructor is what Spring wires.
        assertNotNull(new SidecarController(
                this.queryService, this.mutationService, this.callService, tuned));
    }
}
