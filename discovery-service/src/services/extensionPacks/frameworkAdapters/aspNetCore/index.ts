/**
 * ASP.NET Core Framework Adapter
 *
 * Detects classic controller-based MVC + Web API patterns:
 *   [ApiController] [Route("api/[controller]")] class FooController → interface
 *   [HttpGet("/path")] [HttpPost] [HttpPut] ... on methods → endpoint
 *   [FromBody] ParamType p → request body DTO reference
 *   class MyDbContext : DbContext { DbSet<Foo> Foos } → physical_entity Foo
 *   [Table("name")] / [Key] / [Column] on POCOs → physical_entity + physical_attribute
 *   class Foo : Controller → interface (MVC classic)
 *   Minimal APIs (app.MapGet/MapPost/etc. calls) are out of scope — would need
 *     module-level call extraction.
 */
import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR, ClassIR, FunctionIR, FieldIR, ParameterIR } from '../../languageIR';
import { hasAnnotation, findAnnotation, annotationArg } from '../../languageIR';

const HTTP_METHOD_ATTRIBUTES: Record<string, string> = {
  HttpGet: 'GET', HttpPost: 'POST', HttpPut: 'PUT', HttpDelete: 'DELETE',
  HttpPatch: 'PATCH', HttpOptions: 'OPTIONS', HttpHead: 'HEAD',
};

const CONTROLLER_ATTRIBUTES = ['ApiController', 'Controller'];
const CONTROLLER_BASE_TYPES = /(Controller|ControllerBase)$/;

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
    data: { ...data, _addedBy: 'aspnetcore-adapter' },
    synthesizedAt: new Date().toISOString(),
  };
  if (parentCandidateId) c.parentCandidateId = parentCandidateId;
  return c;
}

function stripQuotes(s: string | undefined): string {
  if (!s) return '';
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"'))) return t.slice(1, -1);
  return t;
}

function extractBasePath(cls: ClassIR): string {
  const ann = findAnnotation(cls.annotations, 'Route');
  if (!ann) return '';
  const raw = stripQuotes(annotationArg(ann, 'arg0'));
  // Replace [controller] token with classname (minus "Controller" suffix)
  return raw.replace(/\[controller\]/gi, cls.name.replace(/Controller$/, ''));
}

function isController(cls: ClassIR): boolean {
  if (CONTROLLER_ATTRIBUTES.some((a) => hasAnnotation(cls.annotations, a))) return true;
  if (cls.extends && CONTROLLER_BASE_TYPES.test(cls.extends)) return true;
  return false;
}

function extractHttpVerb(method: FunctionIR): { verb: string; path: string } | null {
  for (const [attr, verb] of Object.entries(HTTP_METHOD_ATTRIBUTES)) {
    const a = findAnnotation(method.annotations, attr);
    if (a) {
      const path = stripQuotes(annotationArg(a, 'arg0')) || '';
      return { verb, path };
    }
  }
  return null;
}

function composePath(base: string, route: string): string {
  const b = base.replace(/^\/+|\/+$/g, '');
  const r = route.replace(/^\/+|\/+$/g, '');
  if (!b && !r) return '/';
  if (!b) return '/' + r;
  if (!r) return '/' + b;
  return '/' + b + '/' + r;
}

function extractRequestBodyType(params: ParameterIR[]): string | undefined {
  for (const p of params) {
    if (hasAnnotation(p.annotations, 'FromBody')) return p.type;
  }
  return undefined;
}

interface AdapterOutput { candidates: DiscoveryCandidate[]; dtoNames: Set<string>; }

