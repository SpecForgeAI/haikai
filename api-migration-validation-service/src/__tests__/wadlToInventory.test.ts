/**
 * Pure-adapter tests for the WADL -> `ParsedOasInventory` mapping and the XSD
 * field-walk -> JSON-Schema projection that feeds it.
 *
 * Spec: 2026-06-03 OAS-YAML + WADL/XSD Contract Support for the API Behaviour
 * capture harness, Task Group 2.
 *
 * The route-level suite (`parseOasUploadFormats.test.ts`) proves the wiring;
 * this suite zooms in on the typing richness the scenario generator depends on:
 *   - method/path/operationId mapping (methodId + synthesised fallback);
 *   - nested NAMED complex types projected as nested object schemas;
 *   - `maxOccurs="unbounded"` / `>1` -> JSON `array` with `items`;
 *   - XSD built-ins -> JSON primitive `type`s;
 *   - restriction facets -> `enum` / `pattern` / numeric bounds;
 *   - path/query/header params carry their XSD type/format/facets (not a bare
 *     `{ type: 'string' }`);
 *   - a representation whose `element=` ref has no grammar -> null schema
 *     (and the WADL parser records it on `missingSchemaElements`).
 */

import { parseWadl } from '../services/wadlParser';
import { wadlToInventory } from '../services/wadlToInventory';
import {
  buildXsdRegistry,
  elementToJsonSchema,
  paramSchemaFromXsdType,
} from '../services/xsdSchemaModel';
import type { OpenAPIV3 } from 'openapi-types';

const NESTED_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:tns="http://hifi.example.com/types"
           targetNamespace="http://hifi.example.com/types">
  <xs:element name="placeOrderRequest" type="tns:PlaceOrder"/>
  <xs:complexType name="PlaceOrder">
    <xs:sequence>
      <xs:element name="customer" type="tns:Customer"/>
      <xs:element name="lines" type="tns:OrderLine" maxOccurs="unbounded"/>
      <xs:element name="discountCode" type="tns:DiscountCode" minOccurs="0"/>
    </xs:sequence>
  </xs:complexType>
  <xs:complexType name="Customer">
    <xs:sequence>
      <xs:element name="id" type="xs:string"/>
      <xs:element name="loyaltyPoints" type="xs:int" minOccurs="0"/>
    </xs:sequence>
  </xs:complexType>
  <xs:complexType name="OrderLine">
    <xs:sequence>
      <xs:element name="sku" type="xs:string"/>
      <xs:element name="qty" type="xs:int"/>
    </xs:sequence>
  </xs:complexType>
  <xs:simpleType name="DiscountCode">
    <xs:restriction base="xs:string">
      <xs:pattern value="[A-Z]{4}"/>
      <xs:maxLength value="4"/>
    </xs:restriction>
  </xs:simpleType>
