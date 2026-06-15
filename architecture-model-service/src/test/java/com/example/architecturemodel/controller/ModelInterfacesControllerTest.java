package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.interface_discovery.*;
import com.example.architecturemodel.service.InterfaceDiscoveryService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Collections;
import java.util.List;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Unit tests for ModelInterfacesController.
 * Tests the REST API endpoints for interface discovery.
 */
@ExtendWith(MockitoExtension.class)
class ModelInterfacesControllerTest {

    @Mock
    private InterfaceDiscoveryService interfaceDiscoveryService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        ModelInterfacesController controller = new ModelInterfacesController(interfaceDiscoveryService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    /**
     * Test: GET /api/model/interfaces?filename=valid returns 200 with interface list
     */
    @Test
    void listInterfaces_withValidFilename_returns200WithInterfaceList() throws Exception {
        // Arrange
        String filename = "test-model";
        InterfaceSummaryDto summary1 = new InterfaceSummaryDto(
                "ifc-1",
                "Customer API",
                "REST",
                "svc-1",
                "Customer Service",
                "app-1",
                "Customer App",
                5
        );
        InterfaceSummaryDto summary2 = new InterfaceSummaryDto(
                "ifc-2",
                "Order API",
                "REST",
                "svc-2",
                "Order Service",
                "app-1",
                "Customer App",
                3
        );
        List<InterfaceSummaryDto> interfaces = List.of(summary1, summary2);

        when(interfaceDiscoveryService.listInterfaces(filename)).thenReturn(interfaces);

        // Act & Assert
        mockMvc.perform(get("/api/model/interfaces")
                        .param("filename", filename))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].interfaceId").value("ifc-1"))
                .andExpect(jsonPath("$[0].interfaceName").value("Customer API"))
                .andExpect(jsonPath("$[0].interfaceType").value("REST"))
                .andExpect(jsonPath("$[0].serviceId").value("svc-1"))
                .andExpect(jsonPath("$[0].serviceName").value("Customer Service"))
                .andExpect(jsonPath("$[0].applicationId").value("app-1"))
                .andExpect(jsonPath("$[0].applicationName").value("Customer App"))
                .andExpect(jsonPath("$[0].endpointCount").value(5))
                .andExpect(jsonPath("$[1].interfaceId").value("ifc-2"))
                .andExpect(jsonPath("$[1].interfaceName").value("Order API"));
    }

    /**
     * Test: GET /api/model/interfaces without filename returns 400
     */
    @Test
    void listInterfaces_withoutFilename_returns400() throws Exception {
        // Act & Assert
        mockMvc.perform(get("/api/model/interfaces"))
                .andExpect(status().isBadRequest());
    }

