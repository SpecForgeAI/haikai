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
 *   - a representation whose `element=` ref has no grammar -> null schema
 *     (and the WADL parser records it on `missingSchemaElements`).
 */

import { parseWadl } from '../services/wadlParser';
import { wadlToInventory } from '../services/wadlToInventory';
import {
  buildXsdRegistry,
  elementToJsonSchema,
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
