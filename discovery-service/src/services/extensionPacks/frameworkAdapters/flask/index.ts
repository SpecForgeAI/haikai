/**
 * Flask Framework Adapter
 *
 * Detects Flask route decorators on top-level functions and Blueprint method
 * registrations. Flask is idiomatically FUNCTION-based, not class-based.
 *
 *   @app.route('/path', methods=['GET'])        → endpoint
 *   @app.get('/x') / @app.post('/y') (Flask 2+) → endpoint
 *   @blueprint.route('/x')                      → endpoint
 *   class Foo(db.Model)  (SQLAlchemy)           → physical_entity
 *   name = db.Column(db.String(50))             → physical_attribute
 *   class FooSchema(ma.Schema)                  → logical_entity (Marshmallow)
 *   class FooForm(FlaskForm)                    → logical_entity (WTForms)
 */
import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR, ClassIR, FieldIR, FunctionIR } from '../../languageIR';
import { hasAnnotation, findAnnotation, annotationArg } from '../../languageIR';

const HTTP_METHOD_VERBS = ['get', 'post', 'put', 'delete', 'patch'];
const SQLALCHEMY_COLUMN_DECS = /(^|\.)Column$/;
const SQLALCHEMY_REL_DECS = /(^|\.)relationship$/;
const MODEL_BASE_RE = /(?:^|\.)Model$/;
const MARSHMALLOW_SCHEMA_RE = /(?:^|\.)Schema$/;
const WTFORMS_BASE_RE = /(?:^|\.)(Form|FlaskForm)$/;

function makeCandidate(
  type: DiscoveryCandidate['candidateType'],
  name: string,
  filePath: string,
  data: Record<string, unknown>,
  runId: string,
  parentCandidateId?: string,
): DiscoveryCandidate {
  const c: DiscoveryCandidate = {
    id: uuidv4(), runId, candidateType: type, name, confidence: 0.9,
    status: 'proposed', sourceClusterIds: [filePath],
    data: { ...data, _addedBy: 'flask-adapter' },
    synthesizedAt: new Date().toISOString(),
  };
  if (parentCandidateId) c.parentCandidateId = parentCandidateId;
  return c;
}

function stripQuotes(s: string | undefined): string {
  if (!s) return '';
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) ||
      (t.startsWith("'") && t.endsWith("'")) ||
      (t.startsWith('`') && t.endsWith('`'))) return t.slice(1, -1);
  return t;
}

/**
 * For `@app.route('/x')` / `@app.get('/x')` / `@blueprint.route(...)`,
 * the decorator name in IR is captured as the LAST segment by the Python
 * extractor (e.g. `route` or `get`). We need to also check annotation args.
 */
