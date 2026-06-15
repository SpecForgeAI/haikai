/**
 * Edge-case WADL snippets used by parser unit tests.
 *
 * Spec: 2026-05-21 WADL Deterministic Parser, Task Group 1.
 *
 * Each constant exercises one specific parser code path:
 *  - `WRONG_NAMESPACE_WADL`        -> namespace gate (`unsupported_wadl_namespace`)
 *  - `MALFORMED_XML`               -> soft-fail on `fast-xml-parser` throw (`malformed_xml`)
 *  - `WADL_WITH_PARAM_STYLES_ALL_FOUR` -> template + query + header + matrix param parse
 *  - `WADL_DOC_ONLY`               -> interface-only (no resources) edge case
 *
 * These are deliberately kept inline (string constants) so the tests stay
 * self-contained and the file-on-disk fixtures only carry the canonical
 * anonymised Jersey shape plus the matching XSD.
 */

export const WRONG_NAMESPACE_WADL = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wrong-namespace.example/">
    <resources base="http://example.invalid/api/">
        <resource path="/x">
            <method id="getX" name="GET"/>
        </resource>
    </resources>
</application>`;

/**
 * Deliberately broken XML that `fast-xml-parser` rejects via a thrown
 * exception (unclosed CDATA section). The parser must catch this and
 * surface `parseError: 'malformed_xml'` without re-throwing.
 */
export const MALFORMED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02">
    <doc><![CDATA[ unterminated cdata section
</application>`;

export const WADL_WITH_PARAM_STYLES_ALL_FOUR = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02">
    <resources base="http://example.invalid:8080/svc/">
        <resource path="/items">
            <resource path="{itemId}">
                <param name="itemId" style="template" type="xs:int"/>
                <method id="getItem" name="GET">
                    <request>
                        <param name="filter" style="query" type="xs:string"/>
                        <param name="userName" style="header" type="xs:string"/>
                        <param name="version" style="matrix" type="xs:string"/>
                    </request>
                </method>
            </resource>
        </resource>
    </resources>
</application>`;

export const WADL_DOC_ONLY = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02">
    <doc title="DocOnly Service" version="0.1">Interface-only WADL with no resources.</doc>
</application>`;
