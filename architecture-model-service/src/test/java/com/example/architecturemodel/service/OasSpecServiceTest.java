package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.oas.SaveOasSpecRequestDto;
import com.example.architecturemodel.model.dto.oas.SaveOasSpecSummaryDto;
import com.example.architecturemodel.model.entity.InterfaceEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.InterfaceRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for OasSpecService.
 * Tests validation, content parsing, file operations, and database updates.
 */
class OasSpecServiceTest {

    @TempDir
    Path tempDir;

    private InterfaceRepository interfaceRepository;
    private ModelFileRepository modelFileRepository;
    private ObjectMapper objectMapper;
    private OasSpecService oasSpecService;

    private static final String VALID_YAML = """
            openapi: 3.0.3
            info:
              title: Test API
              version: 1.0.0
            paths: {}
            """;

    private static final String VALID_JSON = """
            {
              "openapi": "3.0.3",
              "info": {
                "title": "Test API",
                "version": "1.0.0"
              },
              "paths": {}
            }
            """;

    @BeforeEach
    void setUp() {
        interfaceRepository = mock(InterfaceRepository.class);
        modelFileRepository = mock(ModelFileRepository.class);
        objectMapper = new ObjectMapper();

        oasSpecService = new OasSpecService(
                interfaceRepository,
                modelFileRepository,
                objectMapper,
                tempDir.toString(),
                2097152L // 2MB
        );
    }

