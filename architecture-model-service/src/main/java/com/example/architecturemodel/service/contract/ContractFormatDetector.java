package com.example.architecturemodel.service.contract;

import com.example.architecturemodel.model.dto.migration.ContractFormat;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Sniffs the first ~2KB of a contract file's bytes to identify its format.
 *
 * <p>Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 2.</p>
 *
 * <p>The detector is intentionally permissive about ordering of marker
 * keys/attributes (YAML/JSON whitespace, XML attribute order) but strict
 * about the marker strings themselves. The spec mandates a "file bytes
 * only" approach with no content-type sniffing: the multipart {@code
 * Content-Type} header is ignored end-to-end so a misnamed
 * {@code .json} extension on a WSDL file (or vice versa) still routes
 * correctly.</p>
 *
 * <p>Marker matrix:</p>
 * <ul>
 *   <li>OAS JSON -- {@code "swagger": "2.0"} -> {@link
 *       ContractFormat#OAS_2_0}; {@code "openapi": "3.0...} -> {@link
 *       ContractFormat#OAS_3_0}; {@code "openapi": "3.1...} -> {@link
 *       ContractFormat#OAS_3_1}.</li>
 *   <li>OAS YAML -- {@code swagger: 2.0} -> {@link
 *       ContractFormat#OAS_2_0}; {@code openapi: 3.0...} -> {@link
 *       ContractFormat#OAS_3_0}; {@code openapi: 3.1...} -> {@link
 *       ContractFormat#OAS_3_1}.</li>
 *   <li>WSDL 1.1 -- {@code <wsdl:definitions} OR namespace
 *       {@code http://schemas.xmlsoap.org/wsdl/} (catches the un-prefixed
 *       {@code <definitions xmlns="...">} variant).</li>
 *   <li>WSDL 2.0 -- namespace {@code http://www.w3.org/ns/wsdl} (always on
 *       a {@code <description>} root in 2.0 schemas; matched anywhere in the
 *       prefix to tolerate {@code <description ...>} attribute ordering).</li>
 * </ul>
 *
 * <p>The detector is tolerant of leading whitespace and UTF-8 / UTF-16
 * byte-order marks (BOMs). Empty or null input returns {@link
 * ContractFormat#UNKNOWN} without inspecting any bytes.</p>
 *
 * <p>This class is stateless; one Spring bean per application context.</p>
 */
@Component
public class ContractFormatDetector {

    /** Maximum number of leading bytes inspected; spec says "~2KB". */
    static final int SNIFF_BYTE_LIMIT = 2048;

    // ------------- OAS markers -------------
    // The OAS JSON variants tolerate whitespace inside the JSON literal -- a
    // pretty-printed file can emit { "openapi" : "3.0.3" } with spaces around
    // the colon. The YAML variants tolerate optional surrounding quotes and
    // line-leading whitespace.
    //
    // The 3.0 / 3.1 patterns intentionally do NOT require the trailing
    // patch-version digits (we match "3.0" or "3.0.3" identically) so a
    // pre-release "3.1.0-rc1" version string still routes to OAS_3_1.

    private static final Pattern OAS_JSON_SWAGGER_2 = Pattern.compile(
        "\"swagger\"\\s*:\\s*\"2\\.0", Pattern.CASE_INSENSITIVE);

    private static final Pattern OAS_JSON_OPENAPI_30 = Pattern.compile(
        "\"openapi\"\\s*:\\s*\"3\\.0", Pattern.CASE_INSENSITIVE);

    private static final Pattern OAS_JSON_OPENAPI_31 = Pattern.compile(
        "\"openapi\"\\s*:\\s*\"3\\.1", Pattern.CASE_INSENSITIVE);

    private static final Pattern OAS_YAML_SWAGGER_2 = Pattern.compile(
        "(?m)^\\s*swagger\\s*:\\s*['\"]?2\\.0", Pattern.CASE_INSENSITIVE);

    private static final Pattern OAS_YAML_OPENAPI_30 = Pattern.compile(
        "(?m)^\\s*openapi\\s*:\\s*['\"]?3\\.0", Pattern.CASE_INSENSITIVE);

    private static final Pattern OAS_YAML_OPENAPI_31 = Pattern.compile(
        "(?m)^\\s*openapi\\s*:\\s*['\"]?3\\.1", Pattern.CASE_INSENSITIVE);

    // ------------- WSDL markers -------------
    // WSDL 1.1 prefixed root: <wsdl:definitions ...>
    // WSDL 1.1 un-prefixed root: <definitions xmlns="http://schemas.xmlsoap.org/wsdl/" ...>
    // WSDL 2.0 root: <description xmlns="http://www.w3.org/ns/wsdl" ...>
    //
    // The 2.0 check runs FIRST so a file that (incorrectly) carries both
    // namespaces routes to WSDL_2_0 rather than WSDL_1_1.

    private static final String WSDL_1_1_NAMESPACE = "http://schemas.xmlsoap.org/wsdl/";
    private static final String WSDL_2_0_NAMESPACE = "http://www.w3.org/ns/wsdl";
    private static final String WSDL_1_1_PREFIXED_ROOT = "<wsdl:definitions";

    /**
     * Identify the format of the bytes in {@code fileBytes}.
     *
     * @param fileBytes  raw file bytes (may be null, empty, or larger than
     *                   the sniff window -- only the first {@link
     *                   #SNIFF_BYTE_LIMIT} bytes are inspected).
     * @return one of the supported {@link ContractFormat} values, or
     *         {@link ContractFormat#UNKNOWN} when no marker matches.
     */
    public ContractFormat detect(byte[] fileBytes) {
        if (fileBytes == null || fileBytes.length == 0) {
            return ContractFormat.UNKNOWN;
        }

        // Inspect at most the first 2KB. Decoding as UTF-8 with the
        // replacement strategy is correct for OAS (UTF-8 mandatory) and a
        // safe fallback for WSDL XML (which may declare UTF-16 in the
        // prolog but is overwhelmingly UTF-8 in practice -- the marker
        // strings are ASCII so any encoding that's ASCII-compatible
        // survives the sniff).
        int limit = Math.min(fileBytes.length, SNIFF_BYTE_LIMIT);
        String prefix = new String(fileBytes, 0, limit, StandardCharsets.UTF_8);

        // Strip UTF-8 / UTF-16 BOM and leading whitespace so markers anchored
        // to the start of the file (e.g., YAML "openapi: ..." on line 1)
        // still match when the source editor added a BOM.
        prefix = stripBomAndLeadingWhitespace(prefix);

        // WSDL 2.0 first -- if both namespaces appear (rare, malformed) we
        // prefer the 2.0 routing because the 2.0 reader can at least surface
        // a structured error whereas wsdl4j tends to throw opaque ClassCast
        // / NullPointer chains.
        if (containsWsdl20(prefix)) {
            return ContractFormat.WSDL_2_0;
        }
        if (containsWsdl11(prefix)) {
            return ContractFormat.WSDL_1_1;
        }

        // OAS JSON ordering: 3.1 before 3.0 (so "3.10" doesn't get swallowed
        // by the 3.1 pattern -- the regex uses a literal "3.1" prefix so
        // "3.10" would still match 3.1, but the strict-ordering chain keeps
        // future-proofing simple).
        if (find(prefix, OAS_JSON_SWAGGER_2)) {
            return ContractFormat.OAS_2_0;
        }
        if (find(prefix, OAS_JSON_OPENAPI_31)) {
            return ContractFormat.OAS_3_1;
        }
        if (find(prefix, OAS_JSON_OPENAPI_30)) {
            return ContractFormat.OAS_3_0;
        }

        if (find(prefix, OAS_YAML_SWAGGER_2)) {
            return ContractFormat.OAS_2_0;
        }
        if (find(prefix, OAS_YAML_OPENAPI_31)) {
            return ContractFormat.OAS_3_1;
        }
        if (find(prefix, OAS_YAML_OPENAPI_30)) {
            return ContractFormat.OAS_3_0;
        }

        return ContractFormat.UNKNOWN;
    }

    // ------------------ helpers ------------------

    private static boolean containsWsdl20(String prefix) {
        return prefix.contains(WSDL_2_0_NAMESPACE);
    }

    private static boolean containsWsdl11(String prefix) {
        return prefix.contains(WSDL_1_1_PREFIXED_ROOT)
            || prefix.contains(WSDL_1_1_NAMESPACE);
    }

    private static boolean find(String haystack, Pattern needle) {
        Matcher m = needle.matcher(haystack);
        return m.find();
    }

    /**
     * Strip a leading BOM (UTF-8 0xEF 0xBB 0xBF decoded as U+FEFF, or
     * UTF-16 U+FEFF) and any subsequent leading whitespace. Returns the
     * prefix unchanged if no BOM is present.
     */
    private static String stripBomAndLeadingWhitespace(String prefix) {
        int start = 0;
        if (prefix.length() > 0 && prefix.charAt(0) == '\uFEFF') {
            start = 1;
        }
        while (start < prefix.length() && Character.isWhitespace(prefix.charAt(start))) {
            start++;
        }
        return start == 0 ? prefix : prefix.substring(start);
    }
}