</xs:schema>
`;

describe('xsdSchemaModel.elementToJsonSchema', () => {
  it('projects a nested complex type into nested object + array schemas with built-ins and facets', () => {
    const registry = buildXsdRegistry(new Map([['types.xsd', NESTED_XSD]]));
    const { schema, resolved } = elementToJsonSchema('placeOrderRequest', registry);

    expect(resolved).toBe(true);
    expect(schema).toBeTruthy();
    const root = schema as OpenAPIV3.SchemaObject & {
      properties: Record<string, OpenAPIV3.SchemaObject>;
    };
    expect(root.type).toBe('object');

    // customer -> nested object with its own fields.
    const customer = root.properties.customer as OpenAPIV3.SchemaObject & {
      properties: Record<string, OpenAPIV3.SchemaObject>;
    };
    expect(customer.type).toBe('object');
    expect(customer.properties.id).toMatchObject({ type: 'string' });
    expect(customer.properties.loyaltyPoints).toMatchObject({ type: 'integer' });

    // lines (maxOccurs unbounded) -> array whose items are OrderLine objects.
    const lines = root.properties.lines as OpenAPIV3.ArraySchemaObject;
    expect(lines.type).toBe('array');
    const item = lines.items as OpenAPIV3.SchemaObject & {
      properties: Record<string, OpenAPIV3.SchemaObject>;
    };
    expect(item.type).toBe('object');
    expect(item.properties.sku).toMatchObject({ type: 'string' });
    expect(item.properties.qty).toMatchObject({ type: 'integer' });

    // discountCode -> simple type with pattern + maxLength facets.
    const discount = root.properties.discountCode as OpenAPIV3.SchemaObject;
    expect(discount.type).toBe('string');
    expect(discount.pattern).toBe('[A-Z]{4}');
    expect(discount.maxLength).toBe(4);

    // required reflects XSD minOccurs: customer + lines required, discount not.
    expect(root.required).toContain('customer');
    expect(root.required).toContain('lines');
    expect(root.required).not.toContain('discountCode');
  });

  it('returns resolved=false for an element no grammar declares', () => {
    const registry = buildXsdRegistry(new Map([['types.xsd', NESTED_XSD]]));
    const { schema, resolved } = elementToJsonSchema('noSuchElement', registry);
    expect(resolved).toBe(false);
    expect(schema).toBeNull();
  });
});

describe('xsdSchemaModel.paramSchemaFromXsdType', () => {
  const registry = buildXsdRegistry(new Map([['types.xsd', NESTED_XSD]]));

  it('falls back to { type: "string" } for null / empty / "unknown"', () => {
    expect(paramSchemaFromXsdType(null, registry)).toEqual({ type: 'string' });
    expect(paramSchemaFromXsdType('', registry)).toEqual({ type: 'string' });
    expect(paramSchemaFromXsdType('   ', registry)).toEqual({ type: 'string' });
    expect(paramSchemaFromXsdType('unknown', registry)).toEqual({ type: 'string' });
  });

  it('maps an xsd builtin to its JSON type/format', () => {
    expect(paramSchemaFromXsdType('xsd:date', registry)).toEqual({
      type: 'string',
      format: 'date',
    });
    expect(paramSchemaFromXsdType('xs:int', registry)).toEqual({ type: 'integer' });
    expect(paramSchemaFromXsdType('xsd:boolean', registry)).toEqual({
      type: 'boolean',
    });
    expect(paramSchemaFromXsdType('xs:dateTime', registry)).toEqual({
      type: 'string',
      format: 'date-time',
    });
  });

  it('resolves a named restricted simpleType to its base type + facets', () => {
    const schema = paramSchemaFromXsdType('tns:DiscountCode', registry);
    expect(schema.type).toBe('string');
    expect(schema.pattern).toBe('[A-Z]{4}');
    expect(schema.maxLength).toBe(4);
  });

  it('falls back to { type: "string" } for an unresolved named type', () => {
    expect(paramSchemaFromXsdType('tns:NoSuchType', registry)).toEqual({
      type: 'string',
    });
  });
});

const WADL = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02"
             xmlns:tns="http://hifi.example.com/types">
  <doc title="HiFi Orders" version="9.9"/>
  <grammars>
    <include href="types.xsd"/>
  </grammars>
  <resources base="https://api.hifi.example.com/">
    <resource path="/orders">
      <method name="POST" id="placeOrder">
        <request>
          <representation mediaType="application/json" element="tns:placeOrderRequest"/>
        </request>
      </method>
      <method name="GET">
        <response>
          <representation mediaType="application/json" element="tns:placeOrderRequest"/>
        </response>
      </method>
    </resource>
  </resources>
</application>
`;

describe('wadlToInventory', () => {
  it('maps WADL operations to ParsedOasOperations with method/path/operationId and XSD-derived schemas', () => {
    const xsd = new Map([['types.xsd', NESTED_XSD]]);
    const result = parseWadl(WADL, { relatedFiles: xsd });
    expect(result.parseError).toBeUndefined();
    expect(result.missingGrammars).toHaveLength(0);

    const inventory = wadlToInventory(result, xsd);
    expect(inventory.title).toBe('HiFi Orders');
    expect(inventory.version).toBe('9.9');
    expect(inventory.operations).toHaveLength(2);

    // POST /orders -> operationId from methodId, request schema present.
    const post = inventory.operations.find((o) => o.method === 'post');
    expect(post).toBeDefined();
    expect(post!.operationId).toBe('placeOrder');
    expect(post!.path).toBe('/orders');
    expect(post!.requestSchema).toMatchObject({ type: 'object' });
    // The synthesised OperationObject embeds the request schema under JSON.
    const oasOp = post!.oasOperation as OpenAPIV3.OperationObject;
    const reqBody = oasOp.requestBody as OpenAPIV3.RequestBodyObject;
    expect(reqBody.content['application/json'].schema).toBeTruthy();

    // GET /orders (no methodId) -> synthesised operationId from compositeId.
    const get = inventory.operations.find((o) => o.method === 'get');
    expect(get).toBeDefined();
    expect(get!.operationId).toBe('GET_orders');
    expect(get!.path).toBe('/orders');
    expect(get!.responseSchema).toMatchObject({ type: 'object' });
    expect(get!.requestSchema).toBeNull();
  });

  it('yields a null schema (and records missingSchemaElements) when an element ref is undeclared', () => {
    // Same WADL but an EMPTY grammar map: the element ref cannot resolve.
    const result = parseWadl(WADL, { relatedFiles: new Map() });
    // The grammar file itself was not provided -> missingGrammars, but the
    // representation element refs are still recorded as unresolved.
    expect(result.missingGrammars).toContain('types.xsd');
    expect(result.missingSchemaElements.length).toBeGreaterThan(0);

    const inventory = wadlToInventory(result, new Map());
    const post = inventory.operations.find((o) => o.method === 'post');
    expect(post!.requestSchema).toBeNull();
  });
});

