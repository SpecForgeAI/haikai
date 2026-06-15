package com.example.architecturemodel.service.contract;

import com.example.architecturemodel.model.dto.migration.ContractFormat;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Format-detection coverage for {@link ContractFormatDetector}.
 *
 * <p>Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 2.</p>
 *
 * <p>Inline byte literals only -- no external sample files (per spec brief
 * "use minimal inline byte literals"). Each canonical marker is exercised
 * once; the unknown/empty/garbage cases are grouped into a single test to
 * keep the focused-test count small.</p>
 */
class ContractFormatDetectorTest {

    private final ContractFormatDetector detector = new ContractFormatDetector();

    @Test
    @DisplayName("detects OAS 2.0 from JSON and YAML 'swagger: 2.0' markers")
    void detectsOas20() {
        // Inline JSON. Pretty-printed with the colon-space whitespace the
        // common YAML/JSON exporters emit.
        byte[] json = "{\n  \"swagger\": \"2.0\",\n  \"info\": { \"title\": \"x\" }\n}\n"
            .getBytes(StandardCharsets.UTF_8);
        assertThat(detector.detect(json)).isEqualTo(ContractFormat.OAS_2_0);

        // Inline YAML.
        byte[] yaml = "swagger: '2.0'\ninfo:\n  title: x\n".getBytes(StandardCharsets.UTF_8);
        assertThat(detector.detect(yaml)).isEqualTo(ContractFormat.OAS_2_0);
    }

    @Test
    @DisplayName("detects OAS 3.0 from JSON and YAML 'openapi: 3.0' markers")
    void detectsOas30() {
        byte[] json = "{\"openapi\":\"3.0.3\",\"info\":{\"title\":\"x\"}}"
            .getBytes(StandardCharsets.UTF_8);
        assertThat(detector.detect(json)).isEqualTo(ContractFormat.OAS_3_0);

        byte[] yaml = "openapi: 3.0.0\ninfo:\n  title: x\n".getBytes(StandardCharsets.UTF_8);
        assertThat(detector.detect(yaml)).isEqualTo(ContractFormat.OAS_3_0);
    }

    @Test
    @DisplayName("detects OAS 3.1 from JSON and YAML 'openapi: 3.1' markers")
    void detectsOas31() {
        byte[] json = "{\"openapi\":\"3.1.0\",\"info\":{\"title\":\"x\"}}"
            .getBytes(StandardCharsets.UTF_8);
        assertThat(detector.detect(json)).isEqualTo(ContractFormat.OAS_3_1);

        byte[] yaml = "openapi: 3.1.0\ninfo:\n  title: x\n".getBytes(StandardCharsets.UTF_8);
        assertThat(detector.detect(yaml)).isEqualTo(ContractFormat.OAS_3_1);
    }

    @Test
    @DisplayName("detects WSDL 1.1 from prefixed root and from the namespace URI")
    void detectsWsdl11() {
        // Prefixed root with the standard wsdl: prefix and namespace URI on
        // the root element.
        String prefixed = """
            <?xml version="1.0"?>
            <wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
                              targetNamespace="http://example.com">
            </wsdl:definitions>
            """;
        assertThat(detector.detect(prefixed.getBytes(StandardCharsets.UTF_8)))
            .isEqualTo(ContractFormat.WSDL_1_1);

        // Un-prefixed root -- detector should still catch via the namespace
        // URI marker.
        String unprefixed = """
            <?xml version="1.0"?>
            <definitions xmlns="http://schemas.xmlsoap.org/wsdl/"
                         targetNamespace="http://example.com">
            </definitions>
            """;
        assertThat(detector.detect(unprefixed.getBytes(StandardCharsets.UTF_8)))
            .isEqualTo(ContractFormat.WSDL_1_1);
    }

    @Test
    @DisplayName("detects WSDL 2.0 from the wsdl/2.0 namespace URI on a <description> root")
    void detectsWsdl20() {
        String w2 = """
            <?xml version="1.0"?>
            <description xmlns="http://www.w3.org/ns/wsdl"
                         targetNamespace="http://example.com">
            </description>
            """;
        assertThat(detector.detect(w2.getBytes(StandardCharsets.UTF_8)))
            .isEqualTo(ContractFormat.WSDL_2_0);
    }

    @Test
    @DisplayName("returns UNKNOWN for empty, null, garbage, and unrelated XML")
    void returnsUnknownForEmptyAndGarbage() {
        assertThat(detector.detect(null)).isEqualTo(ContractFormat.UNKNOWN);
        assertThat(detector.detect(new byte[0])).isEqualTo(ContractFormat.UNKNOWN);

        byte[] garbage = "this is not a contract file at all".getBytes(StandardCharsets.UTF_8);
        assertThat(detector.detect(garbage)).isEqualTo(ContractFormat.UNKNOWN);

        // Unrelated XML -- no WSDL or OAS markers.
        byte[] otherXml = "<?xml version=\"1.0\"?><root><child/></root>".getBytes(StandardCharsets.UTF_8);
        assertThat(detector.detect(otherXml)).isEqualTo(ContractFormat.UNKNOWN);
    }

    @Test
    @DisplayName("tolerates UTF-8 BOM and leading whitespace ahead of the marker")
    void tolerantToBomAndWhitespace() {
        // UTF-8 BOM = 0xEF 0xBB 0xBF then a few spaces then YAML body.
        byte[] bom = new byte[] {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};
        byte[] body = "\n   openapi: 3.0.0\ninfo:\n  title: x\n".getBytes(StandardCharsets.UTF_8);
        byte[] combined = new byte[bom.length + body.length];
        System.arraycopy(bom, 0, combined, 0, bom.length);
        System.arraycopy(body, 0, combined, bom.length, body.length);
        assertThat(detector.detect(combined)).isEqualTo(ContractFormat.OAS_3_0);
    }
}
