package com.example.architecturemodel.store;

import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotDto;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for SessionProjectStore.
 *
 * Spec 2026-01-22: Session-Backed Active Project
 *
 * Tests the in-memory session store that holds the active project and snapshot
 * when the application is running in no-database mode.
 *
 * Spec 2026-01-22: File Mode Blank Start UX
 * Task Group 1: SessionProjectStore Enhancement
 * - Tests for ensureActiveProject() and ensureActiveSnapshot() methods
 * - Verifies auto-initialization of blank project and snapshot
 *
 * Task Group 5: Integration Testing
 * - Additional tests for clear-then-access flow
 */
class SessionProjectStoreTest {

    private SessionProjectStore store;

    @BeforeEach
    void setUp() {
        store = new SessionProjectStore();
    }

    @Test
    @DisplayName("setActiveProject stores both ProjectDto and ProjectSnapshotDto")
    void testSetActiveProjectStoresBoth() {
        // Given
        ProjectDto project = createTestProject("Test Project");
        ProjectSnapshotDto snapshot = createTestSnapshot(project);

        // When
        store.setActiveProject(project, snapshot);

        // Then
        assertThat(store.getActiveProject()).isPresent();
        assertThat(store.getActiveProject().get()).isEqualTo(project);
        assertThat(store.getActiveSnapshot()).isPresent();
        assertThat(store.getActiveSnapshot().get()).isEqualTo(snapshot);
    }