    /**
     * Test 1: Successful YAML save (new file -> created=true)
     */
    @Test
    void testSuccessfulYamlSaveNewFile() {
        // Setup
        String interfaceId = "ifc-001";
        String filename = "my-architecture.json";

        InterfaceEntity interfaceEntity = createInterfaceEntity(interfaceId, "Customer API");
        ModelFileEntity modelFile = createModelFileEntity(filename);

        when(interfaceRepository.findById(interfaceId)).thenReturn(Optional.of(interfaceEntity));
        when(modelFileRepository.findByFilename(filename)).thenReturn(Optional.of(modelFile));
        when(interfaceRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        SaveOasSpecRequestDto request = new SaveOasSpecRequestDto("yaml", VALID_YAML, "Test API", "1.0.0");

        // Execute
        SaveOasSpecSummaryDto result = oasSpecService.saveOasSpec(interfaceId, filename, request);

        // Verify
        assertNotNull(result);
        assertEquals(interfaceId, result.interfaceId());
        assertEquals("Customer API", result.interfaceName());
        assertEquals(filename, result.architectureFilename());
        assertEquals("yaml", result.format());
        assertTrue(result.created(), "Should be created=true for new file");
        assertTrue(result.savedPath().endsWith(".yml"));
        assertNotNull(result.updatedAt());

        // Verify file was created
        Path expectedFile = tempDir.resolve("my-architecture.json").resolve("Customer API.yml");
        assertTrue(Files.exists(expectedFile), "File should exist on disk");

        // Verify interface was updated
        ArgumentCaptor<InterfaceEntity> captor = ArgumentCaptor.forClass(InterfaceEntity.class);
        verify(interfaceRepository).save(captor.capture());
        assertNotNull(captor.getValue().getSpecLink());
    }

    /**
     * Test 2: Successful JSON save
     */
    @Test
    void testSuccessfulJsonSave() {
        // Setup
        String interfaceId = "ifc-002";
        String filename = "order-model.json";

        InterfaceEntity interfaceEntity = createInterfaceEntity(interfaceId, "Order API");
        ModelFileEntity modelFile = createModelFileEntity(filename);

        when(interfaceRepository.findById(interfaceId)).thenReturn(Optional.of(interfaceEntity));
        when(modelFileRepository.findByFilename(filename)).thenReturn(Optional.of(modelFile));
        when(interfaceRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        SaveOasSpecRequestDto request = new SaveOasSpecRequestDto("json", VALID_JSON, null, null);

        // Execute
        SaveOasSpecSummaryDto result = oasSpecService.saveOasSpec(interfaceId, filename, request);

        // Verify
        assertNotNull(result);
        assertEquals("json", result.format());
        assertTrue(result.savedPath().endsWith(".json"));
        assertTrue(result.created());

        // Verify file was created
        Path expectedFile = tempDir.resolve("order-model.json").resolve("Order API.json");
        assertTrue(Files.exists(expectedFile));
    }

    /**
     * Test 3: Overwrite existing file (created=false)
     */
    @Test
    void testOverwriteExistingFile() throws Exception {
        // Setup
        String interfaceId = "ifc-003";
        String filename = "existing-model.json";

        InterfaceEntity interfaceEntity = createInterfaceEntity(interfaceId, "Existing API");
        ModelFileEntity modelFile = createModelFileEntity(filename);

        when(interfaceRepository.findById(interfaceId)).thenReturn(Optional.of(interfaceEntity));
        when(modelFileRepository.findByFilename(filename)).thenReturn(Optional.of(modelFile));
        when(interfaceRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        // Create existing file
        Path existingDir = tempDir.resolve("existing-model.json");
        Files.createDirectories(existingDir);
        Path existingFile = existingDir.resolve("Existing API.yml");
        Files.writeString(existingFile, "old content");

        SaveOasSpecRequestDto request = new SaveOasSpecRequestDto("yaml", VALID_YAML, null, null);

        // Execute
        SaveOasSpecSummaryDto result = oasSpecService.saveOasSpec(interfaceId, filename, request);

        // Verify
        assertFalse(result.created(), "Should be created=false for overwrite");

        // Verify content was updated
        String newContent = Files.readString(existingFile);
        assertTrue(newContent.contains("openapi: 3.0.3"));
    }

    /**
     * Test 4: Invalid YAML content returns 400
     */
    @Test
    void testInvalidYamlContentReturns400() {
        // Setup
        String interfaceId = "ifc-004";
        String filename = "test-model.json";

        InterfaceEntity interfaceEntity = createInterfaceEntity(interfaceId, "Test API");
        ModelFileEntity modelFile = createModelFileEntity(filename);

        when(interfaceRepository.findById(interfaceId)).thenReturn(Optional.of(interfaceEntity));
        when(modelFileRepository.findByFilename(filename)).thenReturn(Optional.of(modelFile));

        // Invalid YAML (unbalanced brackets)
        String invalidYaml = """
                openapi: 3.0.3
                info:
                  title: [unbalanced
                """;
        SaveOasSpecRequestDto request = new SaveOasSpecRequestDto("yaml", invalidYaml, null, null);

        // Execute and verify
        IllegalArgumentException ex = assertThrows(
                IllegalArgumentException.class,
                () -> oasSpecService.saveOasSpec(interfaceId, filename, request)
        );
        assertTrue(ex.getMessage().contains("Invalid YAML syntax"));
    }

    /**
     * Test 5: Invalid JSON content returns 400
     */
    @Test
    void testInvalidJsonContentReturns400() {
        // Setup
        String interfaceId = "ifc-005";
        String filename = "test-model.json";

        InterfaceEntity interfaceEntity = createInterfaceEntity(interfaceId, "Test API");
        ModelFileEntity modelFile = createModelFileEntity(filename);

        when(interfaceRepository.findById(interfaceId)).thenReturn(Optional.of(interfaceEntity));
        when(modelFileRepository.findByFilename(filename)).thenReturn(Optional.of(modelFile));

        // Invalid JSON
        String invalidJson = "{ \"openapi\": \"3.0.3\", invalid }";
        SaveOasSpecRequestDto request = new SaveOasSpecRequestDto("json", invalidJson, null, null);

        // Execute and verify
        IllegalArgumentException ex = assertThrows(
                IllegalArgumentException.class,
                () -> oasSpecService.saveOasSpec(interfaceId, filename, request)
        );
        assertTrue(ex.getMessage().contains("Invalid JSON syntax"));
    }

    /**
     * Test 6: Content exceeds maxBytes returns 400
     */
    @Test
    void testContentExceedsMaxBytesReturns400() {
        // Create service with very small maxBytes limit (smaller than VALID_YAML)
        OasSpecService limitedService = new OasSpecService(
                interfaceRepository,
                modelFileRepository,
                objectMapper,
                tempDir.toString(),
                50L // 50 bytes limit - VALID_YAML is ~66 bytes
        );

        String interfaceId = "ifc-006";
        String filename = "test-model.json";

        // Content larger than 50 bytes
        SaveOasSpecRequestDto request = new SaveOasSpecRequestDto("yaml", VALID_YAML, null, null);

        // Execute and verify
        IllegalArgumentException ex = assertThrows(
                IllegalArgumentException.class,
                () -> limitedService.saveOasSpec(interfaceId, filename, request)
        );
        assertTrue(ex.getMessage().contains("exceeds maximum allowed size"));
    }

    /**
     * Test 7: Interface not found returns 404
     */
    @Test
    void testInterfaceNotFoundReturns404() {
        // Setup
        String interfaceId = "nonexistent-ifc";
        String filename = "test-model.json";

        when(interfaceRepository.findById(interfaceId)).thenReturn(Optional.empty());

        SaveOasSpecRequestDto request = new SaveOasSpecRequestDto("yaml", VALID_YAML, null, null);

        // Execute and verify
        ResourceNotFoundException ex = assertThrows(
                ResourceNotFoundException.class,
                () -> oasSpecService.saveOasSpec(interfaceId, filename, request)
        );
        assertTrue(ex.getMessage().contains("Interface not found"));
    }

    /**
     * Test 8: Filename not found in model_files returns 404
     */
    @Test
    void testFilenameNotFoundReturns404() {
        // Setup
        String interfaceId = "ifc-008";
        String filename = "nonexistent-file.json";

        InterfaceEntity interfaceEntity = createInterfaceEntity(interfaceId, "Test API");

        when(interfaceRepository.findById(interfaceId)).thenReturn(Optional.of(interfaceEntity));
        when(modelFileRepository.findByFilename(filename)).thenReturn(Optional.empty());

        SaveOasSpecRequestDto request = new SaveOasSpecRequestDto("yaml", VALID_YAML, null, null);

        // Execute and verify
        ResourceNotFoundException ex = assertThrows(
                ResourceNotFoundException.class,
                () -> oasSpecService.saveOasSpec(interfaceId, filename, request)
        );
        assertTrue(ex.getMessage().contains("Model file not found"));
    }

    /**
     * Test: Invalid format returns 400
     */
    @Test
    void testInvalidFormatReturns400() {
        SaveOasSpecRequestDto request = new SaveOasSpecRequestDto("xml", VALID_YAML, null, null);

        IllegalArgumentException ex = assertThrows(
                IllegalArgumentException.class,
                () -> oasSpecService.saveOasSpec("ifc-001", "test.json", request)
        );
        assertTrue(ex.getMessage().contains("Format must be 'yaml' or 'json'"));
    }

    /**
     * Test: Missing format returns 400
     */
    @Test
    void testMissingFormatReturns400() {
        SaveOasSpecRequestDto request = new SaveOasSpecRequestDto(null, VALID_YAML, null, null);

        IllegalArgumentException ex = assertThrows(
                IllegalArgumentException.class,
                () -> oasSpecService.saveOasSpec("ifc-001", "test.json", request)
        );
        assertTrue(ex.getMessage().contains("Format is required"));
    }

    /**
     * Test: Missing contents returns 400
     */
    @Test
    void testMissingContentsReturns400() {
        SaveOasSpecRequestDto request = new SaveOasSpecRequestDto("yaml", null, null, null);

        IllegalArgumentException ex = assertThrows(
                IllegalArgumentException.class,
                () -> oasSpecService.saveOasSpec("ifc-001", "test.json", request)
        );
        assertTrue(ex.getMessage().contains("Contents is required"));
    }

    // Helper methods

    private InterfaceEntity createInterfaceEntity(String id, String name) {
        InterfaceEntity entity = new InterfaceEntity();
        entity.setId(id);
        entity.setName(name);
        entity.setModelFileId("model-file-001");
        entity.setServiceId("service-001");
        return entity;
    }

    private ModelFileEntity createModelFileEntity(String filename) {
        ModelFileEntity entity = new ModelFileEntity();
        entity.setId("model-file-001");
        entity.setFilename(filename);
        return entity;
    }
}
