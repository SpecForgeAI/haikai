/**
 * NestJS Framework Adapter
 *
 * Consumes SourceFileIR produced by the TypeScript language extractor and
 * emits DiscoveryCandidates for a NestJS backend codebase.
 *
 * Scope (7 of the 8 core architecture types — UI types are not relevant for
 * a backend NestJS service):
 *
 *   interface                 — @Controller classes
 *   endpoint                  — @Get/@Post/@Put/@Delete/@Patch/@Options/@Head/@All methods
 *   logical_entity            — DTO classes referenced by @Body() params or return types
 *   logical_data_attribute    — fields on logical_entity classes
 *   physical_entity           — @Entity classes (TypeORM)
 *   physical_attribute        — @Column / @PrimaryGeneratedColumn fields
 *   entity_relationship       — @OneToOne / @OneToMany / @ManyToOne / @ManyToMany fields
 *   business_logic            — exported domain methods on @Injectable service classes
 *
 * Out of scope:
 * - UI types (ui_screen, ui_component) — NestJS is backend only.
 * - @Module metadata — not a candidate type.
 * - Mongoose @Schema — TypeORM is the primary target; Mongoose can be added later.
 * - Swagger decorators (@ApiTags, @ApiOperation, @ApiResponse) — documentation noise.
 */
import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR, ClassIR, FieldIR, FunctionIR, ParameterIR } from '../../languageIR';
import { hasAnnotation, findAnnotation, annotationArg } from '../../languageIR';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HTTP_METHOD_DECORATORS: Record<string, string> = {
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Delete: 'DELETE',
  Patch: 'PATCH',
  Options: 'OPTIONS',
  Head: 'HEAD',
  All: '*',
};

const TYPEORM_RELATIONSHIP_DECORATORS = ['OneToOne', 'OneToMany', 'ManyToOne', 'ManyToMany'];

const TYPEORM_COLUMN_DECORATORS = [
  'Column',
  'PrimaryColumn',
  'PrimaryGeneratedColumn',
  'CreateDateColumn',
  'UpdateDateColumn',
  'DeleteDateColumn',
  'VersionColumn',
  'Generated',
];

