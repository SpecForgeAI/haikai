package com.example.architecturemodel.service.contract;

import com.example.architecturemodel.model.dto.migration.ContractFormat;
import com.example.architecturemodel.model.dto.migration.OasWsdlParseResult;
import com.example.architecturemodel.model.dto.migration.OasWsdlParsedOperation;
import io.swagger.parser.OpenAPIParser;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.parser.core.models.ParseOptions;
import io.swagger.v3.parser.core.models.SwaggerParseResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

import javax.wsdl.Definition;
import javax.wsdl.PortType;
import javax.wsdl.factory.WSDLFactory;
import javax.wsdl.xml.WSDLReader;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Dispatches a parse request to the format-specific parser identified by
 * {@code ContractFormatDetector} and surfaces a single
 * {@link OasWsdlParseResult} per file.
 *
 * <p>Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 2.</p>
 *
 * <p>This service NEVER throws out of {@link #parse(byte[], ContractFormat)}.
 * Every checked-or-runtime exception thrown by the underlying library
 * ({@code swagger-parser}, {@code wsdl4j}, the CXF / DOM WSDL 2.0 reader) is
 * caught and funnelled into a {@link OasWsdlParseResult.Status#FAILED} result
 * whose {@link OasWsdlParseResult#failureReason()} carries the exception
 * message. Sibling-file failure isolation (Task Group 3.6) depends on this
 * never-throws contract.</p>
 *
 * <p>Parser-library choices per spec:</p>
 * <ul>
 *   <li>OAS 2.0/3.0/3.1 -- {@code io.swagger.parser.v3:swagger-parser} (one
 *       library, JSON+YAML transparent, version-agnostic).</li>
 *   <li>WSDL 1.1 -- {@code wsdl4j:wsdl4j} (JSR-110 reference implementation).</li>
 *   <li>WSDL 2.0 -- DOM-based extraction backed by {@code org.apache.cxf:cxf-rt-wsdl}
 *       being on the classpath. The v1 parse-scope is "operation names only",
 *       so a direct DOM read of {@code //service/@name} and
 *       {@code //interface/operation/@name} is sufficient and avoids the
 *       binding-traversal complexity of the full CXF reader. The CXF
 *       dependency stays declared so future Task Group passes can swap in
 *       the full reader without re-doing the Maven plumbing.</li>
 * </ul>
 *
 * <p>Per-format service-name extraction:</p>
 * <ul>
 *   <li>OAS -- {@code info.title}, lowercased + trimmed. The per-file override
 *       (resolved by Task Group 3) wins when supplied.</li>
 *   <li>WSDL 1.1 -- first {@code <service name>} in document order,
 *       lowercased + trimmed.</li>
 *   <li>WSDL 2.0 -- first {@code <service name>} under the root
 *       {@code <description>}, lowercased + trimmed.</li>
 * </ul>
 *
 * <p>Per-format operation extraction (spec: STRICT case-only normalisation
 * matches {@code MissingInputKeyHasher.canonicalDescriptorForApiContract}):</p>
 * <ul>
 *   <li>OAS -- {@code operationId} when present, else
 *       {@code lowercased(method + ' ' + path)}. NO slash collapse, NO query
 *       strip, NO path-param rewrite.</li>
 *   <li>WSDL 1.1 -- {@code <operation name>}, lowercased + trimmed; iterated
 *       across every {@code portType -> operation}.</li>
 *   <li>WSDL 2.0 -- {@code <operation name>}, lowercased + trimmed; iterated
 *       across every {@code interface -> operation}.</li>
 * </ul>
 *
 * <p>NOTE -- the class {@code io.swagger.v3.oas.models.Operation} collides
 * by short name with {@code javax.wsdl.Operation}. To keep imports clean we
 * import {@code javax.wsdl.*} (since WSDL types appear in multiple methods)
 * and reference the OAS operation type via its fully-qualified name inline.</p>
 */
@Service
public class OasWsdlParserService {

    private static final Logger log = LoggerFactory.getLogger(OasWsdlParserService.class);

    /** Sentinel for "filename not supplied" -- the caller is expected to
     *  supply a real name from the multipart upload but we tolerate null. */
    private static final String UNKNOWN_FILENAME = "<unknown>";

    /**
     * Parse a single file's bytes and return a per-file result.
     *
     * <p>Convenience overload that does not require a filename or filesize;
     * tests and direct callers can use this when the upstream controller
     * context (multipart name + size) is unavailable.</p>
     *
     * @param fileBytes   raw file bytes (null/empty tolerated -> FAILED).
     * @param format      format identified upstream by
     *                    {@code ContractFormatDetector.detect(...)}.
     * @return parse result; never null, never throws.
     */
    public OasWsdlParseResult parse(byte[] fileBytes, ContractFormat format) {
        return parse(fileBytes, format, null, null);
    }

    /**
     * Parse a single file's bytes and return a per-file result.
     *
     * @param fileBytes   raw file bytes (null/empty tolerated -> FAILED).
     * @param format      format identified upstream by
     *                    {@code ContractFormatDetector.detect(...)}.
     * @param fileName    original multipart filename (echoed back into the
     *                    result for the controller's response).
     * @param fileSize    file size in bytes (echoed back into the result).
     * @return parse result; never null, never throws.
     */
    public OasWsdlParseResult parse(byte[] fileBytes, ContractFormat format, String fileName, Long fileSize) {
        String safeName = fileName == null ? UNKNOWN_FILENAME : fileName;
        Long safeSize = fileSize != null ? fileSize : (fileBytes == null ? 0L : (long) fileBytes.length);
        ContractFormat safeFormat = format == null ? ContractFormat.UNKNOWN : format;

        if (fileBytes == null || fileBytes.length == 0) {
            return failed(safeName, safeSize, safeFormat, "Empty file");
        }

        try {
            return switch (safeFormat) {
                case OAS_2_0, OAS_3_0, OAS_3_1 -> parseOasInternal(fileBytes, safeName, safeSize, safeFormat);
                case WSDL_1_1 -> parseWsdl11Internal(fileBytes, safeName, safeSize);
                case WSDL_2_0 -> parseWsdl20Internal(fileBytes, safeName, safeSize);
                case UNKNOWN -> failed(safeName, safeSize, safeFormat, "Unrecognised contract format");
            };
        } catch (Throwable t) {
            // Never throw out of parse(...) -- Task Group 3.6 sibling-file
            // failure isolation depends on this contract. Log + funnel.
            log.warn("Parser failure on {} (format={}): {}", safeName, safeFormat, t.toString());
            String msg = t.getMessage();
            if (msg == null || msg.isBlank()) {
                msg = t.getClass().getSimpleName();
            }
            return failed(safeName, safeSize, safeFormat, msg);
        }
    }

    // ------------------ OAS ------------------

    private OasWsdlParseResult parseOasInternal(byte[] bytes, String fileName, Long fileSize, ContractFormat format) {
        String content = new String(bytes, StandardCharsets.UTF_8);

        ParseOptions options = new ParseOptions();
        // We only need a structural read -- no $ref resolution / no remote
        // fetches / no flattening. This keeps the parser fast and avoids
        // unexpected network attempts on uploaded files referencing
        // external schemas.
        options.setResolve(false);
        options.setResolveFully(false);

        OpenAPIParser parser = new OpenAPIParser();
        SwaggerParseResult result = parser.readContents(content, null, options);

        OpenAPI api = result == null ? null : result.getOpenAPI();
        if (api == null) {
            String reason = "OAS parse returned no model";
            if (result != null && result.getMessages() != null && !result.getMessages().isEmpty()) {
                reason = String.join("; ", result.getMessages());
            }
            return failed(fileName, fileSize, format, reason);
        }

        String suggestedServiceName = null;
        if (api.getInfo() != null && api.getInfo().getTitle() != null) {
            suggestedServiceName = api.getInfo().getTitle().toLowerCase().trim();
            if (suggestedServiceName.isEmpty()) {
                suggestedServiceName = null;
            }
        }

        List<OasWsdlParsedOperation> ops = new ArrayList<>();
        if (api.getPaths() != null) {
            for (Map.Entry<String, PathItem> entry : api.getPaths().entrySet()) {
                String path = entry.getKey();
                PathItem item = entry.getValue();
                if (item == null) {
                    continue;
                }
                appendOasOperation(ops, "get", path, item.getGet());
                appendOasOperation(ops, "put", path, item.getPut());
                appendOasOperation(ops, "post", path, item.getPost());
                appendOasOperation(ops, "delete", path, item.getDelete());
                appendOasOperation(ops, "options", path, item.getOptions());
                appendOasOperation(ops, "head", path, item.getHead());
                appendOasOperation(ops, "patch", path, item.getPatch());
                appendOasOperation(ops, "trace", path, item.getTrace());
            }
        }

        return new OasWsdlParseResult(
            fileName, fileSize, format,
            OasWsdlParseResult.Status.PARSED,
            null,
            suggestedServiceName,
            Collections.unmodifiableList(ops)
        );
    }

    /**
     * Append one parsed operation if {@code op} is non-null. Identifier
     * derivation matches spec: {@code operationId} when present, else
     * {@code lowercased(method + ' ' + path)}. STRICT case-only normalisation
     * -- no slash collapse, no query strip, no path-param rewrite.
     */
    private static void appendOasOperation(
        List<OasWsdlParsedOperation> sink,
        String method,
        String path,
        io.swagger.v3.oas.models.Operation op
    ) {
        if (op == null) {
            return;
        }
        String identifier;
        if (op.getOperationId() != null && !op.getOperationId().isBlank()) {
            identifier = op.getOperationId().toLowerCase().trim();
        } else {
            // STRICT case-only normalisation: lowercase the joined string but
            // do NOT touch the path content (no slash collapse, no query
            // strip, no path-param rewrite). The path is taken verbatim from
            // the OAS document.
            String rawPath = path == null ? "" : path;
            identifier = (method + " " + rawPath).toLowerCase().trim();
        }
        sink.add(new OasWsdlParsedOperation(identifier));
    }

    // ------------------ WSDL 1.1 ------------------

    private OasWsdlParseResult parseWsdl11Internal(byte[] bytes, String fileName, Long fileSize) throws Exception {
        WSDLFactory factory = WSDLFactory.newInstance();
        WSDLReader reader = factory.newWSDLReader();
        // Disable verbose / imports so we read the local bytes only --
        // matches the spec posture of "no external resolution".
        reader.setFeature("javax.wsdl.verbose", false);
        reader.setFeature("javax.wsdl.importDocuments", false);

        InputSource src = new InputSource(new ByteArrayInputStream(bytes));
        Definition def = reader.readWSDL(null, src);

        String suggestedServiceName = null;
        if (def != null && def.getServices() != null && !def.getServices().isEmpty()) {
            // First service in document order. wsdl4j keys the map by QName;
            // we take the first iteration entry.
            Object first = def.getServices().keySet().iterator().next();
            if (first instanceof javax.xml.namespace.QName qn) {
                suggestedServiceName = qn.getLocalPart() == null ? null : qn.getLocalPart().toLowerCase().trim();
            }
        }
        if (suggestedServiceName != null && suggestedServiceName.isEmpty()) {
            suggestedServiceName = null;
        }

        List<OasWsdlParsedOperation> ops = new ArrayList<>();
        if (def != null && def.getPortTypes() != null) {
            // Iterate every portType -> operation. Operation names are
            // lowercased + trimmed per spec.
            for (Object pt : def.getPortTypes().values()) {
                if (!(pt instanceof PortType portType)) {
                    continue;
                }
                List<?> opsList = portType.getOperations();
                if (opsList == null) {
                    continue;
                }
                for (Object o : opsList) {
                    if (!(o instanceof javax.wsdl.Operation wsdlOp)) {
                        continue;
                    }
                    String name = wsdlOp.getName();
                    if (name == null || name.isBlank()) {
                        continue;
                    }
                    ops.add(new OasWsdlParsedOperation(name.toLowerCase().trim()));
                }
            }
        }

        return new OasWsdlParseResult(
            fileName, fileSize, ContractFormat.WSDL_1_1,
            OasWsdlParseResult.Status.PARSED,
            null,
            suggestedServiceName,
            Collections.unmodifiableList(ops)
        );
    }

    // ------------------ WSDL 2.0 ------------------

    /**
     * WSDL 2.0 parse uses a direct DOM read of the {@code <service>} and
     * {@code <interface>/<operation>} elements. The full CXF WSDLManager
     * API is overkill for the v1 parse-scope ("operation names only" --
     * no binding traversal). The CXF dependency stays on the classpath so
     * future passes can substitute the full reader without re-doing the
     * Maven plumbing.
     */
    private OasWsdlParseResult parseWsdl20Internal(byte[] bytes, String fileName, Long fileSize) throws Exception {
        DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
        dbf.setNamespaceAware(true);
        // Defence: disable external DTD / entity loading so a malicious
        // WSDL 2.0 file cannot trigger a network fetch or entity-expansion
        // attack during parse.
        dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
        dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        dbf.setExpandEntityReferences(false);

        DocumentBuilder builder = dbf.newDocumentBuilder();
        Document doc = builder.parse(new ByteArrayInputStream(bytes));
        Element root = doc.getDocumentElement();

        String suggestedServiceName = firstChildElementAttribute(root, "service", "name");
        if (suggestedServiceName != null) {
            suggestedServiceName = suggestedServiceName.toLowerCase().trim();
            if (suggestedServiceName.isEmpty()) {
                suggestedServiceName = null;
            }
        }

        // WSDL 2.0 declares operations under <interface> rather than
        // <portType> (the 1.1 spelling). Walk every <interface>'s
        // <operation> children.
        List<OasWsdlParsedOperation> ops = new ArrayList<>();
        NodeList interfaces = root.getElementsByTagNameNS(
            "http://www.w3.org/ns/wsdl", "interface");
        for (int i = 0; i < interfaces.getLength(); i++) {
            Node iface = interfaces.item(i);
            NodeList children = iface.getChildNodes();
            for (int j = 0; j < children.getLength(); j++) {
                Node child = children.item(j);
                if (child.getNodeType() != Node.ELEMENT_NODE) {
                    continue;
                }
                if (!"operation".equals(child.getLocalName())) {
                    continue;
                }
                String name = ((Element) child).getAttribute("name");
                if (name == null || name.isBlank()) {
                    continue;
                }
                ops.add(new OasWsdlParsedOperation(name.toLowerCase().trim()));
            }
        }

        return new OasWsdlParseResult(
            fileName, fileSize, ContractFormat.WSDL_2_0,
            OasWsdlParseResult.Status.PARSED,
            null,
            suggestedServiceName,
            Collections.unmodifiableList(ops)
        );
    }

    /**
     * Find the first child {@code <localName>} element under {@code parent}
     * and return the value of its {@code attributeName} attribute. Returns
     * null when not found.
     */
    private static String firstChildElementAttribute(Element parent, String localName, String attributeName) {
        if (parent == null) {
            return null;
        }
        NodeList children = parent.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            Node n = children.item(i);
            if (n.getNodeType() != Node.ELEMENT_NODE) {
                continue;
            }
            if (localName.equals(n.getLocalName())) {
                String value = ((Element) n).getAttribute(attributeName);
                return value == null ? null : value;
            }
        }
        return null;
    }

    // ------------------ shared ------------------

    private static OasWsdlParseResult failed(String fileName, Long fileSize, ContractFormat format, String reason) {
        return new OasWsdlParseResult(
            fileName,
            fileSize,
            format,
            OasWsdlParseResult.Status.FAILED,
            reason,
            null,
            Collections.emptyList()
        );
    }
}
