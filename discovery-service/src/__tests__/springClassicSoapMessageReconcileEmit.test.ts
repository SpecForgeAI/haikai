/**
 * Tests for the SOAP message-shape reconciliation + emission (Spec 4, TG4).
 *
 * Spec: 2026-05-30 SOAP/WSDL Message-Field Depth (Spec 4), Task Group 4 (4.1).
 *
 * Offline, pure, NO I/O, NO LLM. Covers ONLY the critical Group 4 behaviours:
 *  1. WSDL-view + Java-view of the SAME message reconcile to ONE entity
 *     (no duplicate), via the within-run name-normalized merge.
 *  2. A NAMED complex type emits ONE SHARED `logical_data_entity` referenced by
 *     a `logical_data_entity_relationship` (NOT inlined per message).
 *  3. Attributes carry the `field_metadata` JSONB blob + `is_nullable` from
 *     `nillable` (kept DISTINCT from `minOccurs=0`).
 *  4. `interface_logical_entities` links the interface to its message types.
 *  5. The endpoint request/response message bindings are emitted (in place).
 *  6. A service with NEITHER a parsable schema NOR a parsable Java DTO emits a
 *     Finding (and ONLY then -- a fully-parsed service emits none).
 *
 * Fixtures are inline doc-literal-wrapped single-part WSDLs + inline annotated
 * Java DTO strings, exercised through `runSpringClassicSoapPass` (end-to-end)
 * and the pure `reconcileMessageTypes` / `emitMessageEntities` units.
 */

import type { DiscoveryCandidate } from '../types/candidate';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';
import type { PackFindingScannerInput } from '../services/findings/packFindingScanners';
import { runSpringClassicSoapPass } from '../services/findings/packFindingScanners/springClassicSoap';
import { reconcileMessageTypes } from '../services/findings/packFindingScanners/springClassicSoap/messageReconciler';
import { emitMessageEntities } from '../services/findings/packFindingScanners/springClassicSoap/messageEntityEmitter';
import {
  parseWsdl,
  type WsdlParseResult,
} from '../services/findings/packFindingScanners/springClassicSoap/wsdlParser';
import {
  makeField,
  type MessageType,
} from '../services/findings/packFindingScanners/springClassicSoap/messageFieldModel';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function javaIr(filePath: string, content: string): SourceFileIR {
  return {
    filePath,
    language: 'java',
    packageOrNamespace: null,
    imports: [],
    classes: [],
    functions: [],
    rawContent: content,
  };
}

function wsdlIr(filePath: string, content: string): SourceFileIR {
  return {
    filePath,
    language: 'xml',
    packageOrNamespace: null,
    imports: [],
    classes: [],
    functions: [],
    rawContent: content,
  };
}

function makeInput(files: SourceFileIR[]): PackFindingScannerInput {
  const irFiles = new Map<string, SourceFileIR>();
  for (const f of files) irFiles.set(f.filePath, f);
  return { runId: 'run-soap-tg4', irFiles, packCandidates: [] };
}

function ofType(cands: DiscoveryCandidate[], type: string): DiscoveryCandidate[] {
  return cands.filter((c) => c.candidateType === type);
}

const SRC = { sourcePath: 'src/main/resources/wsdl/svc.wsdl', relatedFiles: new Map() };