const BUSINESS_LOGIC_EXCLUDE_PREFIXES = [
  'get', 'set', 'is', 'has', 'render', 'format', 'map', 'to', 'toString',
  'create', 'update', 'delete', 'save', 'find', 'fetch', 'load', 'list', 'add', 'remove',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidate(
  type: DiscoveryCandidate['candidateType'],
  name: string,
  filePath: string,
  data: Record<string, unknown>,
  runId: string,
  parentCandidateId?: string,
): DiscoveryCandidate {
  const c: DiscoveryCandidate = {
    id: uuidv4(),
    runId,
    candidateType: type,
    name,
    confidence: 0.95,
    status: 'proposed',
    sourceClusterIds: [filePath],
    data: { ...data, _addedBy: 'nestjs-adapter' },
    synthesizedAt: new Date().toISOString(),
  };
  if (parentCandidateId) c.parentCandidateId = parentCandidateId;
  return c;
}

/**
 * NestJS decorators are passed as positional or object args. The first arg
 * of @Controller/@Get/etc. is usually a path literal. If it's an object
 * literal (e.g. `@Controller({ path: 'articles', version: '1' })`), try to
 * extract the `path` property.
 */
function extractPathLiteral(arg: string | undefined): string {
  if (!arg) return '';
  const trimmed = arg.trim();
  // String literal
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith('`') && trimmed.endsWith('`'))) {
    return trimmed.slice(1, -1);
  }
  // Object literal with `path:` — naive extraction
  const match = trimmed.match(/path\s*:\s*['"`]([^'"`]+)['"`]/);
  if (match) return match[1];
  return '';
}

function normalisePath(p: string): string {
  if (!p) return '';
  let v = p.trim();
  if (v.startsWith('/')) v = v.slice(1);
  return v;
}

function composeFullPath(base: string, method: string): string {
  const b = normalisePath(base);
  const m = normalisePath(method);
  if (!b && !m) return '/';
  if (!b) return '/' + m;
  if (!m) return '/' + b;
  return '/' + b + '/' + m;
}

/**
 * Strip generics, arrays, unions from a type string to find the core type name.
 * "Promise<UserDto>" -> "UserDto", "UserDto[]" -> "UserDto".
 */
function stripTypeWrappers(type: string): string {
  if (!type) return type;
  let t = type.trim();
  // Strip array []
  t = t.replace(/\[\]$/, '').trim();
  // Strip generic wrappers (Promise<T>, Observable<T>, etc.) — take last generic arg
  const gen = t.match(/^[A-Za-z_$][A-Za-z0-9_$]*\s*<\s*(.+)\s*>$/);
  if (gen) {
    // Take the whole inner — may still have wrappers; recurse once
    return stripTypeWrappers(gen[1]);
  }
  // Strip unions — take first type before |
  if (t.includes('|')) {
    const first = t.split('|')[0].trim();
    return stripTypeWrappers(first);
  }
  return t;
}

function isEndpointMethod(fn: FunctionIR): boolean {
  return Object.keys(HTTP_METHOD_DECORATORS).some((d) => hasAnnotation(fn.annotations, d));
}

function getHttpMethod(fn: FunctionIR): string {
  for (const [dec, http] of Object.entries(HTTP_METHOD_DECORATORS)) {
    if (hasAnnotation(fn.annotations, dec)) return http;
  }
  return 'GET';
}

function getEndpointPath(fn: FunctionIR): string {
  for (const dec of Object.keys(HTTP_METHOD_DECORATORS)) {
    const ann = findAnnotation(fn.annotations, dec);
    if (ann) return extractPathLiteral(annotationArg(ann, 'arg0'));
  }
  return '';
}

function getControllerBasePath(cls: ClassIR): string {
  const ann = findAnnotation(cls.annotations, 'Controller');
  if (!ann) return '';
  return extractPathLiteral(annotationArg(ann, 'arg0'));
}

function extractBodyType(params: ParameterIR[]): string | undefined {
  for (const p of params) {
    if (hasAnnotation(p.annotations, 'Body')) {
      return stripTypeWrappers(p.type);
    }
  }
  return undefined;
}

function extractPathParams(
  params: ParameterIR[],
): Array<{ name: string; type: string }> {
  const out: Array<{ name: string; type: string }> = [];
  for (const p of params) {
    const ann = findAnnotation(p.annotations, 'Param');
    if (!ann) continue;
    const explicit = annotationArg(ann, 'arg0');
    const name = explicit ? extractPathLiteral(explicit) || p.name : p.name;
    out.push({ name, type: stripTypeWrappers(p.type) });
  }
  return out;
}

function extractQueryParams(
  params: ParameterIR[],
): Array<{ name: string; type: string }> {
  const out: Array<{ name: string; type: string }> = [];
  for (const p of params) {
    const ann = findAnnotation(p.annotations, 'Query');
    if (!ann) continue;
    const explicit = annotationArg(ann, 'arg0');
    const name = explicit ? extractPathLiteral(explicit) || p.name : p.name;
    out.push({ name, type: stripTypeWrappers(p.type) });
  }
  return out;
}

function mapCardinality(dec: string): string {
  return dec.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, ''); // OneToMany → ONE_TO_MANY
}

/**
 * TypeORM relationship field type annotation is the target entity name
 * (e.g. `author: UserEntity` -> UserEntity). For array types
 * (`comments: Comment[]`), strip the `[]`. Generic wrappers are rare here.
 */
function getRelationshipTargetFromField(field: FieldIR): string {
  return stripTypeWrappers(field.type);
}

function isBusinessLogicMethod(fn: FunctionIR): boolean {
  // Skip constructor
  if (fn.name === 'constructor') return false;
  // Skip HTTP endpoints (handled separately)
  if (isEndpointMethod(fn)) return false;
  // Skip private methods
  if (fn.modifiers.includes('private')) return false;
  // Skip CRUD/accessor prefixes
  const lower = fn.name.replace(/^_/, '');
  for (const prefix of BUSINESS_LOGIC_EXCLUDE_PREFIXES) {
    if (lower.startsWith(prefix)) {
      const remainder = lower.slice(prefix.length);
      if (remainder === '' || /^[A-Z]/.test(remainder)) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Per-class processors
// ---------------------------------------------------------------------------

interface AdapterOutput {
  candidates: DiscoveryCandidate[];
  dtoTypeNames: Set<string>;
}

function processController(cls: ClassIR, file: SourceFileIR, runId: string, out: AdapterOutput): void {
  if (!hasAnnotation(cls.annotations, 'Controller')) return;

  const basePath = getControllerBasePath(cls);
  const interfaceCandidate = makeCandidate(
    'interfaces',
    cls.name,
    file.filePath,
    {
      basePath,
      controllerType: 'NestController',
      className: cls.name,
    },
    runId,
  );
  out.candidates.push(interfaceCandidate);

  for (const method of cls.methods) {
    if (!isEndpointMethod(method)) continue;

    const httpMethod = getHttpMethod(method);
    const methodPath = getEndpointPath(method);
    const fullPath = composeFullPath(basePath, methodPath);
    const bodyType = extractBodyType(method.parameters);
    const pathParams = extractPathParams(method.parameters);
    const queryParams = extractQueryParams(method.parameters);
    const returnType = stripTypeWrappers(method.returnType);

    const data: Record<string, unknown> = {
      httpMethod,
      fullPath,
      methodName: method.name,
      controllerClassName: cls.name,
      returnType: method.returnType,
    };
    if (returnType && returnType !== 'unknown' && returnType !== 'void' && returnType !== 'any') {
      data.responseType = returnType;
      out.dtoTypeNames.add(returnType);
    }
    if (bodyType) {
      data.requestBodyType = bodyType;
      out.dtoTypeNames.add(bodyType);
    }
    if (pathParams.length > 0) data.pathVariables = pathParams;
    if (queryParams.length > 0) data.requestParams = queryParams;

    out.candidates.push(
      makeCandidate(
        'endpoints',
        `${httpMethod} ${fullPath}`,
        file.filePath,
        data,
        runId,
        interfaceCandidate.id,
      ),
    );
  }
}

function processTypeOrmEntity(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
): void {
  if (!hasAnnotation(cls.annotations, 'Entity')) return;

  const entityAnn = findAnnotation(cls.annotations, 'Entity');
  const tableNameArg = annotationArg(entityAnn, 'arg0');
  const tableName = tableNameArg ? extractPathLiteral(tableNameArg) || cls.name : cls.name;

  const entity = makeCandidate(
    'physical_data_entities',
    cls.name,
    file.filePath,
    {
      entityClassName: cls.name,
      tableName,
    },
    runId,
  );
  out.candidates.push(entity);

  // Columns & relationships
  for (const field of cls.fields) {
    const isRelationship = TYPEORM_RELATIONSHIP_DECORATORS.some((d) =>
      hasAnnotation(field.annotations, d),
    );
    if (isRelationship) {
      for (const dec of TYPEORM_RELATIONSHIP_DECORATORS) {
        if (!hasAnnotation(field.annotations, dec)) continue;
        const target = getRelationshipTargetFromField(field);
        const cardinality = mapCardinality(dec);
        out.candidates.push(
          makeCandidate(
            'logical_data_entity_relationships',
            `${cls.name} → ${target}`,
            file.filePath,
            {
              sourceEntity: cls.name,
              targetEntity: target,
              cardinality,
              relationshipType: 'association',
              fieldName: field.name,
            },
            runId,
          ),
        );
        break;
      }
      continue;
    }

    const isColumn = TYPEORM_COLUMN_DECORATORS.some((d) => hasAnnotation(field.annotations, d));
    if (!isColumn) continue; // TypeORM is explicit: fields without a column decorator are not persisted

    const isPrimaryKey =
      hasAnnotation(field.annotations, 'PrimaryColumn') ||
      hasAnnotation(field.annotations, 'PrimaryGeneratedColumn');

    const colAnn = findAnnotation(field.annotations, 'Column')
      || findAnnotation(field.annotations, 'PrimaryColumn')
      || findAnnotation(field.annotations, 'PrimaryGeneratedColumn');
    const colArg = annotationArg(colAnn, 'arg0');
    let columnName = field.name;
    if (colArg) {
      const asLiteral = extractPathLiteral(colArg);
      if (asLiteral && /^[a-z_][a-z0-9_]*$/i.test(asLiteral)) columnName = asLiteral;
    }

    out.candidates.push(
      makeCandidate(
        'physical_data_attributes',
        field.name,
        file.filePath,
        {
          fieldName: field.name,
          columnName,
          fieldType: field.type,
          isPrimaryKey,
          isNullable: true,
          entityClassName: cls.name,
        },
        runId,
        entity.id,
      ),
    );
  }
}

function processInjectableService(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
): void {
  if (!hasAnnotation(cls.annotations, 'Injectable')) return;
  // Skip classes that are also controllers or entities (handled elsewhere)
  if (hasAnnotation(cls.annotations, 'Controller')) return;
  if (hasAnnotation(cls.annotations, 'Entity')) return;

  for (const method of cls.methods) {
    if (!isBusinessLogicMethod(method)) continue;
    out.candidates.push(
      makeCandidate(
        'business_logics',
        method.name,
        file.filePath,
        {
          className: cls.name,
          returnType: method.returnType,
          parameterCount: method.parameters.length,
        },
        runId,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Second-pass: emit logical_entity for DTOs referenced by endpoints
// ---------------------------------------------------------------------------

function emitLogicalEntities(files: SourceFileIR[], runId: string, out: AdapterOutput): void {
  if (out.dtoTypeNames.size === 0) return;

  const targets = new Set<string>();
  for (const n of out.dtoTypeNames) targets.add(n);

  for (const file of files) {
    for (const cls of file.classes) {
      if (!targets.has(cls.name)) continue;
      // Skip @Entity (that's a physical_entity) and @Controller classes
      if (hasAnnotation(cls.annotations, 'Entity')) continue;
      if (hasAnnotation(cls.annotations, 'Controller')) continue;
      if (cls.fields.length === 0) continue;

      const logical = makeCandidate(
        'logical_data_entities',
        cls.name,
        file.filePath,
        { className: cls.name, isInterface: cls.isInterface },
        runId,
      );
      out.candidates.push(logical);

      for (const field of cls.fields) {
        if (field.modifiers.includes('static')) continue;
        out.candidates.push(
          makeCandidate(
            'logical_data_attributes',
            field.name,
            file.filePath,
            {
              fieldName: field.name,
              dataType: field.type,
              logicalEntityName: cls.name,
            },
            runId,
            logical.id,
          ),
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function runNestjsAdapter(
  files: SourceFileIR[],
  runId: string,
): DiscoveryCandidate[] {
  const out: AdapterOutput = { candidates: [], dtoTypeNames: new Set() };

  for (const file of files) {
    for (const cls of file.classes) {
      if (cls.isInterface) continue; // skip TS interfaces themselves
      processController(cls, file, runId, out);
      processTypeOrmEntity(cls, file, runId, out);
      processInjectableService(cls, file, runId, out);
    }
  }

  // Second pass: emit DTOs referenced by endpoints
  emitLogicalEntities(files, runId, out);

  return out.candidates;
}