function processController(cls: ClassIR, file: SourceFileIR, runId: string, out: AdapterOutput): void {
  if (!isController(cls)) return;
  const basePath = extractBasePath(cls);
  const iface = makeCandidate('interfaces', cls.name, file.filePath, {
    basePath, controllerType: 'AspNetCoreController', className: cls.name,
  }, runId);
  out.candidates.push(iface);

  for (const method of cls.methods) {
    const http = extractHttpVerb(method);
    if (!http) continue;
    const fullPath = composePath(basePath, http.path);
    const bodyType = extractRequestBodyType(method.parameters);
    const responseType = method.returnType;

    const data: Record<string, unknown> = {
      httpMethod: http.verb, fullPath, methodName: method.name,
      controllerClassName: cls.name, returnType: responseType,
    };
    if (bodyType) { data.requestBodyType = bodyType; out.dtoNames.add(bodyType); }
    // Unwrap nested wrappers like ActionResult<List<ProductDto>> → ProductDto.
    // Strip outer generic layers (ActionResult, Task, IActionResult, List, IEnumerable, etc.)
    // until we hit a non-generic leaf type.
    let leaf = responseType.trim();
    let safety = 10;
    while (safety-- > 0) {
      const m = leaf.match(/^[A-Za-z_][A-Za-z0-9_.]*\s*<\s*(.+)\s*>$/);
      if (!m) break;
      leaf = m[1].trim();
      // If inner is a comma-separated generic arg list, take the LAST one (often the value type)
      if (leaf.includes(',')) leaf = leaf.split(',').pop()!.trim();
    }
    // Strip trailing ? (nullable) and [] (array)
    leaf = leaf.replace(/\?$|\[\]$/, '').trim();
    if (leaf && leaf !== responseType && /^[A-Z][A-Za-z0-9_]*$/.test(leaf)) {
      data.responseType = leaf;
      out.dtoNames.add(leaf);
    }

    out.candidates.push(makeCandidate('endpoints', `${http.verb} ${fullPath}`, file.filePath, data, runId, iface.id));
  }
}

function processEntityFrameworkContext(cls: ClassIR, file: SourceFileIR, runId: string, out: AdapterOutput): void {
  if (!cls.extends || !/DbContext$/.test(cls.extends)) return;
  // Each DbSet<T> property represents an entity mapped to a table.
  for (const field of cls.fields) {
    const m = field.type.match(/^DbSet\s*<\s*([A-Za-z_][A-Za-z0-9_]*)\s*>$/);
    if (!m) continue;
    const entityName = m[1];
    out.candidates.push(makeCandidate('physical_data_entities', entityName, file.filePath, {
      entityClassName: entityName, tableName: field.name, // convention: DbSet name = table name
      sourceDbContext: cls.name,
    }, runId));
  }
}

function processPocoEntityWithDataAnnotations(cls: ClassIR, file: SourceFileIR, runId: string, out: AdapterOutput): void {
  const tableAttr = findAnnotation(cls.annotations, 'Table');
  if (!tableAttr) return;
  const tableName = stripQuotes(annotationArg(tableAttr, 'arg0')) || cls.name;
  const entity = makeCandidate('physical_data_entities', cls.name, file.filePath, {
    entityClassName: cls.name, tableName,
  }, runId);
  out.candidates.push(entity);
  for (const field of cls.fields) {
    const isKey = hasAnnotation(field.annotations, 'Key');
    const colAttr = findAnnotation(field.annotations, 'Column');
    const notMapped = hasAnnotation(field.annotations, 'NotMapped');
    if (notMapped) continue;
    out.candidates.push(makeCandidate('physical_data_attributes', field.name, file.filePath, {
      fieldName: field.name, columnName: stripQuotes(annotationArg(colAttr, 'arg0')) || field.name,
      fieldType: field.type, isPrimaryKey: isKey, entityClassName: cls.name,
    }, runId, entity.id));
  }
}

function emitDtoLogicalEntities(files: SourceFileIR[], runId: string, out: AdapterOutput): void {
  if (out.dtoNames.size === 0) return;
  for (const file of files) {
    for (const cls of file.classes) {
      if (!out.dtoNames.has(cls.name)) continue;
      if (isController(cls)) continue;
      if (cls.fields.length === 0) continue;
      const logical = makeCandidate('logical_data_entities', cls.name, file.filePath, {
        className: cls.name, packageName: file.packageOrNamespace,
      }, runId);
      out.candidates.push(logical);
      for (const field of cls.fields) {
        out.candidates.push(makeCandidate('logical_data_attributes', field.name, file.filePath, {
          fieldName: field.name, dataType: field.type, logicalEntityName: cls.name,
        }, runId, logical.id));
      }
    }
  }
}

export function runAspNetCoreAdapter(files: SourceFileIR[], runId: string): DiscoveryCandidate[] {
  const out: AdapterOutput = { candidates: [], dtoNames: new Set() };
  for (const file of files) {
    for (const cls of file.classes) {
      processController(cls, file, runId, out);
      processEntityFrameworkContext(cls, file, runId, out);
      processPocoEntityWithDataAnnotations(cls, file, runId, out);
    }
  }
  emitDtoLogicalEntities(files, runId, out);
  return out.candidates;
}
