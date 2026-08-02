/**
 * Format-twin deterministic mirror (2026-08-02) — pure-module tests.
 *
 * Pins: variant marker parsing; XML-first ordering (stable, pair-anchored);
 * XML<->JSON body conversion round trip (single-root rule); mirrored-send
 * arg construction in both directions with honest nulls on unconvertible
 * bodies.
 */
import {
  buildMirrorArgs,
  isXmlMedia,
  jsonToXmlBody,
  parseFormatVariant,
  sortVariantsXmlFirst,
  xmlToJsonBody,
  type ProvenHappyPath,
} from '../services/formatTwinMirror';

describe('parseFormatVariant / isXmlMedia', () => {
  it('parses the ` [format=<media>]` marker into base + media', () => {
    expect(parseFormatVariant('getNode [format=application/xml]')).toEqual({
      base: 'getNode',
      media: 'application/xml',
    });
    expect(parseFormatVariant('getNode')).toBeNull();
    expect(parseFormatVariant(null)).toBeNull();
  });

  it('classifies xml media types', () => {
    expect(isXmlMedia('application/xml')).toBe(true);
    expect(isXmlMedia('text/xml')).toBe(true);
    expect(isXmlMedia('application/json')).toBe(false);
  });
});

describe('sortVariantsXmlFirst', () => {
  const op = (operation_id: string) => ({ operation_id });

  it('puts the XML variant before its JSON sibling, anchored at the pair position', () => {
    const ordered = sortVariantsXmlFirst([
      op('first'),
      op('getNode [format=application/json]'),
      op('getNode [format=application/xml]'),
      op('last'),
    ]);
    expect(ordered.map((o) => o.operation_id)).toEqual([
      'first',
      'getNode [format=application/xml]',
      'getNode [format=application/json]',
      'last',
    ]);
  });

  it('leaves non-variant order untouched (stable)', () => {
    const ordered = sortVariantsXmlFirst([op('a'), op('b'), op('c')]);
    expect(ordered.map((o) => o.operation_id)).toEqual(['a', 'b', 'c']);
  });
});

describe('xmlToJsonBody / jsonToXmlBody', () => {
  it('round-trips a single-root body (root stripped on parse, restored on build)', () => {
    const xml = jsonToXmlBody({ node: { orgId: 42, name: 'demo' } });
    expect(xml).toContain('<node>');
    expect(xml).toContain('<orgId>42</orgId>');
    const back = xmlToJsonBody(xml as string) as Record<string, unknown>;
    expect(back).toEqual({ orgId: 42, name: 'demo' });
  });

  it('wraps a multi-key JSON body in <request> and returns null on unparseable XML', () => {
    const xml = jsonToXmlBody({ a: 1, b: 2 });
    expect(xml).toContain('<request>');
    expect(xmlToJsonBody('not <valid')).toBeNull();
  });
});

describe('buildMirrorArgs', () => {
  const provenJson: ProvenHappyPath = {
    media: 'application/json',
    method: 'POST',
    path: '/nodes/62552',
    query: null,
    body: { node: { orgId: 62552 } },
  };

  it('JSON -> XML: converts the body and sets the target media headers', () => {
    const args = buildMirrorArgs(provenJson, 'application/xml', 'getNode [format=application/xml]');
    expect(args).not.toBeNull();
    expect(args!.operationId).toBe('getNode [format=application/xml]');
    expect(args!.method).toBe('POST');
    expect(args!.path).toBe('/nodes/62552');
    expect(args!.headers).toEqual({
      Accept: 'application/xml',
      'Content-Type': 'application/xml',
    });
    expect(String(args!.body)).toContain('<node>');
  });

  it('XML -> JSON: parses the proven XML body (the clean direction)', () => {
    const provenXml: ProvenHappyPath = {
      media: 'application/xml',
      method: 'POST',
      path: '/nodes/62552',
      query: { verbose: 'true' },
      body: '<?xml version="1.0"?><node><orgId>62552</orgId></node>',
    };
    const args = buildMirrorArgs(provenXml, 'application/json', 'getNode [format=application/json]');
    expect(args).not.toBeNull();
    expect(args!.body).toEqual({ orgId: 62552 });
    expect(args!.query).toEqual({ verbose: 'true' });
    expect(args!.headers['Content-Type']).toBe('application/json');
  });

  it('a bodiless proven request mirrors bodiless (Accept only)', () => {
    const args = buildMirrorArgs(
      { ...provenJson, body: null },
      'application/xml',
      'getNode [format=application/xml]',
    );
    expect(args).not.toBeNull();
    expect(args!.headers).toEqual({ Accept: 'application/xml' });
    expect('body' in args!).toBe(false);
  });

  it('returns null when the body cannot convert (honest fallback to the LLM)', () => {
    const badXml: ProvenHappyPath = {
      media: 'application/xml',
      method: 'POST',
      path: '/nodes/1',
      query: null,
      body: 'not <valid',
    };
    expect(
      buildMirrorArgs(badXml, 'application/json', 'getNode [format=application/json]'),
    ).toBeNull();
  });
});