// A WADL whose params are XSD-typed: a path param typed xsd:date, a query param
// typed by a named restricted simpleType (pattern + maxLength), a header param
// of a builtin numeric type, and an untyped param (-> "unknown" fallback).
const PARAM_WADL = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02"
             xmlns:xsd="http://www.w3.org/2001/XMLSchema"
             xmlns:tns="http://hifi.example.com/types">
  <doc title="HiFi Orders" version="9.9"/>
  <grammars>
    <include href="types.xsd"/>
  </grammars>
  <resources base="https://api.hifi.example.com/">
    <resource path="/orders/{orderDate}">
      <param name="orderDate" style="template" type="xsd:date"/>
      <method name="GET" id="findOrders">
        <request>
          <param name="discount" style="query" type="tns:DiscountCode"/>
          <param name="limit" style="query" type="xsd:int" required="true"/>
          <param name="X-Trace-Id" style="header" type="xsd:string"/>
          <param name="legacy" style="query"/>
        </request>
      </method>
    </resource>
  </resources>
</application>
`;

describe('wadlToInventory param XSD typing', () => {
  it('surfaces path/query/header params with their real XSD type/format/facets', () => {
    const xsd = new Map([['types.xsd', NESTED_XSD]]);
    const result = parseWadl(PARAM_WADL, { relatedFiles: xsd });
    expect(result.parseError).toBeUndefined();

    const inventory = wadlToInventory(result, xsd);
    const get = inventory.operations.find((o) => o.method === 'get');
    expect(get).toBeDefined();

    const oasOp = get!.oasOperation as OpenAPIV3.OperationObject;
    const params = (oasOp.parameters ?? []) as OpenAPIV3.ParameterObject[];
    const byName = (n: string): OpenAPIV3.ParameterObject =>
      params.find((p) => p.name === n) as OpenAPIV3.ParameterObject;

    // (a) xsd:date path param -> { type: 'string', format: 'date' }.
    const orderDate = byName('orderDate');
    expect(orderDate.in).toBe('path');
    expect(orderDate.required).toBe(true);
    expect(orderDate.schema).toEqual({ type: 'string', format: 'date' });

    // (b) named restricted simpleType query param -> base type + facets.
    const discount = byName('discount');
    expect(discount.in).toBe('query');
    const discountSchema = discount.schema as OpenAPIV3.SchemaObject;
    expect(discountSchema.type).toBe('string');
    expect(discountSchema.pattern).toBe('[A-Z]{4}');
    expect(discountSchema.maxLength).toBe(4);

    // builtin numeric query param -> integer; required honoured.
    const limit = byName('limit');
    expect(limit.schema).toEqual({ type: 'integer' });
    expect(limit.required).toBe(true);

    // header param keeps its builtin string type.
    const trace = byName('X-Trace-Id');
    expect(trace.in).toBe('header');
    expect(trace.schema).toEqual({ type: 'string' });

    // untyped ("unknown") param keeps the { type: 'string' } fallback.
    const legacy = byName('legacy');
    expect(legacy.schema).toEqual({ type: 'string' });
  });
});

// -- Kiro #3: a MULTI-SEGMENT path template -----------------------------------
// A nested resource tree whose flattened path carries TWO template segments,
// `/hierarchynodes/{cobDate}/{orgId}`. Each segment is declared as its own
// `<param style="template">` with an XSD type (xsd:date + xsd:int) on the
// owning resource node -- the canonical, fully-declared case. A multi-segment
// template must surface BOTH segments in op.path AND both as typed `path`
// parameters so the capture LLM fills each segment (never collapsing to a
// single /{id}, which 500s the request).
const MULTI_SEGMENT_WADL = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02"
             xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <doc title="HiFi Hierarchy" version="3.0"/>
  <resources base="https://api.hifi.example.com/">
    <resource path="/hierarchynodes/{cobDate}">
      <param name="cobDate" style="template" type="xsd:date"/>
      <resource path="{orgId}">
        <param name="orgId" style="template" type="xsd:int"/>
        <method name="POST" id="createHierarchyNode"/>
      </resource>
    </resource>
  </resources>
</application>
`;

