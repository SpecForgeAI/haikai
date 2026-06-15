/**
 * Symfony Framework Adapter
 *
 * Detects Symfony 5+/6+/7+ patterns. Symfony 5+ uses PHP 8 attributes heavily:
 *
 *   #[Route('/articles', methods: ['GET'])]     → endpoint (class-level = base path; method-level = route)
 *   class FooController extends AbstractController → interface
 *   #[Entity] / #[ORM\Entity]                   → physical_entity (Doctrine)
 *   #[ORM\Column] / #[ORM\Id]                   → physical_attribute
 *   #[ORM\OneToMany] / ManyToOne / ManyToMany   → entity_relationship
 *   #[AsService] / #[AsCommand]                 → business_logic context
 *
 * Base pack covers the common PHP 8 attribute path. Older Symfony (3/4) used
 * annotations in PHPDoc comments (`@Route("/...")`) which this pack does NOT
 * parse — those need doc-comment scanning.
 */
import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR, ClassIR, FieldIR, FunctionIR } from '../../languageIR';
import { hasAnnotation, findAnnotation, annotationArg } from '../../languageIR';

const HTTP_METHODS_RE = /'(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)'/gi;
const CONTROLLER_BASE_RE = /(AbstractController|Controller)$/;
const DOCTRINE_RELATIONSHIP_ATTRS = /^(ORM\\)?(OneToOne|OneToMany|ManyToOne|ManyToMany)$/;
const DOCTRINE_COLUMN_ATTRS = /^(ORM\\)?(Column|Id|GeneratedValue|ManyToOne|OneToMany|OneToOne|ManyToMany)$/;

function makeCandidate(
  type: DiscoveryCandidate['candidateType'],
  name: string, filePath: string, data: Record<string, unknown>,
  runId: string, parentCandidateId?: string,
): DiscoveryCandidate {
  const c: DiscoveryCandidate = {
    id: uuidv4(), runId, candidateType: type, name, confidence: 0.85,
    status: 'proposed', sourceClusterIds: [filePath],
    data: { ...data, _addedBy: 'symfony-adapter' },
    synthesizedAt: new Date().toISOString(),
  };
  if (parentCandidateId) c.parentCandidateId = parentCandidateId;
  return c;
}

function stripPhpStringLiteral(s: string | undefined): string {
  if (!s) return '';
  const t = s.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) return t.slice(1, -1);
  return t;
}

function getRoutePath(attr: ReturnType<typeof findAnnotation>): string {
  if (!attr) return '';
  // Route attribute: `#[Route('/path')]` OR `#[Route(path: '/path')]`
  const p = annotationArg(attr, 'arg0') || annotationArg(attr, 'path');
  return stripPhpStringLiteral(p);
}

function getRouteMethods(attr: ReturnType<typeof findAnnotation>): string {
  if (!attr) return 'GET';
  const allArgs = Object.values(attr.args).join(' ');
  const m = allArgs.match(HTTP_METHODS_RE);
  if (m && m.length > 0) {
    const verb = m[0].replace(/'/g, '');
    return verb.toUpperCase();
  }
  return 'GET';
}

function isSymfonyController(cls: ClassIR): boolean {
  if (cls.extends && CONTROLLER_BASE_RE.test(cls.extends)) return true;
  // Also detect via #[AsController] attribute if present
  return hasAnnotation(cls.annotations, 'AsController');
}

function processController(cls: ClassIR, file: SourceFileIR, runId: string, out: AdapterOutput): void {
  if (!isSymfonyController(cls)) return;
  const classRoute = findAnnotation(cls.annotations, 'Route');
  const basePath = getRoutePath(classRoute);
  const iface = makeCandidate('interfaces', cls.name, file.filePath, {
    className: cls.name, controllerType: 'SymfonyController', basePath,
  }, runId);
  out.candidates.push(iface);

  for (const method of cls.methods) {
    const route = findAnnotation(method.annotations, 'Route');
    if (!route) continue;
    const path = getRoutePath(route);
    const verb = getRouteMethods(route);
    const full = (basePath + path).replace(/\/+/g, '/') || '/';
    out.candidates.push(makeCandidate('endpoints', `${verb} ${full}`, file.filePath, {
      httpMethod: verb, fullPath: full, methodName: method.name,
      controllerClassName: cls.name,
    }, runId, iface.id));
  }
}

function processDoctrineEntity(cls: ClassIR, file: SourceFileIR, runId: string, out: AdapterOutput): void {
  // #[ORM\Entity] or #[Entity]
  const entityAttr = cls.annotations.find((a) => a.name === 'ORM\\Entity' || a.name === 'Entity');
  if (!entityAttr) return;
  const tableAttr = cls.annotations.find((a) => a.name === 'ORM\\Table' || a.name === 'Table');
  const tableName = (stripPhpStringLiteral(annotationArg(tableAttr, 'arg0'))
    || stripPhpStringLiteral(annotationArg(tableAttr, 'name'))
    || cls.name.toLowerCase());
  const entity = makeCandidate('physical_data_entities', cls.name, file.filePath, {
    entityClassName: cls.name, tableName,
  }, runId);
  out.candidates.push(entity);

  for (const field of cls.fields) {
    const relAttr = field.annotations.find((a) => DOCTRINE_RELATIONSHIP_ATTRS.test(a.name));
    if (relAttr) {
      // target from `targetEntity: Foo::class` — simplistic
      const targetRaw = annotationArg(relAttr, 'targetEntity') || annotationArg(relAttr, 'arg0') || field.type;
      const target = targetRaw.replace(/::class$/, '').replace(/^.*\\/, '').trim();
      const relName = relAttr.name.replace(/^ORM\\/, '');
      const cardinality = relName.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '');
      out.candidates.push(makeCandidate('logical_data_entity_relationships', `${cls.name} → ${target}`, file.filePath, {
        sourceEntity: cls.name, targetEntity: target, cardinality,
        relationshipType: 'association', fieldName: field.name,
      }, runId));
      continue;
    }
    const colAttr = field.annotations.find((a) => a.name === 'ORM\\Column' || a.name === 'Column');
    const idAttr = field.annotations.find((a) => a.name === 'ORM\\Id' || a.name === 'Id');
    if (colAttr || idAttr) {
      out.candidates.push(makeCandidate('physical_data_attributes', field.name, file.filePath, {
        fieldName: field.name,
        columnName: stripPhpStringLiteral(annotationArg(colAttr, 'name')) || field.name,
        fieldType: stripPhpStringLiteral(annotationArg(colAttr, 'type')) || field.type,
        isPrimaryKey: !!idAttr,
        entityClassName: cls.name,
      }, runId, entity.id));
    }
  }
}

interface AdapterOutput { candidates: DiscoveryCandidate[]; }

export function runSymfonyAdapter(files: SourceFileIR[], runId: string): DiscoveryCandidate[] {
  const out: AdapterOutput = { candidates: [] };
  for (const file of files) {
    for (const cls of file.classes) {
      processController(cls, file, runId, out);
      processDoctrineEntity(cls, file, runId, out);
    }
  }
  return out.candidates;
}