function extractRouteFromFunction(fn: FunctionIR): { verb: string; path: string } | null {
  for (const ann of fn.annotations) {
    // Annotation names may be dotted (e.g. "app.route", "blueprint.get").
    // Take the last segment to match verb / "route" regardless of receiver.
    const full = ann.name;
    const last = full.includes('.') ? full.split('.').pop()! : full;
    // Shorthand verbs (Flask 2+)
    if (HTTP_METHOD_VERBS.includes(last)) {
      return { verb: last.toUpperCase(), path: stripQuotes(annotationArg(ann, 'arg0')) };
    }
    // Canonical `.route(...)`. Args: first positional is path; `methods=['GET','POST']` kwarg.
    if (last === 'route') {
      const path = stripQuotes(annotationArg(ann, 'arg0'));
      const methods = annotationArg(ann, 'methods') || '';
      const m = methods.match(/['"`](GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)['"`]/i);
      return { verb: m ? m[1].toUpperCase() : 'GET', path };
    }
  }
  return null;
}

interface AdapterOutput { candidates: DiscoveryCandidate[]; }

function processFlaskRoutes(file: SourceFileIR, runId: string, out: AdapterOutput): void {
  for (const fn of file.functions) {
    const r = extractRouteFromFunction(fn);
    if (!r) continue;
    out.candidates.push(
      makeCandidate('endpoints', `${r.verb} ${r.path || '/'}`, file.filePath, {
        httpMethod: r.verb, fullPath: r.path, methodName: fn.name,
        parameterCount: fn.parameters.length, endpoint_subtype: 'flask_route',
      }, runId),
    );
  }
}

function processSqlAlchemyModel(cls: ClassIR, file: SourceFileIR, runId: string, out: AdapterOutput, index: ClassIndex): void {
  if (!inheritsFromPattern(cls, index, MODEL_BASE_RE)) return;
  const entity = makeCandidate('physical_data_entities', cls.name, file.filePath, {
    entityClassName: cls.name, tableName: cls.name.toLowerCase(),
  }, runId);
  out.candidates.push(entity);

  for (const field of cls.fields) {
    if (field.name.startsWith('_')) continue;
    const firstAnn = field.annotations[0];
    if (!firstAnn) continue;
    if (SQLALCHEMY_REL_DECS.test(firstAnn.name)) {
      // e.g. `posts = relationship('Post', backref='author')`
      const targetRaw = annotationArg(firstAnn, 'arg0') || 'unknown';
      const target = targetRaw.replace(/^['"`]|['"`]$/g, '');
      out.candidates.push(
        makeCandidate('logical_data_entity_relationships', `${cls.name} → ${target}`, file.filePath, {
          sourceEntity: cls.name, targetEntity: target,
          cardinality: 'ONE_TO_MANY', // SQLAlchemy relationship() doesn't declare cardinality directly
          relationshipType: 'association', fieldName: field.name,
        }, runId),
      );
      continue;
    }
    if (SQLALCHEMY_COLUMN_DECS.test(firstAnn.name)) {
      out.candidates.push(
        makeCandidate('physical_data_attributes', field.name, file.filePath, {
          fieldName: field.name, columnName: field.name,
          fieldType: annotationArg(firstAnn, 'arg0') || 'unknown',
          isPrimaryKey: annotationArg(firstAnn, 'primary_key') === 'True',
          entityClassName: cls.name,
        }, runId, entity.id),
      );
    }
  }
}

function processSchemaOrForm(cls: ClassIR, file: SourceFileIR, runId: string, out: AdapterOutput, index: ClassIndex): void {
  const isSchema = inheritsFromPattern(cls, index, MARSHMALLOW_SCHEMA_RE);
  const isForm = inheritsFromPattern(cls, index, WTFORMS_BASE_RE);
  if (!isSchema && !isForm) return;
  const logical = makeCandidate('logical_data_entities', cls.name, file.filePath, {
    className: cls.name, marshmallow: isSchema, wtforms: isForm,
  }, runId);
  out.candidates.push(logical);
  for (const field of cls.fields) {
    if (field.name.startsWith('_')) continue;
    if (field.name === 'Meta') continue;
    out.candidates.push(
      makeCandidate('logical_data_attributes', field.name, file.filePath, {
        fieldName: field.name, dataType: field.annotations[0]?.name || field.type,
        logicalEntityName: cls.name,
      }, runId, logical.id),
    );
  }
}

// ---------------------------------------------------------------------------
// Class inheritance helpers (shared with django pattern)
// ---------------------------------------------------------------------------

type ClassIndex = Map<string, { cls: ClassIR; file: SourceFileIR }>;

function buildClassIndex(files: SourceFileIR[]): ClassIndex {
  const idx: ClassIndex = new Map();
  for (const f of files) for (const c of f.classes) idx.set(c.name, { cls: c, file: f });
  return idx;
}

function extendsBase(cls: ClassIR, re: RegExp): boolean {
  if (cls.extends && re.test(cls.extends)) return true;
  for (const impl of cls.implements) if (re.test(impl)) return true;
  return false;
}

function inheritsFromPattern(cls: ClassIR, index: ClassIndex, re: RegExp): boolean {
  if (extendsBase(cls, re)) return true;
  const visited = new Set<string>();
  let current = cls.extends;
  while (current) {
    if (visited.has(current)) break;
    visited.add(current);
    const shortName = current.includes('.') ? current.split('.').pop() || current : current;
    if (re.test(current) || re.test(shortName)) return true;
    const parent = index.get(shortName);
    if (!parent) break;
    current = parent.cls.extends;
  }
  return false;
}

export function runFlaskAdapter(files: SourceFileIR[], runId: string): DiscoveryCandidate[] {
  const out: AdapterOutput = { candidates: [] };
  const index = buildClassIndex(files);
  for (const file of files) {
    processFlaskRoutes(file, runId, out);
    for (const cls of file.classes) {
      processSqlAlchemyModel(cls, file, runId, out, index);
      processSchemaOrForm(cls, file, runId, out, index);
    }
  }
  return out.candidates;
}
