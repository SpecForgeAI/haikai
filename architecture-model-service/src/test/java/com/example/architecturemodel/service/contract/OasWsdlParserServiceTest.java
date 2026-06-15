package com.example.architecturemodel.service.contract;

import com.example.architecturemodel.model.dto.migration.ContractFormat;
import com.example.architecturemodel.model.dto.migration.OasWsdlParseResult;
import com.example.architecturemodel.model.dto.migration.OasWsdlParsedOperation;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Contract-level coverage for {@link OasWsdlParserService}.
 *
 * <p>Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 2.</p>
 *
 * <p>Inline byte literals only -- no external sample files (per spec brief
 * "minimal inline byte literals"). Tests focus on the parser-contract
 * surface (operation extraction, service-name extraction, never-throws on
 * malformed input) and intentionally leave per-library edge-case coverage
 * to the library authors.</p>
 *
 * <p>Task Group 9 added the WSDL 2.0 happy-path test that was deferred in
 * Task Group 2. The detector + parser dispatch branch is exercised
 * end-to-end with a minimal inline WSDL 2.0 description (about 30 lines).</p>
 */
class OasWsdlParserServiceTest {

    private final OasWsdlParserService parser = new OasWsdlParserService();

    @Test
    @DisplayName("OAS 3.0: extracts two operations + suggested service name from info.title")
    void parsesOas30() {
        // Tiny inline OAS 3.0 with two operations on the same path. One uses
        // operationId (preferred identifier), the other has no operationId
        // so the parser should fall back to lowercased(method + ' ' + path).
        String yaml = """
            openapi: 3.0.3
            info:
              title: Order API
              version: "1.0"
            paths:
              /orders:
                get:
                  operationId: listOrders
                  responses:
                    '200':
                      description: ok
                post:
                  responses:
                    '201':
                      description: created
            """;

        OasWsdlParseResult result = parser.parse(
            yaml.getBytes(StandardCharsets.UTF_8),
            ContractFormat.OAS_3_0,
            "orders.yaml",
            (long) yaml.length()
        );

        assertThat(result.status()).isEqualTo(OasWsdlParseResult.Status.PARSED);
        assertThat(result.failureReason()).isNull();
        assertThat(result.fileName()).isEqualTo("orders.yaml");
        assertThat(result.format()).isEqualTo(ContractFormat.OAS_3_0);

        // info.title -> lowercased + trimmed.
        assertThat(result.suggestedServiceName()).isEqualTo("order api");

        // Two operations expected:
        //   - operationId 'listOrders' -> 'listorders'
        //   - POST without operationId -> 'post /orders'
        List<String> identifiers = result.operations().stream()
            .map(OasWsdlParsedOperation::identifier)
            .toList();
        assertThat(identifiers).containsExactlyInAnyOrder("listorders", "post /orders");
    }

    @Test
    @DisplayName("WSDL 1.1: extracts operations + service name from a tiny inline document")
    void parsesWsdl11() {
        // Minimal WSDL 1.1 with one portType holding two operations and one
        // service referencing a port + binding. wsdl4j tolerates the
        // un-prefixed-element style provided the namespace URI is right.
        String wsdl = """
            <?xml version="1.0" encoding="UTF-8"?>
            <wsdl:definitions
                xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
                xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
                xmlns:tns="http://example.com/orders"
                targetNamespace="http://example.com/orders">
              <wsdl:message name="EmptyIn"/>
              <wsdl:message name="EmptyOut"/>
              <wsdl:portType name="OrdersPortType">
                <wsdl:operation name="ListOrders">
                  <wsdl:input message="tns:EmptyIn"/>
                  <wsdl:output message="tns:EmptyOut"/>
                </wsdl:operation>
                <wsdl:operation name="CreateOrder">
                  <wsdl:input message="tns:EmptyIn"/>
                  <wsdl:output message="tns:EmptyOut"/>
                </wsdl:operation>
              </wsdl:portType>
              <wsdl:binding name="OrdersBinding" type="tns:OrdersPortType">
                <soap:binding transport="http://schemas.xmlsoap.org/soap/http"/>
                <wsdl:operation name="ListOrders">
                  <soap:operation soapAction="listOrders"/>
                  <wsdl:input><soap:body use="literal"/></wsdl:input>
                  <wsdl:output><soap:body use="literal"/></wsdl:output>
                </wsdl:operation>
                <wsdl:operation name="CreateOrder">
                  <soap:operation soapAction="createOrder"/>
                  <wsdl:input><soap:body use="literal"/></wsdl:input>
                  <wsdl:output><soap:body use="literal"/></wsdl:output>
                </wsdl:operation>
              </wsdl:binding>
              <wsdl:service name="OrdersService">
                <wsdl:port name="OrdersPort" binding="tns:OrdersBinding">
                  <soap:address location="http://example.com/orders"/>
                </wsdl:port>
              </wsdl:service>
            </wsdl:definitions>
            """;

        OasWsdlParseResult result = parser.parse(
            wsdl.getBytes(StandardCharsets.UTF_8),
            ContractFormat.WSDL_1_1,
            "orders.wsdl",
            (long) wsdl.length()
        );

        assertThat(result.status()).isEqualTo(OasWsdlParseResult.Status.PARSED);
        assertThat(result.failureReason()).isNull();
        assertThat(result.format()).isEqualTo(ContractFormat.WSDL_1_1);
        assertThat(result.suggestedServiceName()).isEqualTo("ordersservice");

        List<String> identifiers = result.operations().stream()
            .map(OasWsdlParsedOperation::identifier)
            .toList();
        assertThat(identifiers).containsExactlyInAnyOrder("listorders", "createorder");
    }

