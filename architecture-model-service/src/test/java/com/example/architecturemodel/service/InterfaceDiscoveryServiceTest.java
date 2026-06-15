package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.interface_discovery.*;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.*;
import com.example.architecturemodel.repository.relationship.InterfaceLogicalEntityRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.OffsetDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for InterfaceDiscoveryService.
 * Tests the service methods for listing interfaces and retrieving OAS context.
 */
@ExtendWith(MockitoExtension.class)
class InterfaceDiscoveryServiceTest {

    @Mock private ModelFileRepository modelFileRepository;
    @Mock private InterfaceRepository interfaceRepository;
    @Mock private ServiceRepository serviceRepository;
    @Mock private ApplicationRepository applicationRepository;
    @Mock private EndpointRepository endpointRepository;
    @Mock private InterfaceLogicalEntityRepository interfaceLogicalEntityRepository;
    @Mock private LogicalDataEntityRepository logicalDataEntityRepository;
    @Mock private LogicalDataAttributeRepository logicalDataAttributeRepository;

    private InterfaceDiscoveryService service;

    @BeforeEach
    void setUp() {
        service = new InterfaceDiscoveryService(
                modelFileRepository,
                interfaceRepository,
                serviceRepository,
                applicationRepository,
                endpointRepository,
                interfaceLogicalEntityRepository,
                logicalDataEntityRepository,
                logicalDataAttributeRepository
        );
    }

    // ========================================================================
    // Test 1: listInterfaces returns correct interface summaries for a filename
    // ========================================================================

    @Test
    void listInterfaces_returnsCorrectInterfaceSummaries() {
        String filename = "test-model";
        String modelFileId = "mf-1";

        // Setup model file
        ModelFileEntity modelFile = createModelFile(modelFileId, filename);
        when(modelFileRepository.findByFilename(filename)).thenReturn(Optional.of(modelFile));

        // Setup application
        ApplicationEntity app = createApplication("app-1", modelFileId, "Customer Portal");
        when(applicationRepository.findByModelFileId(modelFileId)).thenReturn(List.of(app));

        // Setup service
        ServiceEntity svc = createService("svc-1", modelFileId, "app-1", "Customer Service");
        when(serviceRepository.findByModelFileId(modelFileId)).thenReturn(List.of(svc));

        // Setup interfaces
        InterfaceEntity ifc1 = createInterface("ifc-1", modelFileId, "svc-1", "Customer API", "REST");
        InterfaceEntity ifc2 = createInterface("ifc-2", modelFileId, "svc-1", "Admin API", "SOAP");
        when(interfaceRepository.findByModelFileId(modelFileId)).thenReturn(List.of(ifc1, ifc2));

        // Setup endpoints - 3 for ifc-1, 1 for ifc-2
        List<EndpointEntity> endpoints = List.of(
                createEndpoint("ep-1", modelFileId, "ifc-1", "Get Customer"),
                createEndpoint("ep-2", modelFileId, "ifc-1", "Create Customer"),
                createEndpoint("ep-3", modelFileId, "ifc-1", "Delete Customer"),
                createEndpoint("ep-4", modelFileId, "ifc-2", "Admin Login")
        );
        when(endpointRepository.findByModelFileId(modelFileId)).thenReturn(endpoints);

        // Execute
        List<InterfaceSummaryDto> result = service.listInterfaces(filename);

        // Verify
        assertEquals(2, result.size());

        // Results should be sorted by interfaceId
        InterfaceSummaryDto first = result.get(0);
        assertEquals("ifc-1", first.interfaceId());
        assertEquals("Customer API", first.interfaceName());
        assertEquals("REST", first.interfaceType());
        assertEquals("svc-1", first.serviceId());
        assertEquals("Customer Service", first.serviceName());
        assertEquals("app-1", first.applicationId());
        assertEquals("Customer Portal", first.applicationName());
        assertEquals(3, first.endpointCount());

        InterfaceSummaryDto second = result.get(1);
        assertEquals("ifc-2", second.interfaceId());
        assertEquals("Admin API", second.interfaceName());
        assertEquals("SOAP", second.interfaceType());
        assertEquals(1, second.endpointCount());
    }