    /**
     * Test: GET /api/model/interfaces?filename=unknown returns 404
     */
    @Test
    void listInterfaces_withUnknownFilename_returns404() throws Exception {
        // Arrange
        String filename = "unknown-model";
        when(interfaceDiscoveryService.listInterfaces(filename))
                .thenThrow(new ResourceNotFoundException("Model file not found: " + filename));

        // Act & Assert
        mockMvc.perform(get("/api/model/interfaces")
                        .param("filename", filename))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("Model file not found: " + filename));
    }

    /**
     * Test: GET /api/model/interfaces/{id} with valid ID returns 200 with full context
     */
    @Test
    void getInterfaceOasContext_withValidId_returns200WithFullContext() throws Exception {
        // Arrange
        String interfaceId = "ifc-123";

        InterfaceDetailDto interfaceDetail = new InterfaceDetailDto(
                interfaceId,
                "Customer API",
                "API for customer operations",
                "REST",
                "https://spec.example.com/customer",
                "customer,api",
                "2024-01-01",
                null
        );

        ServiceDetailDto serviceDetail = new ServiceDetailDto(
                "svc-1",
                "Customer Service",
                "Service handling customer data",
                "Backend",
                "core,customer"
        );

        ApplicationDetailDto applicationDetail = new ApplicationDetailDto(
                "app-1",
                "Customer Application",
                "Main customer application",
                "WebApp",
                "Active",
                "production"
        );

        InterfaceEndpointDto endpoint = new InterfaceEndpointDto(
                "ep-1",
                "Get Customer",
                "Retrieves customer by ID",
                "Operation",
                "/customers/{id}",
                "HTTP",
                "GET",
                "Inbound",
                "Active",
                "v1",
                "read",
                "2024-01-01"
        );

        LogicalAttributeDto attribute = new LogicalAttributeDto(
                "attr-1",
                "customerId",
                "The unique customer identifier",
                "String",
                true,
                false,
                "pk"
        );

        LogicalEntitySchemaDto logicalEntity = new LogicalEntitySchemaDto(
                "le-1",
                "Customer",
                "Customer entity",
                "domain",
                "2024-01-01",
                null,
                List.of(attribute)
        );

        InterfaceOasContextDto context = new InterfaceOasContextDto(
                interfaceDetail,
                serviceDetail,
                applicationDetail,
                List.of(endpoint),
                List.of(logicalEntity),
                null  // notes is null for v1
        );

        when(interfaceDiscoveryService.getInterfaceOasContext(interfaceId)).thenReturn(context);

        // Act & Assert
        mockMvc.perform(get("/api/model/interfaces/{id}", interfaceId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.interface.id").value(interfaceId))
                .andExpect(jsonPath("$.interface.name").value("Customer API"))
                .andExpect(jsonPath("$.interface.description").value("API for customer operations"))
                .andExpect(jsonPath("$.interface.interfaceType").value("REST"))
                .andExpect(jsonPath("$.service.id").value("svc-1"))
                .andExpect(jsonPath("$.service.name").value("Customer Service"))
                .andExpect(jsonPath("$.application.id").value("app-1"))
                .andExpect(jsonPath("$.application.name").value("Customer Application"))
                .andExpect(jsonPath("$.endpoints").isArray())
                .andExpect(jsonPath("$.endpoints.length()").value(1))
                .andExpect(jsonPath("$.endpoints[0].id").value("ep-1"))
                .andExpect(jsonPath("$.endpoints[0].name").value("Get Customer"))
                .andExpect(jsonPath("$.endpoints[0].pathOrAddress").value("/customers/{id}"))
                .andExpect(jsonPath("$.endpoints[0].operationVerb").value("GET"))
                .andExpect(jsonPath("$.logicalEntities").isArray())
                .andExpect(jsonPath("$.logicalEntities.length()").value(1))
                .andExpect(jsonPath("$.logicalEntities[0].id").value("le-1"))
                .andExpect(jsonPath("$.logicalEntities[0].name").value("Customer"))
                .andExpect(jsonPath("$.logicalEntities[0].attributes").isArray())
                .andExpect(jsonPath("$.logicalEntities[0].attributes.length()").value(1))
                .andExpect(jsonPath("$.logicalEntities[0].attributes[0].name").value("customerId"))
                .andExpect(jsonPath("$.notes").doesNotExist());
    }

    /**
     * Test: GET /api/model/interfaces/{id} with unknown ID returns 404
     */
    @Test
    void getInterfaceOasContext_withUnknownId_returns404() throws Exception {
        // Arrange
        String interfaceId = "unknown-id";
        when(interfaceDiscoveryService.getInterfaceOasContext(interfaceId))
                .thenThrow(new ResourceNotFoundException("Interface not found: " + interfaceId));

        // Act & Assert
        mockMvc.perform(get("/api/model/interfaces/{id}", interfaceId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("Interface not found: " + interfaceId));
    }

    /**
     * Test: GET /api/model/interfaces/{id} with blank ID returns 400
     */
    @Test
    void getInterfaceOasContext_withBlankId_returns400() throws Exception {
        // Act & Assert - using space as blank ID (Spring will trim path variables)
        mockMvc.perform(get("/api/model/interfaces/{id}", " "))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Interface ID is required"));
    }
}