/** Minimal doc-literal-wrapped WSDL scaffold wrapping the supplied schema body. */
function wsdlWithSchema(schemaBody: string, ns = 'http://example.com/svc'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions name="EmployeeSvc"
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
  <message name="GetEmployeeRequest"><part name="params" element="tns:getEmployeeRequest"/></message>
  <message name="GetEmployeeResponse"><part name="params" element="tns:getEmployeeResponse"/></message>
  <portType name="EmployeePortType">
    <operation name="getEmployee">
      <input message="tns:GetEmployeeRequest"/>
      <output message="tns:GetEmployeeResponse"/>
    </operation>
  </portType>
  <binding name="EmployeeBinding" type="tns:EmployeePortType">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="getEmployee"><soap:operation soapAction="urn:getEmployee"/></operation>
  </binding>
  <service name="EmployeeService">
    <port name="EmployeePort" binding="tns:EmployeeBinding">
      <soap:address location="http://localhost/svc"/>
    </port>
  </service>
</definitions>`;
}

// A doc-literal-wrapped schema with a NAMED complex type `Address` referenced by
// the response wrapper -- so the named type must be SHARED, not inlined.
const EMPLOYEE_SCHEMA = `
      <xsd:element name="getEmployeeRequest">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="employeeId" type="xsd:string"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>
      <xsd:element name="getEmployeeResponse">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="fullName" type="xsd:string"/>
            <xsd:element name="middleName" type="xsd:string" nillable="true"/>
            <xsd:element name="nickname" type="xsd:string" minOccurs="0"/>
            <xsd:element name="grade" type="GradeType"/>
            <xsd:element name="homeAddress" type="tns:Address"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>
      <xsd:complexType name="Address">
        <xsd:sequence>
          <xsd:element name="street" type="xsd:string"/>
          <xsd:element name="postcode" type="xsd:string"/>
        </xsd:sequence>
      </xsd:complexType>
      <xsd:simpleType name="GradeType">
        <xsd:restriction base="xsd:string">
          <xsd:enumeration value="A"/>
          <xsd:enumeration value="B"/>
          <xsd:enumeration value="C"/>
        </xsd:restriction>
      </xsd:simpleType>`;

// The Java DTO view of the SAME `getEmployeeResponse` message type -- same
// fields, different case on the type name (`GetEmployeeResponse`), so the
// reconciler must collapse it onto the WSDL view (no duplicate entity).
const JAVA_RESPONSE_DTO = `
package com.example.soap.dto;

import javax.xml.bind.annotation.XmlType;
import javax.xml.bind.annotation.XmlElement;

@XmlType(name = "getEmployeeResponse")
public class GetEmployeeResponse {
  @XmlElement protected String fullName;
  @XmlElement protected String middleName;
  @XmlElement protected String nickname;
  @XmlElement protected String grade;
  @XmlElement protected Address homeAddress;
  // a Java-only field absent from the WSDL view -- gap-filled onto the entity.
  @XmlElement protected String department;
}`;

// ----------------------------------------------------------------------------
// 1) WSDL-view + Java-view of the SAME message reconcile to ONE entity
// ----------------------------------------------------------------------------

describe('Spec 4 TG4 -- WSDL <-> Java reconciliation (no duplicate entity)', () => {
  it('collapses the WSDL view and the Java view of the same message to ONE entity', () => {
    const input = makeInput([
      wsdlIr('src/main/resources/wsdl/svc.wsdl', wsdlWithSchema(EMPLOYEE_SCHEMA)),
      javaIr('src/main/java/com/example/soap/dto/GetEmployeeResponse.java', JAVA_RESPONSE_DTO),
    ]);
    const out = runSpringClassicSoapPass(input);
    const entities = ofType(out.messageCandidates, 'logical_data_entities');
    // getEmployeeResponse must appear exactly ONCE even though both the WSDL
    // and the Java DTO describe it.
    const responseEntities = entities.filter(
      (e) => e.name.toLowerCase().replace(/[^a-z0-9]/g, '') === 'getemployeeresponse',
    );
    expect(responseEntities).toHaveLength(1);

    // The reconciled entity carries provenance from BOTH sources (XSD namespace
    // + originating Java class).
    const prov = responseEntities[0].data.source_provenance as string;
    expect(prov).toContain('namespace=http://example.com/svc');
    expect(prov).toContain('class=com.example.soap.dto.GetEmployeeResponse');
  });

  it('reconciles field-for-field: XSD wins for type/cardinality, Java fills gaps', () => {
    // Pure unit: same type from both views.
    const xsd: MessageType = {
      name: 'getEmployeeResponse',
      provenanceNamespace: 'http://example.com/svc',
      provenanceClass: null,
      source: 'xsd',
      fields: [
        makeField({ name: 'fullName', type: 'xsd:string', source: 'xsd' }),
        makeField({ name: 'nickname', type: 'xsd:string', source: 'xsd', cardinality: { min_occurs: 0 } }),
      ],
    };
    const java: MessageType = {
      name: 'GetEmployeeResponse',
      provenanceNamespace: null,
      provenanceClass: 'com.example.GetEmployeeResponse',
      source: 'java',
      fields: [
        makeField({ name: 'fullName', type: 'String', source: 'java' }),
        makeField({ name: 'department', type: 'String', source: 'java' }), // Java-only
      ],
    };
    const [reconciled] = reconcileMessageTypes([xsd], [java]);
    // ONE type (collapsed by normalized name), XSD name preferred.
    expect(reconciled.name).toBe('getEmployeeResponse');
    expect(reconciled.sources).toEqual(['xsd', 'java']);
    // `fullName` keeps the XSD source type (contract truth), not the Java type.
    const fullName = reconciled.fields.find((f) => f.name === 'fullName');
    expect(fullName?.type).toBe('xsd:string');
    // `nickname` keeps the XSD optional cardinality.
    const nickname = reconciled.fields.find((f) => f.name === 'nickname');
    expect(nickname?.cardinality.min_occurs).toBe(0);
    // The Java-only `department` field is gap-filled onto the union.
    const dept = reconciled.fields.find((f) => f.name === 'department');
    expect(dept).toBeDefined();
    expect(dept?.source).toBe('java');
  });
});

// ----------------------------------------------------------------------------
// 2) Named complex type -> ONE shared entity + a relationship (not inlined)
// ----------------------------------------------------------------------------

describe('Spec 4 TG4 -- named complex type shared via a relationship', () => {
  it('emits ONE shared Address entity referenced by a logical_data_entity_relationship', () => {
    const input = makeInput([
      wsdlIr('src/main/resources/wsdl/svc.wsdl', wsdlWithSchema(EMPLOYEE_SCHEMA)),
    ]);
    const out = runSpringClassicSoapPass(input);
    const entities = ofType(out.messageCandidates, 'logical_data_entities');

    // `Address` is minted exactly ONCE (shared), NOT inlined into the response.
    const addressEntities = entities.filter((e) => e.name === 'Address');
    expect(addressEntities).toHaveLength(1);

    // A relationship references the shared Address entity from the response.
    const rels = ofType(out.messageCandidates, 'logical_data_entity_relationships');
    const addrRel = rels.find(
      (r) =>
        r.data.targetEntity === 'Address' &&
        String(r.data.sourceEntity).toLowerCase().includes('getemployeeresponse'),
    );
    expect(addrRel).toBeDefined();
    expect(addrRel?.data.sourceEntity).toBeTruthy();

    // The response entity's `homeAddress` attribute is NOT itself expanded into
    // inline child attributes on the response -- the Address fields live on the
    // shared Address entity (street + postcode).
    const addressAttrs = ofType(out.messageCandidates, 'logical_data_attributes').filter(
      (a) => a.parentCandidateId === addressEntities[0].id,
    );
    const addrAttrNames = addressAttrs.map((a) => a.name).sort();
    expect(addrAttrNames).toEqual(['postcode', 'street']);
  });
});

// ----------------------------------------------------------------------------
// 3) Attributes carry field_metadata blob + is_nullable from nillable
// ----------------------------------------------------------------------------

describe('Spec 4 TG4 -- attribute field_metadata + is_nullable', () => {
  it('attributes carry the cardinality + restriction JSONB blob and is_nullable', () => {
    const input = makeInput([
      wsdlIr('src/main/resources/wsdl/svc.wsdl', wsdlWithSchema(EMPLOYEE_SCHEMA)),
    ]);
    const out = runSpringClassicSoapPass(input);
    const attrs = ofType(out.messageCandidates, 'logical_data_attributes');

    // nillable="true" -> is_nullable true; minOccurs default 1 (NOT conflated).
    const middleName = attrs.find((a) => a.name === 'middleName');
    expect(middleName?.data.isNullable).toBe(true);
    const mnMeta = middleName?.data.field_metadata as Record<string, any>;
    expect(mnMeta.cardinality.min_occurs).toBe(1);
    expect(mnMeta.xsd_source_type).toBe('xsd:string');

    // minOccurs=0 -> optional in the blob, but is_nullable stays FALSE (the two
    // facts must not be conflated).
    const nickname = attrs.find((a) => a.name === 'nickname');
    const nnMeta = nickname?.data.field_metadata as Record<string, any>;
    expect(nnMeta.cardinality.min_occurs).toBe(0);
    expect(nickname?.data.isNullable).toBe(false);

    // The enum restriction on `grade` lands in the blob (value-domain on the attr).
    const grade = attrs.find((a) => a.name === 'grade');
    const gMeta = grade?.data.field_metadata as Record<string, any>;
    expect(gMeta.restrictions?.enumeration).toEqual(['A', 'B', 'C']);
  });
});

// ----------------------------------------------------------------------------
// 4) interface_logical_entities + 5) endpoint request/response bindings
// ----------------------------------------------------------------------------

describe('Spec 4 TG4 -- interface links + endpoint request/response bindings', () => {
  it('emits interface_logical_entities and binds endpoint request/response messages', () => {
    const input = makeInput([
      wsdlIr('src/main/resources/wsdl/svc.wsdl', wsdlWithSchema(EMPLOYEE_SCHEMA)),
    ]);
    const out = runSpringClassicSoapPass(input);

    // interface_logical_entities links the SOAP interface to its message types.
    const links = ofType(out.messageCandidates, 'interface_logical_entities');
    expect(links.length).toBeGreaterThanOrEqual(2); // request + response
    const linkedEntityNames = links.map((l) => String(l.data.logicalEntityName).toLowerCase());
    expect(linkedEntityNames.some((n) => n === 'getemployeerequest')).toBe(true);
    expect(linkedEntityNames.some((n) => n === 'getemployeeresponse')).toBe(true);
    // The interface side is carried by display name (matched at save-back).
    expect(links.every((l) => typeof l.data.interfaceClassName === 'string')).toBe(true);

    // Endpoint request/response bindings applied IN PLACE (data.requestEntity /
    // data.responseEntity) so save-back resolves request/response point-ids.
    const ep = out.endpointCandidates.find((e) => e.name === 'getEmployee');
    expect(ep).toBeDefined();
    expect(String(ep?.data.requestEntity).toLowerCase()).toBe('getemployeerequest');
    expect(String(ep?.data.responseEntity).toLowerCase()).toBe('getemployeeresponse');
  });
});

// ----------------------------------------------------------------------------
// 6) Neither-source Finding (and ONLY then)
// ----------------------------------------------------------------------------

describe('Spec 4 TG4 -- neither-source Finding', () => {
  it('emits NO neither-source finding when the message shape fully parses', () => {
    const input = makeInput([
      wsdlIr('src/main/resources/wsdl/svc.wsdl', wsdlWithSchema(EMPLOYEE_SCHEMA)),
    ]);
    const out = runSpringClassicSoapPass(input);
    const contractGaps = out.findings.filter(
      (f) => (f.detailJson as any)?.gapType === 'interface_missing_contract_detail',
    );
    expect(contractGaps).toHaveLength(0);
  });

  it('emits a Finding when an operation references a message NEITHER source can parse', () => {
    // Pure unit: a WSDL result whose operation references request/response root
    // elements, but with ZERO parsed message types AND no Java DTO -> neither
    // source yields fields -> exactly one contract-detail gap per operation.
    const ifaceId = 'cand-iface-1';
    const interfaceCandidates: DiscoveryCandidate[] = [
      {
        id: ifaceId,
        runId: 'r',
        candidateType: 'interfaces',
        name: 'OrphanSoapSvc',
        confidence: 0.9,
        status: 'proposed',
        sourceClusterIds: [],
        data: { interface_type: 'SOAP_API' },
        synthesizedAt: 'now',
      },
    ];
    const endpointCandidates: DiscoveryCandidate[] = [
      {
        id: 'cand-ep-1',
        runId: 'r',
        candidateType: 'endpoints',
        name: 'doThing',
        confidence: 0.9,
        status: 'proposed',
        sourceClusterIds: [],
        parentCandidateId: ifaceId,
        data: {
          request_root_element: 'doThingRequest',
          response_root_element: 'doThingResponse',
          request_dto_class: null,
          response_dto_class: null,
        },
        synthesizedAt: 'now',
      },
    ];
    // WSDL parsed structurally but yielded NO message types (e.g. schema absent).
    const emptyWsdl: WsdlParseResult = {
      sourcePath: 'svc.wsdl',
      targetNamespace: 'http://x',
      ports: [],
      portTypes: [],
      operations: [],
      embeddedSchemas: [],
      messageTypes: [], // <-- no schema fields
      fieldDepthFindings: [],
    };
    const out = emitMessageEntities({
      wsdlResults: [emptyWsdl],
      javaMessageTypes: [], // <-- no Java DTO either
      interfaceCandidates,
      endpointCandidates,
    });
    const gaps = out.findings.filter(
      (f) => (f.detailJson as any)?.gapType === 'interface_missing_contract_detail',
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0].links?.[0]?.targetId).toBe(ifaceId);
    // No entities minted when neither source parsed.
    expect(ofType(out.candidates, 'logical_data_entities')).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
// Bonus: field-depth findings are translated to real evidence-gap Findings
// ----------------------------------------------------------------------------

describe('Spec 4 TG4 -- field-depth findings translated to Findings', () => {
  it('translates a cycle field-depth finding into a soap_message_type_cycle Finding', () => {
    // A self-referential type (Employee -> manager : Employee) STOPS with a
    // cycle finding in the deep walker; TG4 translates it to a real Finding.
    const cyclicSchema = `
      <xsd:element name="getEmployeeRequest">
        <xsd:complexType><xsd:sequence>
          <xsd:element name="employeeId" type="xsd:string"/>
        </xsd:sequence></xsd:complexType>
      </xsd:element>
      <xsd:element name="getEmployeeResponse">
        <xsd:complexType><xsd:sequence>
          <xsd:element name="employee" type="tns:Employee"/>
        </xsd:sequence></xsd:complexType>
      </xsd:element>
      <xsd:complexType name="Employee">
        <xsd:sequence>
          <xsd:element name="name" type="xsd:string"/>
          <xsd:element name="manager" type="tns:Employee"/>
        </xsd:sequence>
      </xsd:complexType>`;
    const parsed = parseWsdl(wsdlWithSchema(cyclicSchema), SRC);
    // Sanity: the deep walker recorded the cycle finding.
    expect(parsed.fieldDepthFindings.some((f) => f.kind === 'soap_message_type_cycle')).toBe(true);

    const out = emitMessageEntities({
      wsdlResults: [parsed],
      javaMessageTypes: [],
      interfaceCandidates: [],
      endpointCandidates: [],
    });
    const cycleFindings = out.findings.filter(
      (f) => (f.detailJson as any)?.gapType === 'soap_message_type_cycle',
    );
    expect(cycleFindings.length).toBeGreaterThanOrEqual(1);
  });
});