// Same 2-segment path template, but the SECOND segment ({orgId}) has NO
// declared `<param style="template">`. The adapter must still synthesise a
// `path` param for it (back-filled from the URI template) so the LLM sees
// every segment. This is the field-bug shape: WADLs that template a segment
// without declaring its param.
const MULTI_SEGMENT_UNDECLARED_WADL = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02"
             xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <doc title="HiFi Hierarchy" version="3.0"/>
  <resources base="https://api.hifi.example.com/">
    <resource path="/hierarchynodes/{cobDate}/{orgId}">
      <param name="cobDate" style="template" type="xsd:date"/>
      <method name="POST" id="createHierarchyNode"/>
    </resource>
  </resources>
</application>
`;

describe('wadlToInventory multi-segment path template (Kiro #3)', () => {
  it('keeps every {segment} in op.path and emits a typed path param per declared segment', () => {
    const result = parseWadl(MULTI_SEGMENT_WADL, { relatedFiles: new Map() });
    expect(result.parseError).toBeUndefined();

    const inventory = wadlToInventory(result, new Map());
    const op = inventory.operations.find((o) => o.method === 'post');
    expect(op).toBeDefined();

    // (a) op.path retains BOTH template segments (no collapse to a single id).
    expect(op!.path).toBe('/hierarchynodes/{cobDate}/{orgId}');
    expect(op!.path).toContain('{cobDate}');
    expect(op!.path).toContain('{orgId}');

    // (b) TWO path params, one per segment, each carrying its XSD-derived schema.
    const oasOp = op!.oasOperation as OpenAPIV3.OperationObject;
    const params = (oasOp.parameters ?? []) as OpenAPIV3.ParameterObject[];
    const pathParams = params.filter((p) => p.in === 'path');
    expect(pathParams.map((p) => p.name).sort()).toEqual(['cobDate', 'orgId']);

    const byName = (n: string): OpenAPIV3.ParameterObject =>
      params.find((p) => p.name === n) as OpenAPIV3.ParameterObject;

    const cobDate = byName('cobDate');
    expect(cobDate.in).toBe('path');
    expect(cobDate.required).toBe(true);
    expect(cobDate.schema).toEqual({ type: 'string', format: 'date' });

    const orgId = byName('orgId');
    expect(orgId.in).toBe('path');
    expect(orgId.required).toBe(true);
    expect(orgId.schema).toEqual({ type: 'integer' });
  });

  it('back-fills a path param for a templated segment with no declared <param>', () => {
    const result = parseWadl(MULTI_SEGMENT_UNDECLARED_WADL, { relatedFiles: new Map() });
    expect(result.parseError).toBeUndefined();

    const inventory = wadlToInventory(result, new Map());
    const op = inventory.operations.find((o) => o.method === 'post');
    expect(op).toBeDefined();
    expect(op!.path).toBe('/hierarchynodes/{cobDate}/{orgId}');

    const oasOp = op!.oasOperation as OpenAPIV3.OperationObject;
    const params = (oasOp.parameters ?? []) as OpenAPIV3.ParameterObject[];
    const pathParams = params.filter((p) => p.in === 'path');
    // Both segments are present even though only cobDate was declared.
    expect(pathParams.map((p) => p.name).sort()).toEqual(['cobDate', 'orgId']);

    const byName = (n: string): OpenAPIV3.ParameterObject =>
      params.find((p) => p.name === n) as OpenAPIV3.ParameterObject;

    // Declared segment keeps its XSD type.
    expect(byName('cobDate').schema).toEqual({ type: 'string', format: 'date' });

    // Undeclared segment is back-filled: required path param, string fallback.
    const orgId = byName('orgId');
    expect(orgId.in).toBe('path');
    expect(orgId.required).toBe(true);
    expect(orgId.schema).toEqual({ type: 'string' });
  });
});
