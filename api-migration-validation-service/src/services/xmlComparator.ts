/**
 * Namespace-aware XML comparison (Spec 2026-07-06-j — Parity Exactness &
 * First-Class SOAP).
 *
 * SOAP responses are XML; comparing them as strings makes every reformat a
 * false break and every real break unlocatable. This module provides:
 *
 *   - `canonicalXml(xml)`      — a PRAGMATIC canonical form (C14N-lite,
 *     documented, deterministic): prefixes resolved to namespace URIs,
 *     attributes sorted, whitespace-only text dropped, text trimmed.
 *     NOT the W3C C14N spec (no external dependency) — the SAME canonical
 *     form is applied to BOTH sides, so equality is meaningful.
 *   - `compareXml(a, b, masks)` — structural walk producing entries with
 *     XPath-ish paths (`/Envelope/Body/greetResponse/name`), kinds
 *     shape/value; masked paths tolerate VALUE drift.
 *   - `compareXmlBytes(a, b, masks)` — the strict byte verdict: canonical
 *     forms byte-equal after masking.
 *
 * Built on `fast-xml-parser` (already a dependency; the WADL parser uses it).
 */

import { XMLParser } from 'fast-xml-parser';

// ---------------------------------------------------------------------------
// Canonical tree
// ---------------------------------------------------------------------------

interface CanonicalNode {
  /** `{namespaceUri}localName` (URI empty when un-namespaced). */
  name: string;
  attributes: Array<[string, string]>;
  text: string | null;
  children: CanonicalNode[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  commentPropName: '#comment',
});

type OrderedNode = Record<string, unknown>;

function splitName(raw: string): { prefix: string | null; local: string } {
  const idx = raw.indexOf(':');
  if (idx < 0) return { prefix: null, local: raw };
  return { prefix: raw.slice(0, idx), local: raw.slice(idx + 1) };
}

function buildCanonical(
  ordered: OrderedNode[],
  inheritedNs: Map<string | null, string>,
): CanonicalNode[] {
  const out: CanonicalNode[] = [];
  for (const entry of ordered) {
    const keys = Object.keys(entry).filter((k) => k !== ':@' && k !== '#comment');
    for (const rawName of keys) {
      if (rawName === '#text') continue;
      const attrsBag = (entry[':@'] ?? {}) as Record<string, unknown>;

      // Namespace scope: inherited + declared here.
      const ns = new Map(inheritedNs);
      for (const [attrKey, attrValue] of Object.entries(attrsBag)) {
        const name = attrKey.replace(/^@_/, '');
        if (name === 'xmlns') ns.set(null, String(attrValue));
        else if (name.startsWith('xmlns:')) ns.set(name.slice(6), String(attrValue));
      }

      const { prefix, local } = splitName(rawName);
      const uri = ns.get(prefix) ?? '';

      // Attributes: xmlns declarations are canonicalisation INPUT, not output
      // (prefix choice must not matter); everything else sorted by name.
      const attributes: Array<[string, string]> = [];
      for (const [attrKey, attrValue] of Object.entries(attrsBag)) {
        const name = attrKey.replace(/^@_/, '');
        if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
        const { prefix: ap, local: al } = splitName(name);
        const auri = ap ? (ns.get(ap) ?? '') : '';
        attributes.push([auri ? `{${auri}}${al}` : al, String(attrValue)]);
      }
      attributes.sort((a, b) => a[0].localeCompare(b[0]));

      const childOrdered = entry[rawName];
      const childEntries = Array.isArray(childOrdered)
        ? (childOrdered as OrderedNode[])
        : [];
      const texts: string[] = [];
      for (const child of childEntries) {
        if (typeof child['#text'] === 'string' || typeof child['#text'] === 'number') {
          const t = String(child['#text']).trim();
          if (t.length > 0) texts.push(t);
        }
      }

      out.push({
        name: uri ? `{${uri}}${local}` : local,
        attributes,
        text: texts.length > 0 ? texts.join('') : null,
        children: buildCanonical(childEntries, ns),
      });
    }
  }
  return out;
}

/** Parse to the canonical tree; null on unparseable input. */
export function parseCanonicalXml(xml: string): CanonicalNode[] | null {
  try {
    const ordered = parser.parse(xml) as OrderedNode[];
    if (!Array.isArray(ordered)) return null;
    return buildCanonical(ordered, new Map());
  } catch {
    return null;
  }
}

function serialiseNode(node: CanonicalNode): string {
  const attrs = node.attributes.map(([k, v]) => ` ${k}="${v}"`).join('');
  const inner =
    (node.text ?? '') + node.children.map(serialiseNode).join('');
  return `<${node.name}${attrs}>${inner}</${node.name}>`;
}