    // ========================================================================
    // Test 2: listInterfaces throws ResourceNotFoundException for unknown filename
    // ========================================================================

    @Test
    void listInterfaces_throwsResourceNotFoundExceptionForUnknownFilename() {
        String filename = "nonexistent-model";

        when(modelFileRepository.findByFilename(filename)).thenReturn(Optional.empty());

        ResourceNotFoundException exception = assertThrows(
                ResourceNotFoundException.class,
                () -> service.listInterfaces(filename)
        );

        assertTrue(exception.getMessage().contains("Model file not found"));
        assertTrue(exception.getMessage().contains(filename));
    }

    // ========================================================================
    // Test 3: getInterfaceOasContext returns full context for valid interface ID
    // ========================================================================

    @Test
    void getInterfaceOasContext_returnsFullContextForValidInterfaceId() {
        String interfaceId = "ifc-1";
        String serviceId = "svc-1";
        String appId = "app-1";
        String modelFileId = "mf-1";

        // Setup interface
        InterfaceEntity ifc = createInterface(interfaceId, modelFileId, serviceId, "Customer API", "REST");
        ifc.setDescription("Customer management API");
        ifc.setSpecLink("https://spec.example.com/customer");
        ifc.setTags("customer,api");
        when(interfaceRepository.findById(interfaceId)).thenReturn(Optional.of(ifc));

        // Setup service
        ServiceEntity svc = createService(serviceId, modelFileId, appId, "Customer Service");
        svc.setDescription("Handles customer operations");
        svc.setServiceType("BACKEND");
        when(serviceRepository.findById(serviceId)).thenReturn(Optional.of(svc));

        // Setup application
        ApplicationEntity app = createApplication(appId, modelFileId, "Customer Portal");
        app.setDescription("Main customer application");
        app.setAppType("WEB");
        app.setStatus("ACTIVE");
        when(applicationRepository.findById(appId)).thenReturn(Optional.of(app));

        // Setup endpoints
        EndpointEntity ep1 = createEndpoint("ep-1", modelFileId, interfaceId, "Get Customer");
        ep1.setOperationVerb("GET");
        ep1.setPathOrAddress("/customers/{id}");
        when(endpointRepository.findByInterfaceId(interfaceId)).thenReturn(List.of(ep1));

        // Setup logical entity linkage
        InterfaceLogicalEntityEntity ile = InterfaceLogicalEntityEntity.builder()
                .id("ile-1")
                .modelFileId(modelFileId)
                .interfaceId(interfaceId)
                .dataEntityPointId("dep_log_le-1")
                .build();
        when(interfaceLogicalEntityRepository.findByInterfaceId(interfaceId)).thenReturn(List.of(ile));

        // Setup logical entity
        LogicalDataEntityEntity le = LogicalDataEntityEntity.builder()
                .id("le-1")
                .modelFileId(modelFileId)
                .name("Customer")
                .description("Customer entity")
                .build();
        when(logicalDataEntityRepository.findById("le-1")).thenReturn(Optional.of(le));

        // Setup logical attributes
        LogicalDataAttributeEntity attr1 = LogicalDataAttributeEntity.builder()
                .id("attr-1")
                .modelFileId(modelFileId)
                .logicalEntityId("le-1")
                .name("customerId")
                .dataType("STRING")
                .isPrimaryKey(true)
                .isNullable(false)
                .build();
        when(logicalDataAttributeRepository.findByLogicalEntityId("le-1")).thenReturn(List.of(attr1));

        // Execute
        InterfaceOasContextDto result = service.getInterfaceOasContext(interfaceId);

        // Verify interface detail
        assertNotNull(result.interfaceInfo());
        assertEquals(interfaceId, result.interfaceInfo().id());
        assertEquals("Customer API", result.interfaceInfo().name());
        assertEquals("Customer management API", result.interfaceInfo().description());
        assertEquals("REST", result.interfaceInfo().interfaceType());

        // Verify service detail
        assertNotNull(result.service());
        assertEquals(serviceId, result.service().id());
        assertEquals("Customer Service", result.service().name());
        assertEquals("BACKEND", result.service().serviceType());

        // Verify application detail
        assertNotNull(result.application());
        assertEquals(appId, result.application().id());
        assertEquals("Customer Portal", result.application().name());
        assertEquals("WEB", result.application().appType());
        assertEquals("ACTIVE", result.application().status());

        // Verify endpoints
        assertEquals(1, result.endpoints().size());
        assertEquals("ep-1", result.endpoints().get(0).id());
        assertEquals("GET", result.endpoints().get(0).operationVerb());

        // Verify logical entities
        assertEquals(1, result.logicalEntities().size());
        assertEquals("le-1", result.logicalEntities().get(0).id());
        assertEquals("Customer", result.logicalEntities().get(0).name());

        // Verify attributes
        assertEquals(1, result.logicalEntities().get(0).attributes().size());
        assertEquals("attr-1", result.logicalEntities().get(0).attributes().get(0).id());
        assertEquals("customerId", result.logicalEntities().get(0).attributes().get(0).name());
        assertTrue(result.logicalEntities().get(0).attributes().get(0).isPrimaryKey());

        // Verify notes is null for v1
        assertNull(result.notes());
    }