    @Test
    @DisplayName("getActiveProject returns Optional.empty() when no project set")
    void testGetActiveProjectReturnsEmptyWhenNoProjectSet() {
        // When
        Optional<ProjectDto> result = store.getActiveProject();

        // Then
        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("getActiveSnapshot returns Optional.empty() when no snapshot set")
    void testGetActiveSnapshotReturnsEmptyWhenNoSnapshotSet() {
        // When
        Optional<ProjectSnapshotDto> result = store.getActiveSnapshot();

        // Then
        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("clear removes both project and snapshot, subsequent gets return empty")
    void testClearRemovesBothProjectAndSnapshot() {
        // Given - a project and snapshot are set
        ProjectDto project = createTestProject("Test Project");
        ProjectSnapshotDto snapshot = createTestSnapshot(project);
        store.setActiveProject(project, snapshot);

        // Verify they're set
        assertThat(store.getActiveProject()).isPresent();
        assertThat(store.getActiveSnapshot()).isPresent();

        // When
        store.clear();

        // Then
        assertThat(store.getActiveProject()).isEmpty();
        assertThat(store.getActiveSnapshot()).isEmpty();
    }

    // =========================================================================
    // Spec 2026-01-22: File Mode Blank Start UX
    // Task Group 1: Tests for ensureActiveProject and ensureActiveSnapshot
    // =========================================================================

    @Nested
    @DisplayName("ensureActiveProject tests")
    class EnsureActiveProjectTests {

        @Test
        @DisplayName("ensureActiveProject_createsBlankProject_whenNoneExists")
        void ensureActiveProject_createsBlankProject_whenNoneExists() {
            // Given - no project exists (fresh store)
            assertThat(store.getActiveProject()).isEmpty();

            // When
            ProjectDto result = store.ensureActiveProject();

            // Then - a blank project is created with "Untitled" name
            assertThat(result).isNotNull();
            assertThat(result.name()).isEqualTo("Untitled");
            assertThat(result.id()).isNotNull();
            assertThat(result.isActive()).isTrue();

            // And - getActiveProject now returns the same project
            assertThat(store.getActiveProject()).isPresent();
            assertThat(store.getActiveProject().get()).isEqualTo(result);

            // And - a snapshot was also created
            assertThat(store.getActiveSnapshot()).isPresent();
            assertThat(store.getActiveSnapshot().get().project()).isEqualTo(result);
        }

        @Test
        @DisplayName("ensureActiveProject_returnsExisting_whenProjectExists")
        void ensureActiveProject_returnsExisting_whenProjectExists() {
            // Given - a project already exists
            ProjectDto existingProject = createTestProject("Existing Project");
            ProjectSnapshotDto existingSnapshot = createTestSnapshot(existingProject);
            store.setActiveProject(existingProject, existingSnapshot);

            // When
            ProjectDto result = store.ensureActiveProject();

            // Then - the existing project is returned (not replaced)
            assertThat(result).isEqualTo(existingProject);
            assertThat(result.name()).isEqualTo("Existing Project");

            // And - the snapshot remains unchanged
            assertThat(store.getActiveSnapshot()).isPresent();
            assertThat(store.getActiveSnapshot().get()).isEqualTo(existingSnapshot);
        }
    }

    @Nested
    @DisplayName("ensureActiveSnapshot tests")
    class EnsureActiveSnapshotTests {

        @Test
        @DisplayName("ensureActiveSnapshot_createsBlankSnapshot_whenNoneExists")
        void ensureActiveSnapshot_createsBlankSnapshot_whenNoneExists() {
            // Given - no snapshot exists (fresh store)
            assertThat(store.getActiveSnapshot()).isEmpty();

            // When
            ProjectSnapshotDto result = store.ensureActiveSnapshot();

            // Then - a blank snapshot is created
            assertThat(result).isNotNull();
            assertThat(result.meta()).isNotNull();
            assertThat(result.meta().snapshotVersion()).isEqualTo(1);
            assertThat(result.meta().exportKind()).isEqualTo("session");
            assertThat(result.project()).isNotNull();
            assertThat(result.project().name()).isEqualTo("Untitled");
            assertThat(result.model()).isNotNull();
            assertThat(result.workItems()).isEmpty();
            assertThat(result.artifacts()).isEmpty();

            // And - getActiveSnapshot now returns the same snapshot
            assertThat(store.getActiveSnapshot()).isPresent();
            assertThat(store.getActiveSnapshot().get()).isEqualTo(result);

            // And - a project was also created
            assertThat(store.getActiveProject()).isPresent();
            assertThat(store.getActiveProject().get()).isEqualTo(result.project());
        }

        @Test
        @DisplayName("ensureActiveSnapshot_returnsExisting_whenSnapshotExists")
        void ensureActiveSnapshot_returnsExisting_whenSnapshotExists() {
            // Given - a snapshot already exists
            ProjectDto existingProject = createTestProject("Existing Project");
            ProjectSnapshotDto existingSnapshot = createTestSnapshot(existingProject);
            store.setActiveProject(existingProject, existingSnapshot);

            // When
            ProjectSnapshotDto result = store.ensureActiveSnapshot();

            // Then - the existing snapshot is returned (not replaced)
            assertThat(result).isEqualTo(existingSnapshot);
            assertThat(result.project().name()).isEqualTo("Existing Project");

            // And - the project remains unchanged
            assertThat(store.getActiveProject()).isPresent();
            assertThat(store.getActiveProject().get()).isEqualTo(existingProject);
        }
    }

    // =========================================================================
    // Spec 2026-01-22: File Mode Blank Start UX
    // Task Group 5: Integration Testing - Additional flow tests
    // =========================================================================

    @Nested
    @DisplayName("Integration flow tests")
    class IntegrationFlowTests {

        /**
         * Test: Clear then access recreates blank project
         *
         * Spec 2026-01-22: File Mode Blank Start UX
         * Task Group 5.3: Integration Testing
         *
         * Verifies that after clearing the session, calling ensureActiveProject
         * recreates a new blank project. This simulates a user clearing
         * the session and then continuing to work - they should get a fresh
         * blank project, not an error.
         */
        @Test
        @DisplayName("clearThenEnsure_recreatesBlankProject")
        void clearThenEnsure_recreatesBlankProject() {
            // Given - an existing project is set
            ProjectDto originalProject = createTestProject("Original Project");
            ProjectSnapshotDto originalSnapshot = createTestSnapshot(originalProject);
            store.setActiveProject(originalProject, originalSnapshot);

            UUID originalId = originalProject.id();

            // Verify it's set
            assertThat(store.getActiveProject()).isPresent();
            assertThat(store.getActiveProject().get().name()).isEqualTo("Original Project");

            // When - clear and then ensure
            store.clear();
            ProjectDto newProject = store.ensureActiveProject();

            // Then - a NEW blank project is created (not the original)
            assertThat(newProject).isNotNull();
            assertThat(newProject.name()).isEqualTo("Untitled");
            assertThat(newProject.id()).isNotEqualTo(originalId);

            // And - a new snapshot is also created
            ProjectSnapshotDto newSnapshot = store.ensureActiveSnapshot();
            assertThat(newSnapshot).isNotNull();
            assertThat(newSnapshot.project()).isEqualTo(newProject);
        }

        /**
         * Test: Import replaces blank project completely
         *
         * Spec 2026-01-22: File Mode Blank Start UX
         * Task Group 5.3: Integration Testing
         *
         * Verifies that when a user imports a project after starting
         * with a blank project, the import completely replaces the blank.
         */
        @Test
        @DisplayName("importReplacesBlankProject")
        void importReplacesBlankProject() {
            // Given - start with blank project (simulating app startup)
            ProjectDto blankProject = store.ensureActiveProject();
            assertThat(blankProject.name()).isEqualTo("Untitled");

            // When - import a real project
            ProjectDto importedProject = createTestProject("Imported Project");
            ProjectSnapshotDto importedSnapshot = createTestSnapshot(importedProject);
            store.setActiveProject(importedProject, importedSnapshot);

            // Then - the imported project replaces the blank
            assertThat(store.getActiveProject()).isPresent();
            assertThat(store.getActiveProject().get()).isEqualTo(importedProject);
            assertThat(store.getActiveProject().get().name()).isEqualTo("Imported Project");

            // And - the snapshot is also replaced
            assertThat(store.getActiveSnapshot()).isPresent();
            assertThat(store.getActiveSnapshot().get()).isEqualTo(importedSnapshot);
        }
    }

    // Helper methods

    private ProjectDto createTestProject(String name) {
        return new ProjectDto(
            UUID.randomUUID(),
            name,
            null,  // projectParentFolder
            null,  // projectHierarchy
            null,  // organisationId
            null,  // repoUrl
            true,  // isActive
            Instant.now(),
            Instant.now()
        );
    }

    private ProjectSnapshotDto createTestSnapshot(ProjectDto project) {
        return new ProjectSnapshotDto(
            null,  // meta
            project,
            null,  // model
            null,  // workItems
            null   // artifacts
        );
    }
}
