/**
 * Tests for the DEEPENED `wsdlParser.ts` XSD field walker.
 *
 * Spec: 2026-05-30 SOAP/WSDL Message-Field Depth (Spec 4), Task Group 2 (2.1).
 *
 * Offline, pure-parse, NO I/O, NO LLM (like Spec 3). Covers ONLY the critical
 * Group 2 behaviours:
 *  1. Per-field name + XSD source type extraction (type captured AS-IS).
 *  2. Cardinality mapping: `minOccurs=0` -> optional; `maxOccurs>1` /
 *     `unbounded` -> `is_collection`.
 *  3. Nullability from `nillable="true"` kept DISTINCT from `minOccurs=0`.
 *  4. At least one value-domain restriction (enumeration + pattern + length).
 *  5. A nested complex type walked one level (shared named-type entity).
 *  6. Cycle detection STOPS with a finding (no infinite loop).
 *  7. `xsd:extension` base-type fields FOLDED into the derived child.
 *
 * All fixtures are inline doc-literal-wrapped single-part WSDLs so the walk
 * is fully exercised without external schema files.
 */

import { parseWsdl } from '../services/findings/packFindingScanners/springClassicSoap/wsdlParser';
import type {
  MessageType,
  MessageField,
} from '../services/findings/packFindingScanners/springClassicSoap/messageFieldModel';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function typeByName(types: MessageType[], name: string): MessageType | undefined {
  return types.find((t) => t.name === name);
}

function fieldByName(t: MessageType | undefined, name: string): MessageField | undefined {
  return t?.fields.find((f) => f.name === name);
}

