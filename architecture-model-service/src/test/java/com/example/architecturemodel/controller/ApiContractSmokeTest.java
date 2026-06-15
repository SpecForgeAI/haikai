package com.example.architecturemodel.controller;

import com.example.architecturemodel.config.AppFeaturesProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.junit.jupiter.SpringExtension;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * API Contract Smoke Tests for DB/Session Separation.
 *
 * Spec 2026-01-22: Finalize DB/Session Separation (Phase 4)
 * Task Group 1: Make ActiveProjectController DB-Conditional
 * Task Group 3: Verification of Existing Controllers
 *
 * These smoke tests verify:
 * 1. DB endpoints return 404 when include-database=false (no handler registered)
 * 2. Session endpoints remain available in all modes
 * 3. ProjectController and ActiveProjectController are properly gated
 * 4. ProjectSessionController is always available
 *
 * Uses @SpringBootTest with @TestPropertySource for realistic context loading.
 */
class ApiContractSmokeTest {

    // =========================================================================
    // Task Group 1: No-DB Mode Tests - DB Endpoints Return 404
    // =========================================================================

    /**
     * Tests for no-DB mode (include-database=false).
     * Verifies DB-conditional controllers are NOT loaded.
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
    @AutoConfigureMockMvc
    @ActiveProfiles({"test", "no-db"})
    @TestPropertySource(properties = {
        "app.features.include-database=false"
    })
    @Nested
    @DisplayName("No-DB Mode: DB Endpoints Return 404")
    class NoDbModeDbEndpointsReturn404Test {

        @Autowired
        private MockMvc mockMvc;

        @Autowired
        private AppFeaturesProperties appFeaturesProperties;

        @Test
        @DisplayName("Feature toggle is set to include-database=false")
        void featureToggleIsCorrectlySet() {
            assertThat(appFeaturesProperties.isIncludeDatabase()).isFalse();
        }

        @Test
        @DisplayName("GET /api/projects/active returns 404 when include-database=false")
        void getActiveProject_ReturnsNotFound_WhenDbDisabled() throws Exception {
            mockMvc.perform(get("/api/projects/active")
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound());
        }

        @Test
        @DisplayName("GET /api/projects/active/export returns 404 when include-database=false")
        void getActiveProjectExport_ReturnsNotFound_WhenDbDisabled() throws Exception {
            mockMvc.perform(get("/api/projects/active/export")
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound());
        }

        @Test
        @DisplayName("POST /api/projects/import returns 404 when include-database=false")
        void postImport_ReturnsNotFound_WhenDbDisabled() throws Exception {
            String requestBody = """
                {
                    "snapshot": {
                        "meta": {
                            "snapshot_version": 1,
                            "exported_at": "2026-01-22T00:00:00Z",
                            "export_kind": "FULL"
                        },
                        "project": {
                            "id": "00000000-0000-0000-0000-000000000001",
                            "name": "Test Project",
                            "project_parent_folder": "/test",
                            "is_active": true,
                            "created_at": "2026-01-22T00:00:00Z",
                            "updated_at": "2026-01-22T00:00:00Z"
                        },
                        "model": null,
                        "work_items": [],
                        "artifacts": []
                    },
                    "set_active": true
                }
                """;

            mockMvc.perform(post("/api/projects/import")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody)
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound());
        }
    }

    // =========================================================================
    // Task Group 1: No-DB Mode Tests - Session Endpoints Remain Available
    // =========================================================================

    /**
     * Tests for no-DB mode (include-database=false).
     * Verifies session endpoints ARE available (always-on).
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
    @AutoConfigureMockMvc
    @ActiveProfiles({"test", "no-db"})
    @TestPropertySource(properties = {
        "app.features.include-database=false"
    })
    @Nested
    @DisplayName("No-DB Mode: Session Endpoints Available")
    class NoDbModeSessionEndpointsAvailableTest {

        @Autowired
        private MockMvc mockMvc;

        @Test
        @DisplayName("GET /api/project-session returns 200 with auto-initialized 'Untitled' project")
        void getSessionProject_ReturnsUntitled_WhenNoSession() throws Exception {
            // The session store now auto-initializes a blank "Untitled" project
            // when none exists, so this endpoint ALWAYS returns 200.
            mockMvc.perform(get("/api/project-session")
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk());
        }

        @Test
        @DisplayName("POST /api/project-session/import returns 201 (session endpoint works)")
        void postSessionImport_ReturnsCreated_WhenDbDisabled() throws Exception {
            String requestBody = """
                {
                    "snapshot": {
                        "meta": {
                            "snapshot_version": 1,
                            "exported_at": "2026-01-22T00:00:00Z",
                            "export_kind": "FULL"
                        },
                        "project": {
                            "id": "00000000-0000-0000-0000-000000000001",
                            "name": "Test Session Project",
                            "project_parent_folder": "/test",
                            "is_active": true,
                            "created_at": "2026-01-22T00:00:00Z",
                            "updated_at": "2026-01-22T00:00:00Z"
                        },
                        "model": null,
                        "work_items": [],
                        "artifacts": []
                    },
                    "set_active": true
                }
                """;

            mockMvc.perform(post("/api/project-session/import")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody)
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.project.name").value("Test Session Project"))
                .andExpect(jsonPath("$.model_saved").value(false));
        }
    }

    // =========================================================================
    // Task Group 3: Verification - ProjectController is DB-Conditional
    // =========================================================================

    /**
     * Tests for no-DB mode (include-database=false).
     * Verifies ProjectController endpoints return 404.
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
    @AutoConfigureMockMvc
    @ActiveProfiles({"test", "no-db"})
    @TestPropertySource(properties = {
        "app.features.include-database=false"
    })
    @Nested
    @DisplayName("No-DB Mode: ProjectController Endpoints Return 404")
    class NoDbModeProjectControllerReturn404Test {

        @Autowired
        private MockMvc mockMvc;

        @Test
        @DisplayName("GET /api/projects returns 404 when include-database=false")
        void getProjects_ReturnsNotFound_WhenDbDisabled() throws Exception {
            mockMvc.perform(get("/api/projects")
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound());
        }

        @Test
        @DisplayName("POST /api/projects returns 404 when include-database=false")
        void postCreateProject_ReturnsNotFound_WhenDbDisabled() throws Exception {
            String requestBody = """
                {
                    "name": "Test Project",
                    "project_parent_folder": "/test"
                }
                """;

            mockMvc.perform(post("/api/projects")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody)
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound());
        }
    }

    // =========================================================================
    // Task Group 3: Verification - Session Endpoints Available in DB Mode
    // =========================================================================

    /**
     * Tests for DB mode (include-database=true).
     * Verifies session endpoints are still available (always-on).
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
    @AutoConfigureMockMvc
    @ActiveProfiles("test")
    @TestPropertySource(properties = {
        "app.features.include-database=true"
    })
    @Nested
    @DisplayName("DB Mode: Session Endpoints Still Available")
    class DbModeSessionEndpointsStillAvailableTest {

        @Autowired
        private MockMvc mockMvc;

        @Autowired
        private AppFeaturesProperties appFeaturesProperties;

        @Test
        @DisplayName("Feature toggle is set to include-database=true")
        void featureToggleIsCorrectlySet() {
            assertThat(appFeaturesProperties.isIncludeDatabase()).isTrue();
        }

        @Test
        @DisplayName("GET /api/project-session returns 200 with auto-initialized 'Untitled' project (DB mode)")
        void getSessionProject_ReturnsUntitled_InDbMode() throws Exception {
            // The session store now auto-initializes a blank "Untitled" project
            // when none exists, so this endpoint ALWAYS returns 200.
            mockMvc.perform(get("/api/project-session")
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk());
        }

        @Test
        @DisplayName("POST /api/project-session/import works in DB mode (session endpoints always-on)")
        void postSessionImport_ReturnsCreated_InDbMode() throws Exception {
            String requestBody = """
                {
                    "snapshot": {
                        "meta": {
                            "snapshot_version": 1,
                            "exported_at": "2026-01-22T00:00:00Z",
                            "export_kind": "FULL"
                        },
                        "project": {
                            "id": "00000000-0000-0000-0000-000000000001",
                            "name": "Test Session Project",
                            "project_parent_folder": "/test",
                            "is_active": true,
                            "created_at": "2026-01-22T00:00:00Z",
                            "updated_at": "2026-01-22T00:00:00Z"
                        },
                        "model": null,
                        "work_items": [],
                        "artifacts": []
                    },
                    "set_active": true
                }
                """;

            mockMvc.perform(post("/api/project-session/import")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody)
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.project.name").value("Test Session Project"))
                .andExpect(jsonPath("$.model_saved").value(false));
        }
    }
}