    // ========================================================================
    // Test 4: getInterfaceOasContext throws ResourceNotFoundException for unknown ID
    // ========================================================================

    @Test
    void getInterfaceOasContext_throwsResourceNotFoundExceptionForUnknownId() {
        String interfaceId = "nonexistent-interface";

        when(interfaceRepository.findById(interfaceId)).thenReturn(Optional.empty());

        ResourceNotFoundException exception = assertThrows(
                ResourceNotFoundException.class,
                () -> service.getInterfaceOasContext(interfaceId)
        );

        assertTrue(exception.getMessage().contains("Interface not found"));
        assertTrue(exception.getMessage().contains(interfaceId));
    }

    // ========================================================================
    // Test 5: Endpoint sorting by (operationVerb, pathOrAddress, name, id)
    // ========================================================================

    @Test
    void getInterfaceOasContext_sortsEndpointsByOperationVerbPathAddressNameId() {
        String interfaceId = "ifc-1";
        String modelFileId = "mf-1";

        // Setup interface (with no service)
        InterfaceEntity ifc = createInterface(interfaceId, modelFileId, null, "Test API", "REST");
        when(interfaceRepository.findById(interfaceId)).thenReturn(Optional.of(ifc));

        // Setup endpoints in random order to test sorting
        // Expected sort order: DELETE /a, DELETE /b, GET /a/1, GET /a/2, GET /b, POST /a
        List<EndpointEntity> endpoints = List.of(
                createEndpointWithDetails("ep-6", modelFileId, interfaceId, "Create Item", "POST", "/a"),
                createEndpointWithDetails("ep-1", modelFileId, interfaceId, "Delete A", "DELETE", "/a"),
                createEndpointWithDetails("ep-4", modelFileId, interfaceId, "Get A2", "GET", "/a/2"),
                createEndpointWithDetails("ep-3", modelFileId, interfaceId, "Get A1", "GET", "/a/1"),
                createEndpointWithDetails("ep-2", modelFileId, interfaceId, "Delete B", "DELETE", "/b"),
                createEndpointWithDetails("ep-5", modelFileId, interfaceId, "Get B", "GET", "/b")
        );
        when(endpointRepository.findByInterfaceId(interfaceId)).thenReturn(endpoints);
        when(interfaceLogicalEntityRepository.findByInterfaceId(interfaceId)).thenReturn(Collections.emptyList());

        // Execute
        InterfaceOasContextDto result = service.getInterfaceOasContext(interfaceId);

        // Verify sorting: operationVerb, then pathOrAddress, then name, then id
        assertEquals(6, result.endpoints().size());

        // DELETE comes before GET and POST
        assertEquals("DELETE", result.endpoints().get(0).operationVerb());
        assertEquals("/a", result.endpoints().get(0).pathOrAddress());
        assertEquals("DELETE", result.endpoints().get(1).operationVerb());
        assertEquals("/b", result.endpoints().get(1).pathOrAddress());

        // GET endpoints sorted by path
        assertEquals("GET", result.endpoints().get(2).operationVerb());
        assertEquals("/a/1", result.endpoints().get(2).pathOrAddress());
        assertEquals("GET", result.endpoints().get(3).operationVerb());
        assertEquals("/a/2", result.endpoints().get(3).pathOrAddress());
        assertEquals("GET", result.endpoints().get(4).operationVerb());
        assertEquals("/b", result.endpoints().get(4).pathOrAddress());

        // POST comes last
        assertEquals("POST", result.endpoints().get(5).operationVerb());
        assertEquals("/a", result.endpoints().get(5).pathOrAddress());
    }

