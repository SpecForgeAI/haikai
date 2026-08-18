/**
 * SCL shape extractor tests — `[S-...]` contracts from the fixture legacy app.
 *
 * Parse-heavy suite (real tree-sitter through the process-scoped binding);
 * run via `npm test -- --testPathPattern=scl`.
 */

import * as path from 'path';
import { indexJavaProject, type JavaProjectIndex } from '../javaProjectIndex';
import { extractShapes, type ShapeExtractionResult } from '../shapeExtractor';
import type { SclShapeContract } from '../sclTypes';

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'legacy-app');

describe('extractShapes (fixture legacy app)', () => {
  let index: JavaProjectIndex;
  let result: ShapeExtractionResult;

  const shape = (symbol: string): SclShapeContract => {
    const found = result.shapes.find((s) => s.symbol === symbol);
    expect(found).toBeDefined();
    return found as SclShapeContract;
  };

  beforeAll(async () => {
    index = await indexJavaProject(FIXTURE_ROOT);
    result = extractShapes(index);
  });

  it('maps joda LocalDate fields to the neutral kind "date" with the carrier as evidence', () => {
    const detail = shape('com.legacy.hier.model.HierarchyViewDetail');
    const validFrom = detail.fields.find((f) => f.name === 'validFrom')!;
    const validTo = detail.fields.find((f) => f.name === 'validTo')!;
    expect(validFrom.kind).toBe('date');
    expect(validFrom.sourceCarrier).toBe('org.joda.time.LocalDate');
    expect(validTo.kind).toBe('date');
    expect(validTo.sourceCarrier).toBe('org.joda.time.LocalDate');
  });

  it('reads @JsonProperty wire names', () => {
    const detail = shape('com.legacy.hier.model.HierarchyViewDetail');
    const name = detail.fields.find((f) => f.name === 'name')!;
    expect(name.wireName).toBe('view_name');
    expect(name.kind).toBe('string');
    // Fields without wire annotations carry none.
    const id = detail.fields.find((f) => f.name === 'id')!;
    expect(id.wireName).toBeNull();
    expect(id.kind).toBe('int64');
  });

  it('classifies getter/setter classes as representation "pojo"', () => {
    expect(shape('com.legacy.hier.model.HierarchyViewDetail').representation).toBe('pojo');
    expect(shape('com.legacy.hier.model.FilterCriteria').representation).toBe('pojo');
  });

  it('flags HierarchyViewDetail mutated_in_flight with a note citing ViewEnricher', () => {
    const detail = shape('com.legacy.hier.model.HierarchyViewDetail');
    expect(detail.flags).toContain('mutated_in_flight');
    const validTo = detail.fields.find((f) => f.name === 'validTo')!;
    const enricherNote = validTo.notes.find((n) => n.includes('ViewEnricher.java'));
    expect(enricherNote).toBeDefined();
    expect(enricherNote).toMatch(/setValidTo called at src\/main\/java\/com\/legacy\/hier\/provider\/ViewEnricher\.java:\d+/);
  });

  it('resolves project-type fields to S-keys and records them in references', () => {
    const detail = shape('com.legacy.hier.model.HierarchyViewDetail');
    const filterKey = result.keyBySymbol.get('com.legacy.hier.model.FilterCriteria');
    expect(filterKey).toMatch(/^S-[0-9a-f]{12}$/);
    const filterCriterias = detail.fields.find((f) => f.name === 'filterCriterias')!;
    expect(filterCriterias.kind).toBe(`list<ref:${filterKey}>`);
    expect(detail.references).toContain(filterKey as string);
  });

  it('emits enums as shapes listing their constants', () => {
    const responseCode = shape('com.legacy.hier.model.ResponseCode');
    expect(responseCode.representation).toBe('enum');
    expect(responseCode.fields.map((f) => f.name)).toEqual(['SUCCESS', 'NO_DATA_FOUND', 'FATAL']);
    expect(responseCode.fields.every((f) => f.kind === 'enum-constant')).toBe(true);
  });

  it('reads @XmlRootElement into wireFacts', () => {
    const envelope = shape('com.legacy.hier.model.ResponseEnvelope');
    expect(envelope.wireFacts.xmlRootName).toBe('hierarchyViewResponse');
    // The envelope references both the enum shape and the detail shape.
    expect(envelope.references).toContain(result.keyBySymbol.get('com.legacy.hier.model.ResponseCode') as string);
    expect(envelope.references).toContain(result.keyBySymbol.get('com.legacy.hier.model.HierarchyViewDetail') as string);
  });

  it('excludes static constants from shape fields (Dao SQL strings are not data)', () => {
    const dao = shape('com.legacy.hier.dao.ViewDao');
    expect(dao.fields.map((f) => f.name)).not.toContain('FIND_LATEST_SQL');
    const dataSource = dao.fields.find((f) => f.name === 'dataSource')!;
    expect(dataSource.kind).toBe('opaque:DataSource');
  });

  it('is deterministic: two extract runs produce identical keys and content hashes', async () => {
    const secondIndex = await indexJavaProject(FIXTURE_ROOT);
    const second = extractShapes(secondIndex);
    expect(second.shapes.length).toBe(result.shapes.length);
    for (const s of result.shapes) {
      const again = second.shapes.find((x) => x.symbol === s.symbol);
      expect(again).toBeDefined();
      expect(again!.key).toBe(s.key);
      expect(again!.contentHash).toBe(s.contentHash);
    }
    expect(Array.from(second.keyBySymbol.entries()).sort()).toEqual(
      Array.from(result.keyBySymbol.entries()).sort()
    );
  });

  it('every key is the S-prefixed 12-hex-char content hash prefix', () => {
    for (const s of result.shapes) {
      expect(s.key).toMatch(/^S-[0-9a-f]{12}$/);
      expect(s.key.slice(2)).toBe(s.contentHash.slice(0, 12));
      expect(result.keyBySymbol.get(s.symbol)).toBe(s.key);
    }
  });
});
