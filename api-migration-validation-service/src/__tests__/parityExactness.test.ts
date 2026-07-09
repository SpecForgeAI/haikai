/**
 * Spec 2026-07-06-j — Parity Exactness & First-Class SOAP. Pins:
 *
 *   STRICT PIN   — bodies equal-as-JSON but differing in key order / numeric
 *                  literal / whitespace: standard says match, strict says
 *                  byte_drift
 *   MASK PIN     — a probed-volatile path is masked out of the byte verdict;
 *                  drift OUTSIDE the mask still breaks
 *   RAW PIN      — missing raw on either side -> raw_unavailable (visible
 *                  degrade, never a false exact)
 *   WAIVER PIN   — a passed waiver set REPLACES the legacy header allowlist;
 *                  body-path waivers tolerate value drift (tagged 'waived')
 *   XML PINS     — namespace-prefix-only difference matches; element value
 *                  drift carries an XPath-ish path; canonical byte compare;
 *                  masked XPaths tolerated
 *   WSDL PIN     — a WSDL 1.1 fixture parses into POST operations carrying
 *                  the x-amvs-soap block
 *   ENVELOPE PIN — the SOAP envelope builder is byte-stable and escapes
 *                  values
 *   RAW POLICY   — raw persists ONLY when redaction was a no-op
 *   EXECUTOR PIN — the session executor preserves the raw wire text while
 *                  `data` stays parsed (real HTTP round-trip via express)
 */

import express from 'express';
import type { Server } from 'http';
import {
  compareJsonShapes,
  type WaiverSet,
} from '../services/jsonShapeComparator';
import {
  canonicalXml,
  compareXml,
  compareXmlBytes,
} from '../services/xmlComparator';
import { parseWsdlToInventory } from '../services/wsdlToInventory';
import { buildSoapEnvelope } from '../services/soapEnvelope';
import { persistableRawBody } from '../services/rawBodyPolicy';
import { foldWaivers } from '../services/comparisonWaivers';
import { createSessionHttpExecutor, rawBodyOf } from '../services/httpExecutor';

function waivers(partial: Partial<WaiverSet> = {}): WaiverSet {
  return {
    headerNames: new Set(),
    bodyPaths: new Set(),
    xmlXPaths: new Set(),
    orderingPaths: new Set(),
    ...partial,
  };
}

describe('STRICT + RAW + MASK pins', () => {
  const parsed = { a: 1, b: 'x' };

  it('key order / numeric literal / whitespace: standard matches, strict byte_drifts', () => {
    const sourceRaw = '{"a":1,"b":"x"}';
    const targetRaw = '{ "b": "x", "a": 1.0 }';
    const standard = compareJsonShapes(parsed, { b: 'x', a: 1 }, undefined, {
      profile: 'standard',
      sourceRaw,
      targetRaw,
    });
    expect(standard.bodyClassification).toBe('body_match');
    expect(standard.byteClassification).toBeNull();

    const strict = compareJsonShapes(parsed, { b: 'x', a: 1 }, undefined, {
      profile: 'strict',
      sourceRaw,
      targetRaw,
    });
    expect(strict.bodyClassification).toBe('body_match');
    expect(strict.byteClassification).toBe('byte_drift');

    const identical = compareJsonShapes(parsed, parsed, undefined, {
      profile: 'strict',
      sourceRaw,
      targetRaw: sourceRaw,
    });
    expect(identical.byteClassification).toBe('byte_match');
  });

  it('missing raw on either side -> raw_unavailable', () => {
    const result = compareJsonShapes(parsed, parsed, undefined, {
      profile: 'strict',
      sourceRaw: null,
      targetRaw: '{"a":1,"b":"x"}',
    });
    expect(result.byteClassification).toBe('raw_unavailable');
  });

  it('masks probed-volatile paths out of the byte verdict; unmasked drift breaks', () => {
    const source = { id: 'aaa', name: 'Ada' };
    const targetSameOutsideMask = { id: 'bbb', name: 'Ada' };
    const ctx = {
      envelope: { paths: ['/id'], volatility_source: 'probed', k: 3 },
      endpointSignal: false,
    } as never;

    const tolerated = compareJsonShapes(source, targetSameOutsideMask, ctx, {
      profile: 'strict',
      sourceRaw: JSON.stringify(source),
      targetRaw: JSON.stringify(targetSameOutsideMask),
    });
    expect(tolerated.bodyClassification).toBe('body_match');
    expect(tolerated.byteClassification).toBe('byte_match'); // /id masked

    const targetDriftOutside = { id: 'ccc', name: 'Grace' };
    const broken = compareJsonShapes(source, targetDriftOutside, ctx, {
      profile: 'strict',
      sourceRaw: JSON.stringify(source),
      targetRaw: JSON.stringify(targetDriftOutside),
    });
    expect(broken.byteClassification).toBe('byte_drift');
  });
});