    // ========================================================================
    // Test 6: logicalEntities and attributes sorting by (name, id)
    // ========================================================================

    @Test
    void getInterfaceOasContext_sortsLogicalEntitiesAndAttributesByNameId() {
        String interfaceId = "ifc-1";
        String modelFileId = "mf-1";

        // Setup interface
        InterfaceEntity ifc = createInterface(interfaceId, modelFileId, null, "Test API", "REST");
        when(interfaceRepository.findById(interfaceId)).thenReturn(Optional.of(ifc));
        when(endpointRepository.findByInterfaceId(interfaceId)).thenReturn(Collections.emptyList());

        // Setup logical entity linkages - in random order
        List<InterfaceLogicalEntityEntity> linkages = List.of(
                createInterfaceLogicalEntity("ile-1", modelFileId, interfaceId, "le-3"),
                createInterfaceLogicalEntity("ile-2", modelFileId, interfaceId, "le-1"),
                createInterfaceLogicalEntity("ile-3", modelFileId, interfaceId, "le-2")
        );
        when(interfaceLogicalEntityRepository.findByInterfaceId(interfaceId)).thenReturn(linkages);

        // Setup logical entities with names that will test sorting
        // Expected order by name: Address (le-2), Customer (le-1), Order (le-3)
        LogicalDataEntityEntity le1 = createLogicalEntity("le-1", modelFileId, "Customer");
        LogicalDataEntityEntity le2 = createLogicalEntity("le-2", modelFileId, "Address");
        LogicalDataEntityEntity le3 = createLogicalEntity("le-3", modelFileId, "Order");
        when(logicalDataEntityRepository.findById("le-1")).thenReturn(Optional.of(le1));
        when(logicalDataEntityRepository.findById("le-2")).thenReturn(Optional.of(le2));
        when(logicalDataEntityRepository.findById("le-3")).thenReturn(Optional.of(le3));

        // Setup attributes for le-1 (Customer) in random order
        // Expected order by name: email, id, name
        List<LogicalDataAttributeEntity> customerAttrs = List.of(
                createLogicalAttribute("attr-3", modelFileId, "le-1", "name"),
                createLogicalAttribute("attr-1", modelFileId, "le-1", "id"),
                createLogicalAttribute("attr-2", modelFileId, "le-1", "email")
        );
        when(logicalDataAttributeRepository.findByLogicalEntityId("le-1")).thenReturn(customerAttrs);
        when(logicalDataAttributeRepository.findByLogicalEntityId("le-2")).thenReturn(Collections.emptyList());
        when(logicalDataAttributeRepository.findByLogicalEntityId("le-3")).thenReturn(Collections.emptyList());

        // Execute
        InterfaceOasContextDto result = service.getInterfaceOasContext(interfaceId);

        // Verify logical entities are sorted by name
        assertEquals(3, result.logicalEntities().size());
        assertEquals("Address", result.logicalEntities().get(0).name());
        assertEquals("le-2", result.logicalEntities().get(0).id());
        assertEquals("Customer", result.logicalEntities().get(1).name());
        assertEquals("le-1", result.logicalEntities().get(1).id());
        assertEquals("Order", result.logicalEntities().get(2).name());
        assertEquals("le-3", result.logicalEntities().get(2).id());

        // Verify attributes for Customer entity are sorted by name
        List<LogicalAttributeDto> customerAttributes = result.logicalEntities().get(1).attributes();
        assertEquals(3, customerAttributes.size());
        assertEquals("email", customerAttributes.get(0).name());
        assertEquals("attr-2", customerAttributes.get(0).id());
        assertEquals("id", customerAttributes.get(1).name());
        assertEquals("attr-1", customerAttributes.get(1).id());
        assertEquals("name", customerAttributes.get(2).name());
        assertEquals("attr-3", customerAttributes.get(2).id());
    }

