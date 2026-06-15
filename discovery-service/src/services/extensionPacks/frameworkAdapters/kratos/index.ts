/**
 * Kratos Framework Adapter (Go) — BASE/stub.
 *
 * Kratos is Bilibili's Go microservice framework — niche outside China, so
 * this adapter is intentionally thin and WILL need real-code refinement.
 *
 * Detects:
 *   Struct types → physical_entity (if `gorm:` struct tag present) or
 *                  logical_entity (if `json:` only, i.e. DTO-style)
 *   Struct fields → physical_attribute / logical_data_attribute
 *   Service interface types (InterfaceX) → interface (gRPC service contract)
 *   Functions inside `*_http.go` / `*_grpc.go` / calls to `srv.Handle(...)` →
 *     endpoint (best-effort — Kratos endpoints are typically generated from
 *     .proto files, which this pack doesn't parse).
 *
 * OUT of scope:
 *   - .proto file parsing (gRPC service definitions)
 *   - Wire dependency injection graph
 *   - Middleware chains
 *   - Biz/Data/Service layering conventions
 */
import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR, ClassIR, FieldIR } from '../../languageIR';
import { hasAnnotation, findAnnotation, annotationArg } from '../../languageIR';

function makeCandidate(
  type: DiscoveryCandidate['candidateType'],
  name: string, filePath: string, data: Record<string, unknown>,
  runId: string, parentCandidateId?: string,
): DiscoveryCandidate {
  const c: DiscoveryCandidate = {
    id: uuidv4(), runId, candidateType: type, name, confidence: 0.8,
    status: 'proposed', sourceClusterIds: [filePath],
    data: { ...data, _addedBy: 'kratos-adapter' },
    synthesizedAt: new Date().toISOString(),
  };
  if (parentCandidateId) c.parentCandidateId = parentCandidateId;
  return c;
}

interface AdapterOutput { candidates: DiscoveryCandidate[]; }

function processStruct(cls: ClassIR, file: SourceFileIR, runId: string, out: AdapterOutput): void {
  if (cls.isInterface) return;
  // If ANY field has a `gorm:` tag, treat as physical_entity (DB-backed).
  // If fields have only `json:` tags, treat as logical_entity (DTO).
  const hasGormTag = cls.fields.some((f) => hasAnnotation(f.annotations, 'gorm'));
  const hasJsonTag = cls.fields.some((f) => hasAnnotation(f.annotations, 'json'));
  if (!hasGormTag && !hasJsonTag) return;

  if (hasGormTag) {
    const entity = makeCandidate('physical_data_entities', cls.name, file.filePath, {
      entityClassName: cls.name, tableName: cls.name.toLowerCase() + 's',
    }, runId);
    out.candidates.push(entity);
    for (const f of cls.fields) {
      const gorm = findAnnotation(f.annotations, 'gorm');
      const colName = (annotationArg(gorm, 'value') || '').match(/column:([^;]+)/)?.[1] || f.name;
      out.candidates.push(
        makeCandidate('physical_data_attributes', f.name, file.filePath, {
          fieldName: f.name, columnName: colName, fieldType: f.type,
          isPrimaryKey: /(^|,)primaryKey/.test(annotationArg(gorm, 'value') || ''),
          entityClassName: cls.name,
        }, runId, entity.id),
      );
    }
  } else if (hasJsonTag) {
    // Pure JSON DTO struct
    const logical = makeCandidate('logical_data_entities', cls.name, file.filePath, {
      className: cls.name, packageName: file.packageOrNamespace,
    }, runId);
    out.candidates.push(logical);
    for (const f of cls.fields) {
      out.candidates.push(
        makeCandidate('logical_data_attributes', f.name, file.filePath, {
          fieldName: f.name, dataType: f.type, logicalEntityName: cls.name,
        }, runId, logical.id),
      );
    }
  }
}

function processServiceInterface(cls: ClassIR, file: SourceFileIR, runId: string, out: AdapterOutput): void {
  if (!cls.isInterface) return;
  // Kratos gRPC-generated interfaces typically end with "Server" / "Client"
  if (!/Server$|Service$|Client$/.test(cls.name)) return;
  out.candidates.push(
    makeCandidate('interfaces', cls.name, file.filePath, {
      className: cls.name, controllerType: 'KratosService',
    }, runId),
  );
}

export function runKratosAdapter(files: SourceFileIR[], runId: string): DiscoveryCandidate[] {
  const out: AdapterOutput = { candidates: [] };
  for (const file of files) {
    for (const cls of file.classes) {
      processStruct(cls, file, runId, out);
      processServiceInterface(cls, file, runId, out);
    }
  }
  return out.candidates;
}