describe('WAIVER pins', () => {
  const wrap = (headers: Record<string, string>, body: unknown) => ({ headers, body });

  it('a passed waiver set REPLACES the legacy header allowlist', () => {
    const source = wrap({ 'X-Custom-Noise': 'a', Date: 'Mon' }, { ok: true });
    const target = wrap({ 'X-Custom-Noise': 'b', Date: 'Tue' }, { ok: true });

    // Legacy path (no waivers passed): Date tolerated, X-Custom-Noise breaks.
    const legacy = compareJsonShapes(source, target);
    expect(legacy.headerClassification).toBe('header_value_drift');

    // Waiver set with ONLY x-custom-noise: it is tolerated; Date now BREAKS
    // (the set replaces the allowlist — deleting a seed makes it strict).
    const withWaivers = compareJsonShapes(source, target, undefined, {
      waivers: waivers({ headerNames: new Set(['x-custom-noise']) }),
    });
    const dateEntry = withWaivers.headerDiffJson.find((h) => h.headerName === 'Date');
    expect(dateEntry?.volatilitySource).toBeUndefined(); // not tolerated
    const noiseEntry = withWaivers.headerDiffJson.find(
      (h) => h.headerName === 'X-Custom-Noise',
    );
    expect(noiseEntry?.volatilitySource).toBe('declared');
  });

  it('body-path waivers tolerate value drift, tagged waived; shape still breaks', () => {
    const result = compareJsonShapes({ total: 1 }, { total: 2 }, undefined, {
      waivers: waivers({ bodyPaths: new Set(['/total']) }),
    });
    expect(result.bodyClassification).toBe('body_match');
    expect(result.bodyDiffJson[0].volatilitySource).toBe('waived');

    const shape = compareJsonShapes({ total: 1 }, { total: '2' }, undefined, {
      waivers: waivers({ bodyPaths: new Set(['/total']) }),
    });
    expect(shape.bodyClassification).toBe('body_shape_drift'); // never a blindfold
  });

  it('folds AMS waiver rows into the lookup sets', () => {
    const set = foldWaivers([
      { id: '1', project_id: null, scope: 'global', dimension: 'header', target: 'date', reason: 'r', author: null, provenance: 'seed:legacy-allowlist', created_at: '' },
      { id: '2', project_id: 'p', scope: 'project', dimension: 'body_path', target: '/generated_id', reason: 'r', author: null, provenance: null, created_at: '' },
      { id: '3', project_id: 'p', scope: 'project', dimension: 'xml_xpath', target: '/Envelope/Body/ts', reason: 'r', author: null, provenance: null, created_at: '' },
    ]);
    expect(set.headerNames.has('date')).toBe(true);
    expect(set.bodyPaths.has('/generated_id')).toBe(true);
    expect(set.xmlXPaths.has('/Envelope/Body/ts')).toBe(true);
  });
});

describe('XML pins', () => {
  const A = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:g="http://example.com/greetings">
  <soapenv:Body><g:greetResponse><g:name>Ada</g:name></g:greetResponse></soapenv:Body>
</soapenv:Envelope>`;
  // Same document, DIFFERENT prefixes + reformatted.
  const B = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><ns2:greetResponse xmlns:ns2="http://example.com/greetings"><ns2:name>Ada</ns2:name></ns2:greetResponse></s:Body></s:Envelope>`;
  const C = B.replace('Ada', 'Grace');

  it('namespace-prefix-only difference matches; value drift carries the path', () => {
    expect(canonicalXml(A)).toBe(canonicalXml(B));
    expect(compareXml(A, B).classification).toBe('xml_match');

    const drift = compareXml(A, C);
    expect(drift.classification).toBe('xml_value_drift');
    expect(drift.entries[0].path).toBe('/Envelope/Body/greetResponse/name');
  });

  it('strict XML byte compare honours XPath masks', () => {
    expect(compareXmlBytes(A, B, new Set())).toBe('byte_match');
    expect(compareXmlBytes(A, C, new Set())).toBe('byte_drift');
    expect(
      compareXmlBytes(A, C, new Set(['/Envelope/Body/greetResponse/name'])),
    ).toBe('byte_match');
  });

  it('routes XML raws through the XML byte comparer inside compareJsonShapes', () => {
    const result = compareJsonShapes('<a>1</a>', '<a>1</a>', undefined, {
      profile: 'strict',
      sourceRaw: A,
      targetRaw: C,
      waivers: waivers({ xmlXPaths: new Set(['/Envelope/Body/greetResponse/name']) }),
    });
    expect(result.byteClassification).toBe('byte_match');
  });
});