    // ========================================================================
    // Helper Methods
    // ========================================================================

    private ModelFileEntity createModelFile(String id, String filename) {
        return ModelFileEntity.builder()
                .id(id)
                .filename(filename)
                .description("Test model")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .isDefault(false)
                .build();
    }

    private ApplicationEntity createApplication(String id, String modelFileId, String name) {
        return ApplicationEntity.builder()
                .id(id)
                .modelFileId(modelFileId)
                .name(name)
                .build();
    }

    private ServiceEntity createService(String id, String modelFileId, String applicationId, String name) {
        return ServiceEntity.builder()
                .id(id)
                .modelFileId(modelFileId)
                .applicationId(applicationId)
                .name(name)
                .build();
    }

    private InterfaceEntity createInterface(String id, String modelFileId, String serviceId, String name, String type) {
        return InterfaceEntity.builder()
                .id(id)
                .modelFileId(modelFileId)
                .serviceId(serviceId)
                .name(name)
                .interfaceType(type)
                .build();
    }

    private EndpointEntity createEndpoint(String id, String modelFileId, String interfaceId, String name) {
        return EndpointEntity.builder()
                .id(id)
                .modelFileId(modelFileId)
                .interfaceId(interfaceId)
                .name(name)
                .build();
    }

    private EndpointEntity createEndpointWithDetails(String id, String modelFileId, String interfaceId,
                                                      String name, String operationVerb, String pathOrAddress) {
        return EndpointEntity.builder()
                .id(id)
                .modelFileId(modelFileId)
                .interfaceId(interfaceId)
                .name(name)
                .operationVerb(operationVerb)
                .pathOrAddress(pathOrAddress)
                .build();
    }

    private InterfaceLogicalEntityEntity createInterfaceLogicalEntity(String id, String modelFileId,
                                                                       String interfaceId, String logicalEntityId) {
        return InterfaceLogicalEntityEntity.builder()
                .id(id)
                .modelFileId(modelFileId)
                .interfaceId(interfaceId)
                // Canonical data-entity-point id format: dep_log_<logicalEntityId>
                // (see DataEntityPointEnsureService); the service strips the
                // prefix before resolving the logical entity.
                .dataEntityPointId("dep_log_" + logicalEntityId)
                .build();
    }

    private LogicalDataEntityEntity createLogicalEntity(String id, String modelFileId, String name) {
        return LogicalDataEntityEntity.builder()
                .id(id)
                .modelFileId(modelFileId)
                .name(name)
                .build();
    }

    private LogicalDataAttributeEntity createLogicalAttribute(String id, String modelFileId,
                                                               String logicalEntityId, String name) {
        return LogicalDataAttributeEntity.builder()
                .id(id)
                .modelFileId(modelFileId)
                .logicalEntityId(logicalEntityId)
                .name(name)
                .isPrimaryKey(false)
                .isNullable(true)
                .build();
    }
}