    @Test
    @DisplayName("WSDL 2.0 (Task Group 9 deferred-test catch-up): extracts operations + service name from a tiny inline description")
    void parsesWsdl20() {
        // Minimal WSDL 2.0 with one <interface> holding two <operation>s and
        // one <service> referencing it. The parser's WSDL 2.0 path uses a
        // DOM read of //service/@name and //interface/operation/@name so the
        // namespace-aware lookup must match http://www.w3.org/ns/wsdl.
        //
        // ~30 lines of inline XML -- minimal but enough to exercise:
        //   1. <service name="..."> service-name extraction
        //   2. iteration over multiple <operation name="..."> children under
        //      a single <interface>
        //   3. lowercase + trim normalisation applied to both
        String wsdl = """
            <?xml version="1.0" encoding="UTF-8"?>
            <description
                xmlns="http://www.w3.org/ns/wsdl"
                xmlns:tns="http://example.com/inventory"
                targetNamespace="http://example.com/inventory">
              <interface name="InventoryInterface">
                <operation name="GetStock"
                    pattern="http://www.w3.org/ns/wsdl/in-out"/>
                <operation name="UpdateStock"
                    pattern="http://www.w3.org/ns/wsdl/in-out"/>
              </interface>
              <binding name="InventoryBinding"
                       interface="tns:InventoryInterface"
                       type="http://www.w3.org/ns/wsdl/soap"/>
              <service name="InventoryService"
                       interface="tns:InventoryInterface">
                <endpoint name="InventoryEndpoint"
                          binding="tns:InventoryBinding"
                          address="http://example.com/inventory"/>
              </service>
            </description>
            """;

        OasWsdlParseResult result = parser.parse(
            wsdl.getBytes(StandardCharsets.UTF_8),
            ContractFormat.WSDL_2_0,
            "inventory-2.0.wsdl",
            (long) wsdl.length()
        );

        assertThat(result.status()).isEqualTo(OasWsdlParseResult.Status.PARSED);
        assertThat(result.failureReason()).isNull();
        assertThat(result.format()).isEqualTo(ContractFormat.WSDL_2_0);

        // <service name="InventoryService"> -> lowercased + trimmed.
        assertThat(result.suggestedServiceName()).isEqualTo("inventoryservice");

        // Both operations under <interface> lowercased + trimmed.
        List<String> identifiers = result.operations().stream()
            .map(OasWsdlParsedOperation::identifier)
            .toList();
        assertThat(identifiers).containsExactlyInAnyOrder("getstock", "updatestock");
    }

    @Test
    @DisplayName("malformed input: status=FAILED with non-empty reason, never throws")
    void malformedReturnsFailedWithoutThrowing() {
        // Garbage that the OAS parser will refuse.
        byte[] garbage = "{ not valid openapi at all".getBytes(StandardCharsets.UTF_8);
        OasWsdlParseResult oasResult = parser.parse(garbage, ContractFormat.OAS_3_0, "bad.json", (long) garbage.length);

        assertThat(oasResult.status()).isEqualTo(OasWsdlParseResult.Status.FAILED);
        assertThat(oasResult.failureReason()).isNotBlank();
        assertThat(oasResult.operations()).isEmpty();

        // Garbage XML the WSDL 1.1 reader will refuse.
        byte[] badXml = "<not-wsdl/>".getBytes(StandardCharsets.UTF_8);
        OasWsdlParseResult wsdlResult = parser.parse(badXml, ContractFormat.WSDL_1_1, "bad.wsdl", (long) badXml.length);

        assertThat(wsdlResult.status()).isEqualTo(OasWsdlParseResult.Status.FAILED);
        assertThat(wsdlResult.failureReason()).isNotBlank();
        assertThat(wsdlResult.operations()).isEmpty();
    }

    @Test
    @DisplayName("UNKNOWN format short-circuits to FAILED without invoking any library")
    void unknownFormatIsFailed() {
        byte[] anyBytes = "anything".getBytes(StandardCharsets.UTF_8);
        OasWsdlParseResult result = parser.parse(anyBytes, ContractFormat.UNKNOWN, "x.bin", (long) anyBytes.length);

        assertThat(result.status()).isEqualTo(OasWsdlParseResult.Status.FAILED);
        assertThat(result.failureReason()).contains("Unrecognised");
        assertThat(result.operations()).isEmpty();
    }

    @Test
    @DisplayName("empty bytes: status=FAILED with 'Empty file' reason, never throws")
    void emptyBytesAreFailed() {
        OasWsdlParseResult result = parser.parse(new byte[0], ContractFormat.OAS_3_0, "empty.yaml", 0L);
        assertThat(result.status()).isEqualTo(OasWsdlParseResult.Status.FAILED);
        assertThat(result.failureReason()).isEqualTo("Empty file");
    }
}
