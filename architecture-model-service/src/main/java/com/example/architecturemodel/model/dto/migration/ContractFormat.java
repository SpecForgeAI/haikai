package com.example.architecturemodel.model.dto.migration;

/**
 * Enumeration of contract formats recognised by the bulk-resolve parse-files
 * pipeline.
 *
 * <p>Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 2.</p>
 *
 * <p>Returned by {@code ContractFormatDetector} after a first-2KB byte sniff
 * and consumed by {@code OasWsdlParserService} to dispatch to the correct
 * format-specific parser. {@link #UNKNOWN} is the catch-all when the sniffed
 * markers do not match any supported family -- the calling endpoint will stamp
 * the file as {@code failed} with reason {@code unrecognised_contract_format}
 * (Task Group 4) and skip it.</p>
 *
 * <p>Lives in the shared {@code model.dto.migration} package alongside the
 * other parse-files response DTOs so the controller, service layer, and any
 * future test fixtures all consume the same vocabulary.</p>
 */
public enum ContractFormat {
    /** OpenAPI 2.0 (Swagger 2.0). Marker: {@code swagger: '2.0'} or {@code "swagger": "2.0"}. */
    OAS_2_0,
    /** OpenAPI 3.0.x. Marker: {@code openapi: 3.0} or {@code "openapi": "3.0}. */
    OAS_3_0,
    /** OpenAPI 3.1.x. Marker: {@code openapi: 3.1} or {@code "openapi": "3.1}. */
    OAS_3_1,
    /** WSDL 1.1. Marker: {@code <wsdl:definitions} or namespace {@code http://schemas.xmlsoap.org/wsdl/}. */
    WSDL_1_1,
    /** WSDL 2.0. Marker: namespace {@code http://www.w3.org/ns/wsdl} on a {@code <description>} root. */
    WSDL_2_0,
    /** Bytes did not match any supported format; calling code stamps {@code failed}. */
    UNKNOWN
}