/** The deterministic canonical serialisation (C14N-lite; see file header). */
export function canonicalXml(xml: string): string | null {
  const tree = parseCanonicalXml(xml);
  if (tree === null) return null;
  return tree.map(serialiseNode).join('');
}

// ---------------------------------------------------------------------------
// Structural diff
// ---------------------------------------------------------------------------

export interface XmlDiffEntry {
  /** XPath-ish path over LOCAL names (`/Envelope/Body/greet/name`). */
  path: string;
  kind: 'element_missing' | 'element_added' | 'value_changed' | 'attribute_changed';
  sourceValue?: string | null;
  targetValue?: string | null;
  /** True when a mask (waiver XPath) tolerated a VALUE change here. */
  masked?: boolean;
}

function localOf(name: string): string {
  const idx = name.indexOf('}');
  return idx >= 0 ? name.slice(idx + 1) : name;
}

function walkXml(
  source: CanonicalNode[],
  target: CanonicalNode[],
  path: string,
  masks: Set<string>,
  out: XmlDiffEntry[],
): void {
  const max = Math.max(source.length, target.length);
  for (let i = 0; i < max; i++) {
    const s = source[i];
    const t = target[i];
    if (s && !t) {
      out.push({ path: `${path}/${localOf(s.name)}`, kind: 'element_missing' });
      continue;
    }
    if (!s && t) {
      out.push({ path: `${path}/${localOf(t.name)}`, kind: 'element_added' });
      continue;
    }
    const childPath = `${path}/${localOf(s.name)}`;
    if (s.name !== t.name) {
      out.push({
        path: childPath,
        kind: 'element_missing',
        sourceValue: s.name,
        targetValue: t.name,
      });
      continue;
    }
    const sAttrs = JSON.stringify(s.attributes);
    const tAttrs = JSON.stringify(t.attributes);
    if (sAttrs !== tAttrs) {
      out.push({
        path: childPath,
        kind: 'attribute_changed',
        sourceValue: sAttrs,
        targetValue: tAttrs,
      });
    }
    if ((s.text ?? '') !== (t.text ?? '')) {
      const masked = masks.has(childPath);
      out.push({
        path: childPath,
        kind: 'value_changed',
        sourceValue: s.text,
        targetValue: t.text,
        ...(masked ? { masked: true } : {}),
      });
    }
    walkXml(s.children, t.children, childPath, masks, out);
  }
}

export interface CompareXmlResult {
  classification: 'xml_match' | 'xml_shape_drift' | 'xml_value_drift' | 'xml_unparseable';
  entries: XmlDiffEntry[];
}

/** Structural XML comparison with XPath masks tolerating VALUE drift. */
export function compareXml(
  sourceXml: string,
  targetXml: string,
  masks: Set<string> = new Set(),
): CompareXmlResult {
  const source = parseCanonicalXml(sourceXml);
  const target = parseCanonicalXml(targetXml);
  if (source === null || target === null) {
    return { classification: 'xml_unparseable', entries: [] };
  }
  const entries: XmlDiffEntry[] = [];
  walkXml(source, target, '', masks, entries);
  const shape = entries.some(
    (e) => e.kind === 'element_missing' || e.kind === 'element_added' || e.kind === 'attribute_changed',
  );
  const value = entries.some((e) => e.kind === 'value_changed' && e.masked !== true);
  return {
    classification: shape ? 'xml_shape_drift' : value ? 'xml_value_drift' : 'xml_match',
    entries,
  };
}

/**
 * Strict byte verdict for XML raws: canonical forms byte-equal after masking
 * (masked element texts replaced with a marker on BOTH sides). Unparseable
 * input falls back to direct byte equality.
 */
export function compareXmlBytes(
  sourceXml: string,
  targetXml: string,
  masks: Set<string>,
): 'byte_match' | 'byte_drift' {
  const maskTree = (nodes: CanonicalNode[], path: string): void => {
    for (const node of nodes) {
      const childPath = `${path}/${localOf(node.name)}`;
      if (masks.has(childPath)) node.text = '«masked»';
      maskTree(node.children, childPath);
    }
  };
  const source = parseCanonicalXml(sourceXml);
  const target = parseCanonicalXml(targetXml);
  if (source === null || target === null) {
    return sourceXml === targetXml ? 'byte_match' : 'byte_drift';
  }
  maskTree(source, '');
  maskTree(target, '');
  const a = source.map(serialiseNode).join('');
  const b = target.map(serialiseNode).join('');
  return a === b ? 'byte_match' : 'byte_drift';
}