/** Minimal doc-literal-wrapped WSDL scaffold wrapping the supplied schema body. */
function wsdlWithSchema(schemaBody: string, ns = 'http://example.com/svc'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions name="Svc"
  targetNamespace="${ns}"
  xmlns="http://schemas.xmlsoap.org/wsdl/"
  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
  xmlns:tns="${ns}"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <types>
    <xsd:schema targetNamespace="${ns}">
${schemaBody}
    </xsd:schema>
  </types>
  <message name="OpRequest"><part name="params" element="tns:opRequest"/></message>
  <message name="OpResponse"><part name="params" element="tns:opResponse"/></message>
  <portType name="SvcPortType">
    <operation name="op">
      <input message="tns:OpRequest"/>
      <output message="tns:OpResponse"/>
    </operation>
  </portType>
  <binding name="SvcBinding" type="tns:SvcPortType">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="op"><soap:operation soapAction="urn:op"/></operation>
  </binding>
  <service name="SvcService">
    <port name="SvcPort" binding="tns:SvcBinding">
      <soap:address location="http://localhost/svc"/>
    </port>
  </service>
</definitions>`;
}

const SRC = { sourcePath: 'src/main/resources/wsdl/svc.wsdl', relatedFiles: new Map() };

// ----------------------------------------------------------------------------
// 1) Per-field name + type (AS-IS) + 2) cardinality + 3) nullability
// ----------------------------------------------------------------------------

describe('wsdlParser deep walk -- field name/type, cardinality, nullability', () => {
  const schema = `
      <xsd:element name="opRequest">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="id" type="xsd:string"/>
            <xsd:element name="note" type="xsd:string" minOccurs="0"/>
            <xsd:element name="tags" type="xsd:string" maxOccurs="unbounded"/>
            <xsd:element name="middleName" type="xsd:string" nillable="true"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>
      <xsd:element name="opResponse">
        <xsd:complexType><xsd:sequence/></xsd:complexType>
      </xsd:element>`;

  it('extracts per-field name + XSD source type captured AS-IS (no normalization)', () => {
    const r = parseWsdl(wsdlWithSchema(schema), SRC);
    expect(r.parseError).toBeUndefined();
    const req = typeByName(r.messageTypes, 'opRequest');
    expect(req).toBeDefined();
    const id = fieldByName(req, 'id');
    expect(id?.name).toBe('id');
    // AS-IS: the qname keeps its `xsd:` prefix, not a normalized `string`.
    expect(id?.type).toBe('xsd:string');
    expect(id?.source).toBe('xsd');
  });

  it('maps minOccurs=0 to optional and maxOccurs=unbounded to is_collection', () => {
    const r = parseWsdl(wsdlWithSchema(schema), SRC);
    const req = typeByName(r.messageTypes, 'opRequest');
    const note = fieldByName(req, 'note');
    expect(note?.cardinality.min_occurs).toBe(0); // optional
    expect(note?.cardinality.is_collection).toBe(false);

    const tags = fieldByName(req, 'tags');
    expect(tags?.cardinality.max_occurs).toBe('unbounded');
    expect(tags?.cardinality.is_collection).toBe(true);
    // unbounded element keeps the default minOccurs=1 (required, repeated).
    expect(tags?.cardinality.min_occurs).toBe(1);
  });

  it('keeps nillable="true" DISTINCT from minOccurs=0 (nullability vs optionality)', () => {
    const r = parseWsdl(wsdlWithSchema(schema), SRC);
    const req = typeByName(r.messageTypes, 'opRequest');

    // middleName: nillable but NOT optional -> isNullable true, min_occurs 1.
    const mid = fieldByName(req, 'middleName');
    expect(mid?.isNullable).toBe(true);
    expect(mid?.cardinality.min_occurs).toBe(1);

    // note: optional but NOT nillable -> isNullable false, min_occurs 0.
    const note = fieldByName(req, 'note');
    expect(note?.isNullable).toBe(false);
    expect(note?.cardinality.min_occurs).toBe(0);
  });
});

// ----------------------------------------------------------------------------
// 4) Value-domain restrictions
// ----------------------------------------------------------------------------

describe('wsdlParser deep walk -- value-domain restrictions', () => {
  it('captures enumeration (named simpleType), pattern + maxLength (inline simpleType)', () => {
    const schema = `
      <xsd:element name="opRequest">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="currency" type="tns:currency"/>
            <xsd:element name="code">
              <xsd:simpleType>
                <xsd:restriction base="xsd:string">
                  <xsd:pattern value="[A-Z]{3}"/>
                  <xsd:maxLength value="3"/>
                </xsd:restriction>
              </xsd:simpleType>
            </xsd:element>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>
      <xsd:element name="opResponse">
        <xsd:complexType><xsd:sequence/></xsd:complexType>
      </xsd:element>
      <xsd:simpleType name="currency">
        <xsd:restriction base="xsd:string">
          <xsd:enumeration value="GBP"/>
          <xsd:enumeration value="EUR"/>
          <xsd:enumeration value="PLN"/>
        </xsd:restriction>
      </xsd:simpleType>`;
    const r = parseWsdl(wsdlWithSchema(schema), SRC);
    expect(r.parseError).toBeUndefined();
    const req = typeByName(r.messageTypes, 'opRequest');

    const currency = fieldByName(req, 'currency');
    expect(currency?.restrictions?.enumeration).toEqual(['GBP', 'EUR', 'PLN']);

    const code = fieldByName(req, 'code');
    expect(code?.restrictions?.pattern).toBe('[A-Z]{3}');
    expect(code?.restrictions?.max_length).toBe(3);
  });
});

// ----------------------------------------------------------------------------
// 5) Nested complex type walked one level (shared named-type entity)
// ----------------------------------------------------------------------------

describe('wsdlParser deep walk -- nested named complex type', () => {
  it('walks a named complex type one level and emits it as a SHARED entity referenced by the parent field', () => {
    const schema = `
      <xsd:element name="opRequest">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="customer" type="tns:Customer"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>
      <xsd:element name="opResponse">
        <xsd:complexType><xsd:sequence/></xsd:complexType>
      </xsd:element>
      <xsd:complexType name="Customer">
        <xsd:sequence>
          <xsd:element name="firstName" type="xsd:string"/>
          <xsd:element name="age" type="xsd:int"/>
        </xsd:sequence>
      </xsd:complexType>`;
    const r = parseWsdl(wsdlWithSchema(schema), SRC);
    expect(r.parseError).toBeUndefined();

    // The parent field references the shared named type by local name.
    const req = typeByName(r.messageTypes, 'opRequest');
    const customerField = fieldByName(req, 'customer');
    expect(customerField?.complexTypeRef).toBe('Customer');

    // The named type is emitted ONCE as its own entity with its own fields.
    const customer = typeByName(r.messageTypes, 'Customer');
    expect(customer).toBeDefined();
    expect(customer?.fields.map((f) => f.name).sort()).toEqual(['age', 'firstName']);
    expect(fieldByName(customer, 'age')?.type).toBe('xsd:int');
    // provenance namespace carried for the Group 1 entity provenance field.
    expect(customer?.provenanceNamespace).toBe('http://example.com/svc');
  });
});

// ----------------------------------------------------------------------------
// 6) Cycle detection STOPS with a finding
// ----------------------------------------------------------------------------

describe('wsdlParser deep walk -- type cycle', () => {
  it('STOPS on a self-referential type (Employee -> manager : Employee) and records a cycle finding (no infinite loop)', () => {
    const schema = `
      <xsd:element name="opRequest">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="employee" type="tns:Employee"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>
      <xsd:element name="opResponse">
        <xsd:complexType><xsd:sequence/></xsd:complexType>
      </xsd:element>
      <xsd:complexType name="Employee">
        <xsd:sequence>
          <xsd:element name="name" type="xsd:string"/>
          <xsd:element name="manager" type="tns:Employee" minOccurs="0"/>
        </xsd:sequence>
      </xsd:complexType>`;
    // If cycle detection failed this would recurse until a stack overflow.
    const r = parseWsdl(wsdlWithSchema(schema), SRC);
    expect(r.parseError).toBeUndefined();

    // Employee emitted exactly once (shared), with its fields intact.
    const employee = typeByName(r.messageTypes, 'Employee');
    expect(employee).toBeDefined();
    expect(fieldByName(employee, 'manager')?.complexTypeRef).toBe('Employee');

    // A cycle finding was recorded.
    const cycleFindings = r.fieldDepthFindings.filter(
      (f) => f.kind === 'soap_message_type_cycle',
    );
    expect(cycleFindings.length).toBeGreaterThanOrEqual(1);
    expect(cycleFindings[0].subject).toBe('Employee');
  });
});

// ----------------------------------------------------------------------------
// 7) xsd:extension base-type folding
// ----------------------------------------------------------------------------

describe('wsdlParser deep walk -- xsd:extension folding', () => {
  it('folds xsd:extension base-type fields into the derived child entity', () => {
    const schema = `
      <xsd:element name="opRequest">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="manager" type="tns:Manager"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>
      <xsd:element name="opResponse">
        <xsd:complexType><xsd:sequence/></xsd:complexType>
      </xsd:element>
      <xsd:complexType name="Person">
        <xsd:sequence>
          <xsd:element name="name" type="xsd:string"/>
        </xsd:sequence>
      </xsd:complexType>
      <xsd:complexType name="Manager">
        <xsd:complexContent>
          <xsd:extension base="tns:Person">
            <xsd:sequence>
              <xsd:element name="department" type="xsd:string"/>
            </xsd:sequence>
          </xsd:extension>
        </xsd:complexContent>
      </xsd:complexType>`;
    const r = parseWsdl(wsdlWithSchema(schema), SRC);
    expect(r.parseError).toBeUndefined();

    const manager = typeByName(r.messageTypes, 'Manager');
    expect(manager).toBeDefined();
    // Derived child carries BOTH the inherited base field AND its own field,
    // base fields first.
    expect(manager?.fields.map((f) => f.name)).toEqual(['name', 'department']);
  });
});

// ----------------------------------------------------------------------------
// Soft-fail preservation (regression guard for the deepened walker)
// ----------------------------------------------------------------------------

describe('wsdlParser deep walk -- soft-fail preserved', () => {
  it('still soft-fails (no throw) on malformed XML and returns empty messageTypes', () => {
    const r = parseWsdl('<definitions><portType name="X"><operation name="bad"', SRC);
    expect(r.parseError).toBeDefined();
    expect(r.operations).toEqual([]);
    expect(r.messageTypes).toEqual([]);
    expect(r.fieldDepthFindings).toEqual([]);
  });
});
