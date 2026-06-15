package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.bookofwork.BookOfWorkUploadResultDto;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.model.parser.EpicNode;
import com.example.architecturemodel.model.parser.FeatureNode;
import com.example.architecturemodel.model.parser.InitiativeNode;
import com.example.architecturemodel.model.parser.StoryNode;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import com.example.architecturemodel.util.BookOfWorkParser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for BookOfWorkUploadService.
 *
 * Spec 2026-01-10: Upload Book of Work from Markdown
 * Task Group 2.1: Tests for BookOfWorkUploadService functionality
 */
@ExtendWith(MockitoExtension.class)
class BookOfWorkUploadServiceTest {

    @Mock
    private WorkItemRepository workItemRepository;

    @Mock
    private BookOfWorkParser bookOfWorkParser;

    @Mock
    private ProjectRepository projectRepository;

    @InjectMocks
    private BookOfWorkUploadService service;

    @Captor
    private ArgumentCaptor<WorkItemEntity> workItemCaptor;

    private static final UUID PROJECT_ID = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        // Setup default project existence check (lenient: the non-existent-project
        // test never touches this stub under strict stubbing)
        lenient().when(projectRepository.existsById(PROJECT_ID)).thenReturn(true);
    }

    @Test
    @DisplayName("Successful upload creates all work items with correct types and parent relationships")
    void testSuccessfulUploadCreatesWorkItemsWithCorrectTypesAndParents() {
        // Given: A markdown with complete hierarchy
        String markdown = "## Initiative\n### Epic\n#### Feature\n##### Story";

        // Mock parser to return hierarchy
        UUID initId = UUID.randomUUID();
        UUID epicId = UUID.randomUUID();
        UUID featureId = UUID.randomUUID();
        UUID storyId = UUID.randomUUID();

        StoryNode story = StoryNode.builder()
                .title("Story")
                .normalizedTitle("story")
                .computedId(storyId)
                .sortOrder(0)
                .build();

        FeatureNode feature = FeatureNode.builder()
                .title("Feature")
                .normalizedTitle("feature")
                .computedId(featureId)
                .sortOrder(0)
                .stories(List.of(story))
                .build();

        EpicNode epic = EpicNode.builder()
                .title("Epic")
                .normalizedTitle("epic")
                .computedId(epicId)
                .sortOrder(0)
                .features(List.of(feature))
                .build();

        InitiativeNode initiative = InitiativeNode.builder()
                .title("Initiative")
                .normalizedTitle("initiative")
                .computedId(initId)
                .sortOrder(0)
                .epics(List.of(epic))
                .build();

        when(bookOfWorkParser.parse(eq(markdown), eq(PROJECT_ID.toString()))).thenReturn(List.of(initiative));
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(inv -> inv.getArgument(0));

        // When
        BookOfWorkUploadResultDto result = service.uploadBookOfWork(PROJECT_ID, markdown);

        // Then
        assertThat(result.projectId()).isEqualTo(PROJECT_ID);
        assertThat(result.workItems()).hasSize(4);

        // Verify save was called 4 times
        verify(workItemRepository, times(4)).save(workItemCaptor.capture());

        List<WorkItemEntity> savedItems = workItemCaptor.getAllValues();

        // Check types
        assertThat(savedItems).extracting(WorkItemEntity::getType)
                .containsExactly("INITIATIVE", "EPIC", "FEATURE", "STORY");

        // Check parent relationships
        WorkItemEntity savedInit = savedItems.get(0);
        WorkItemEntity savedEpic = savedItems.get(1);
        WorkItemEntity savedFeature = savedItems.get(2);
        WorkItemEntity savedStory = savedItems.get(3);

        assertThat(savedInit.getParentId()).isNull();
        assertThat(savedEpic.getParentId()).isEqualTo(initId);
        assertThat(savedFeature.getParentId()).isEqualTo(epicId);
        assertThat(savedStory.getParentId()).isEqualTo(featureId);
    }

    @Test
    @DisplayName("Destructive sync deletes existing work items before inserting new ones")
    void testDestructiveSyncDeletesExistingWorkItems() {
        // Given
        String markdown = "## New Initiative";

        UUID initId = UUID.randomUUID();
        InitiativeNode initiative = InitiativeNode.builder()
                .title("New Initiative")
                .normalizedTitle("new initiative")
                .computedId(initId)
                .sortOrder(0)
                .epics(new ArrayList<>())
                .build();

        when(bookOfWorkParser.parse(eq(markdown), eq(PROJECT_ID.toString()))).thenReturn(List.of(initiative));
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(inv -> inv.getArgument(0));

        // When
        service.uploadBookOfWork(PROJECT_ID, markdown);

        // Then: Verify deleteByProjectId was called BEFORE save
        var inOrder = inOrder(workItemRepository);
        inOrder.verify(workItemRepository).deleteByProjectId(PROJECT_ID);
        inOrder.verify(workItemRepository).save(any(WorkItemEntity.class));
    }

    @Test
    @DisplayName("All imported items have status PLANNED")
    void testAllImportedItemsHaveStatusPlanned() {
        // Given
        String markdown = "## Initiative\n### Epic";

        UUID initId = UUID.randomUUID();
        UUID epicId = UUID.randomUUID();

        EpicNode epic = EpicNode.builder()
                .title("Epic")
                .normalizedTitle("epic")
                .computedId(epicId)
                .sortOrder(0)
                .features(new ArrayList<>())
                .build();

        InitiativeNode initiative = InitiativeNode.builder()
                .title("Initiative")
                .normalizedTitle("initiative")
                .computedId(initId)
                .sortOrder(0)
                .epics(List.of(epic))
                .build();

        when(bookOfWorkParser.parse(eq(markdown), eq(PROJECT_ID.toString()))).thenReturn(List.of(initiative));
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(inv -> inv.getArgument(0));

        // When
        service.uploadBookOfWork(PROJECT_ID, markdown);

        // Then
        verify(workItemRepository, times(2)).save(workItemCaptor.capture());
        List<WorkItemEntity> savedItems = workItemCaptor.getAllValues();

        assertThat(savedItems).allSatisfy(item ->
            assertThat(item.getStatus()).isEqualTo("PLANNED")
        );
    }

    @Test
    @DisplayName("Import returns correct counts for initiatives, epics, features, and stories")
    void testImportReturnsCorrectCounts() {
        // Given: 2 initiatives, 3 epics, 2 features, 1 story
        String markdown = "## Init1\n### Epic1\n### Epic2\n## Init2\n### Epic3\n#### Feature1\n##### Story1\n#### Feature2";

        // Build the hierarchy
        StoryNode story = StoryNode.builder()
                .title("Story1").normalizedTitle("story1").computedId(UUID.randomUUID()).sortOrder(0).build();

        FeatureNode feature1 = FeatureNode.builder()
                .title("Feature1").normalizedTitle("feature1").computedId(UUID.randomUUID()).sortOrder(0)
                .stories(List.of(story)).build();

        FeatureNode feature2 = FeatureNode.builder()
                .title("Feature2").normalizedTitle("feature2").computedId(UUID.randomUUID()).sortOrder(1)
                .stories(new ArrayList<>()).build();

        EpicNode epic1 = EpicNode.builder()
                .title("Epic1").normalizedTitle("epic1").computedId(UUID.randomUUID()).sortOrder(0)
                .features(new ArrayList<>()).build();

        EpicNode epic2 = EpicNode.builder()
                .title("Epic2").normalizedTitle("epic2").computedId(UUID.randomUUID()).sortOrder(1)
                .features(new ArrayList<>()).build();

        EpicNode epic3 = EpicNode.builder()
                .title("Epic3").normalizedTitle("epic3").computedId(UUID.randomUUID()).sortOrder(0)
                .features(List.of(feature1, feature2)).build();

        InitiativeNode init1 = InitiativeNode.builder()
                .title("Init1").normalizedTitle("init1").computedId(UUID.randomUUID()).sortOrder(0)
                .epics(List.of(epic1, epic2)).build();

        InitiativeNode init2 = InitiativeNode.builder()
                .title("Init2").normalizedTitle("init2").computedId(UUID.randomUUID()).sortOrder(1)
                .epics(List.of(epic3)).build();

        when(bookOfWorkParser.parse(anyString(), eq(PROJECT_ID.toString()))).thenReturn(List.of(init1, init2));
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(inv -> inv.getArgument(0));

        // When
        BookOfWorkUploadResultDto result = service.uploadBookOfWork(PROJECT_ID, markdown);

        // Then
        assertThat(result.importSummary().initiativesCreated()).isEqualTo(2);
        assertThat(result.importSummary().epicsCreated()).isEqualTo(3);
        assertThat(result.importSummary().featuresCreated()).isEqualTo(2);
        assertThat(result.importSummary().storiesCreated()).isEqualTo(1);
        assertThat(result.importSummary().totalCreated()).isEqualTo(8);
    }

    @Test
    @DisplayName("Validation rejects empty content")
    void testValidationRejectsEmptyContent() {
        // Given
        String emptyMarkdown = "";

        when(bookOfWorkParser.parse(eq(emptyMarkdown), eq(PROJECT_ID.toString())))
                .thenThrow(new IllegalArgumentException("No valid headings (H2-H5) found in the Book of Work file."));

        // When/Then
        assertThatThrownBy(() -> service.uploadBookOfWork(PROJECT_ID, emptyMarkdown))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("No valid headings");

        // Verify no deletes or saves happened
        verify(workItemRepository, never()).deleteByProjectId(any(UUID.class));
        verify(workItemRepository, never()).save(any());
    }

    @Test
    @DisplayName("Upload fails for non-existent project with 404")
    void testUploadFailsForNonExistentProject() {
        // Given
        UUID nonExistentProjectId = UUID.randomUUID();
        when(projectRepository.existsById(nonExistentProjectId)).thenReturn(false);

        // When/Then
        assertThatThrownBy(() -> service.uploadBookOfWork(nonExistentProjectId, "## Initiative"))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Project not found");

        // Verify no deletes or saves happened
        verify(workItemRepository, never()).deleteByProjectId(any(UUID.class));
        verify(workItemRepository, never()).save(any());
    }
}