describe('WSDL + ENVELOPE pins', () => {
  const WSDL = `<?xml version="1.0"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"
             xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
             xmlns:tns="http://example.com/greetings"
             targetNamespace="http://example.com/greetings">
  <message name="greetRequest"><part name="parameters" element="tns:greet"/></message>
  <message name="greetResponse"><part name="parameters" element="tns:greetResponse"/></message>
  <portType name="GreetingsPort">
    <operation name="greet">
      <input message="tns:greetRequest"/>
      <output message="tns:greetResponse"/>
    </operation>
  </portType>
  <binding name="GreetingsBinding" type="tns:GreetingsPort">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="greet">
      <soap:operation soapAction="http://example.com/greetings/greet"/>
    </operation>
  </binding>
  <service name="GreetingsService">
    <port name="GreetingsPortSoap" binding="tns:GreetingsBinding">
      <soap:address location="http://legacy.example.com/services/greetings"/>
    </port>
  </service>
</definitions>`;

  it('parses a WSDL 1.1 document into POST operations with the x-amvs-soap block', () => {
    const rows = parseWsdlToInventory(WSDL, 'greetings.wsdl');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operationId: 'greet',
      method: 'post',
      path: '/services/greetings',
      soap: {
        soap_action: 'http://example.com/greetings/greet',
        request_root_element: 'greet',
        request_namespace: 'http://example.com/greetings',
        response_root_element: 'greetResponse',
        wsdl_source: 'greetings.wsdl',
      },
    });
    expect(parseWsdlToInventory('not xml at all', 'x')).toEqual([]);
  });

  it('builds a byte-stable, escaped SOAP envelope', () => {
    const args = {
      requestRootElement: 'greet',
      requestNamespace: 'http://example.com/greetings',
      params: [['name', 'Ada & "Grace" <3']] as Array<[string, string]>,
    };
    const one = buildSoapEnvelope(args);
    const two = buildSoapEnvelope(args);
    expect(one).toBe(two); // byte-stable
    expect(one).toContain('Ada &amp; &quot;Grace&quot; &lt;3');
    expect(one).toContain('<req:greet>');
    expect(canonicalXml(one)).not.toBeNull(); // schema-shaped, parseable
  });
});

describe('RAW POLICY pin', () => {
  it('keeps raw only when redaction was a no-op', () => {
    const clean = { id: 7, name: 'Acme' };
    expect(persistableRawBody('{"id":7,"name":"Acme"}', clean, clean)).toBe(
      '{"id":7,"name":"Acme"}',
    );
    const parsed = { id: 7, accessToken: 'secret' };
    const redacted = { id: 7, accessToken: '[REDACTED]' };
    expect(persistableRawBody('{"id":7,"accessToken":"secret"}', parsed, redacted)).toBeNull();
    expect(persistableRawBody(null, clean, clean)).toBeNull();
  });
});

describe('EXECUTOR raw preservation pin (real HTTP round-trip)', () => {
  let server: Server;
  let baseURL: string;

  beforeAll((done) => {
    const app = express();
    app.get('/json', (_req, res) => {
      res.setHeader('content-type', 'application/json');
      // Deliberately NON-canonical spacing — the raw must survive verbatim.
      res.send('{ "a": 1,  "b": "x" }');
    });
    app.get('/xml', (_req, res) => {
      res.setHeader('content-type', 'text/xml');
      res.send('<greet><name>Ada</name></greet>');
    });
    server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      baseURL = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(() => done());
  });

  it('data stays parsed while rawBody carries the exact wire text', async () => {
    const executor = createSessionHttpExecutor({
      auth: { type: 'none' },
      baseURL,
      timeoutMs: 5000,
    });
    const jsonResponse = await executor.request({ method: 'GET', url: '/json' });
    expect(jsonResponse.data).toEqual({ a: 1, b: 'x' }); // parsed contract intact
    expect(rawBodyOf(jsonResponse)).toBe('{ "a": 1,  "b": "x" }'); // verbatim

    const xmlResponse = await executor.request({ method: 'GET', url: '/xml' });
    expect(xmlResponse.data).toBe('<greet><name>Ada</name></greet>'); // string body
    expect(rawBodyOf(xmlResponse)).toBe('<greet><name>Ada</name></greet>');
    executor.dispose();
  });
});
