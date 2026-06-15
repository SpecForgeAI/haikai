/**
 * Django Framework Adapter
 *
 * Consumes Python SourceFileIR and emits DiscoveryCandidates for a Django
 * backend codebase.
 *
 * Detection model:
 *   Models are classes inheriting from models.Model (or descendants like
 *   ModelWithMetadata); fields are class-body assignments to `models.*Field`
 *   / `models.ForeignKey` / etc. which the Python extractor captured as
 *   synthetic annotations on FieldIR.
 *
 *   class Foo(models.Model):
 *     name = models.CharField(max_length=50)    → physical_attribute (CharField)
 *     author = models.ForeignKey(User, ...)     → entity_relationship (ForeignKey)
 *
 *   Views are function/class-based handlers. URL routing lives in urls.py
 *   files as `path('route/', view_fn, name='foo')`. We emit endpoints from
 *   urls.py when we can identify the url handlers.
 *
 *   Serializers (DRF) / Form classes → logical_entity + logical_data_attribute
 *
 *   Services (no stereotype in Django — convention-based): we emit
 *   business_logic for exported module-level functions in files under
 *   services.py / utils.py / domain/ directories whose names aren't CRUD.
 *
 * Scope (7 of 8 core types — UI types are frontend concerns):
 *   interface              — classes inheriting from APIView / ViewSet / View (class-based views)
 *   endpoint               — path()/url()/re_path()/include() in urls.py
 *   logical_entity         — DRF Serializer / ModelForm / Form / Pydantic-like dataclass
 *   logical_data_attribute — fields on logical_entity classes
 *   physical_entity        — classes extending (directly or via chain) models.Model
 *   physical_attribute     — models.*Field assignments
 *   entity_relationship    — ForeignKey / OneToOneField / ManyToManyField
 *   business_logic         — exported functions in services.py / utils.py / domain/
 */
import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR, ClassIR, FieldIR, FunctionIR } from '../../languageIR';
import { hasAnnotation, findAnnotation, annotationArg } from '../../languageIR';

const DJANGO_MODEL_BASE_RE = /(?:^|\.)Model$/;
const DJANGO_VIEW_BASE_RE = /(?:^|\.)(View|APIView|GenericAPIView|ViewSet|ModelViewSet|ReadOnlyModelViewSet|ListView|DetailView|CreateView|UpdateView|DeleteView|TemplateView|RedirectView|FormView)$/;
const DRF_SERIALIZER_BASE_RE = /(?:^|\.)(Serializer|ModelSerializer|HyperlinkedModelSerializer)$/;
const DJANGO_FORM_BASE_RE = /(?:^|\.)(Form|ModelForm)$/;

const DJANGO_RELATIONSHIP_DECORATORS = [
  'ForeignKey', 'OneToOneField', 'ManyToManyField',
];

// Any call whose function name ends in "Field" on a Django model = persistence column.
const DJANGO_COLUMN_SUFFIX_RE = /Field$/;

const BUSINESS_LOGIC_DIR_RE = /\/(services|service|domain|utils|helpers|business|logic)\//i;
const BUSINESS_LOGIC_FILE_RE = /\/(services|service|utils|helpers|domain|business|logic)\.py$/i;
const BUSINESS_LOGIC_EXCLUDE_PREFIXES = [
  'get', 'set', 'is', 'has', 'render', 'format', 'map', 'to',
  'create', 'update', 'delete', 'save', 'find', 'fetch', 'load', 'list', 'add', 'remove',
];

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
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [filePath],
    data: { ...data, _addedBy: 'django-adapter' },
    synthesizedAt: new Date().toISOString(),
  };
  if (parentCandidateId) c.parentCandidateId = parentCandidateId;
  return c;
}

function extendsBase(cls: ClassIR, re: RegExp): boolean {
  if (cls.extends && re.test(cls.extends)) return true;
  for (const impl of cls.implements) if (re.test(impl)) return true;
  return false;
}

// Build class index for inheritance traversal: Foo(ModelWithMetadata) where
// ModelWithMetadata(models.Model) should still count as a Django model.
type ClassIndex = Map<string, { cls: ClassIR; file: SourceFileIR }>;

function buildClassIndex(files: SourceFileIR[]): ClassIndex {
  const idx: ClassIndex = new Map();
  for (const f of files) for (const c of f.classes) idx.set(c.name, { cls: c, file: f });
  return idx;
}

function inheritsFromPattern(cls: ClassIR, index: ClassIndex, re: RegExp): boolean {
  if (extendsBase(cls, re)) return true;
  const visited = new Set<string>();
  let current = cls.extends;
  while (current) {
    if (visited.has(current)) break;
    visited.add(current);
    // Strip dotted prefix — "models.Model" → "Model"; keep last segment for lookup
    const shortName = current.includes('.') ? current.split('.').pop() || current : current;
    if (re.test(current) || re.test(shortName)) return true;
    const parent = index.get(shortName);
    if (!parent) break;
    current = parent.cls.extends;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Model processing
// ---------------------------------------------------------------------------

function processDjangoModel(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
  index: ClassIndex,
): void {
  if (!inheritsFromPattern(cls, index, DJANGO_MODEL_BASE_RE)) return;

  // Skip abstract intermediate classes — they should NOT be physical_entity.
  // Convention: Django abstract flag lives in Meta inner class. Without a Meta
  // visibility here we use a heuristic: names ending with "Abstract" or
  // "ModelWithMetadata"-style containers frequently are abstract. Be lenient
  // and still emit; downstream curation can tag.

  const entity = makeCandidate(
    'physical_data_entities',
    cls.name,
    file.filePath,
    {
      entityClassName: cls.name,
      tableName: cls.name.toLowerCase(), // Django default; real name lives in Meta.db_table
      moduleFile: file.filePath,
    },
    runId,
  );
  out.candidates.push(entity);

  for (const field of cls.fields) {
    if (field.name.startsWith('_')) continue;
    const firstAnn = field.annotations[0];
    if (!firstAnn) continue;

    // Relationship fields
    if (DJANGO_RELATIONSHIP_DECORATORS.includes(firstAnn.name)) {
      const targetRaw = annotationArg(firstAnn, 'arg0') || 'unknown';
      const target = targetRaw.replace(/^['"`]|['"`]$/g, ''); // strip quotes if it was a string literal
      const cardinality =
        firstAnn.name === 'ForeignKey' ? 'MANY_TO_ONE'
        : firstAnn.name === 'OneToOneField' ? 'ONE_TO_ONE'
        : firstAnn.name === 'ManyToManyField' ? 'MANY_TO_MANY'
        : 'ONE_TO_MANY';
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
      continue;
    }

    // Regular column — any call whose name ends in "Field"
    if (DJANGO_COLUMN_SUFFIX_RE.test(firstAnn.name)) {
      out.candidates.push(
        makeCandidate(
          'physical_data_attributes',
          field.name,
          file.filePath,
          {
            fieldName: field.name,
            columnName: field.name,
            fieldType: firstAnn.name, // e.g. "CharField"
            isPrimaryKey: annotationArg(firstAnn, 'primary_key') === 'True',
            isNullable: annotationArg(firstAnn, 'null') === 'True',
            entityClassName: cls.name,
          },
          runId,
          entity.id,
        ),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// View processing (class-based views → interface)
// ---------------------------------------------------------------------------

function processDjangoView(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
  index: ClassIndex,
): void {
  if (!inheritsFromPattern(cls, index, DJANGO_VIEW_BASE_RE)) return;
  out.candidates.push(
    makeCandidate(
      'interfaces',
      cls.name,
      file.filePath,
      {
        controllerType: 'DjangoClassBasedView',
        className: cls.name,
      },
      runId,
    ),
  );
  // We don't try to emit individual endpoints here — Django class-based views
  // map to routes in urls.py. That wiring is out of scope for this base pack
  // (would require cross-file URL-to-view resolution). The `interface` candidate
  // represents the handler class itself.
}

// ---------------------------------------------------------------------------
// Serializer / Form processing (logical_entity)
// ---------------------------------------------------------------------------

function processSerializer(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
  index: ClassIndex,
): void {
  const isSerializer = inheritsFromPattern(cls, index, DRF_SERIALIZER_BASE_RE);
  const isForm = inheritsFromPattern(cls, index, DJANGO_FORM_BASE_RE);
  if (!isSerializer && !isForm) return;

  const logical = makeCandidate(
    'logical_data_entities',
    cls.name,
    file.filePath,
    { className: cls.name, serializer: isSerializer, form: isForm },
    runId,
  );
  out.candidates.push(logical);

  for (const field of cls.fields) {
    if (field.name.startsWith('_')) continue;
    if (field.name === 'Meta') continue;
    out.candidates.push(
      makeCandidate(
        'logical_data_attributes',
        field.name,
        file.filePath,
        {
          fieldName: field.name,
          dataType: field.annotations[0]?.name || field.type,
          logicalEntityName: cls.name,
        },
        runId,
        logical.id,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// URL routing → endpoints (from urls.py)
// ---------------------------------------------------------------------------

function processUrlsModule(file: SourceFileIR, runId: string, out: AdapterOutput): void {
  if (!file.filePath.endsWith('urls.py')) return;

  // Look for top-level `urlpatterns = [...]` — we stored it as a field of no
  // owning class. Since Python extractor's top-level assignments aren't
  // captured yet, fall through to function calls: many urls.py expose
  // `path('prefix/', view, name='...')` inside the urlpatterns list but we
  // can't see list contents without IR extension. So this base pack emits
  // ONE synthetic endpoint per urls.py as a placeholder — adapters can
  // refine later.
  // NOTE: base pack gap — URL-to-view resolution requires either IR extension
  // for module-level expressions or a second pass. Flag and defer.
  out.candidates.push(
    makeCandidate(
      'endpoints',
      `DJANGO_URLS ${file.filePath}`,
      file.filePath,
      {
        endpoint_subtype: 'django_urls_placeholder',
        note: 'Base pack does not yet resolve urlpatterns list contents. Extend IR to capture module-level expressions.',
      },
      runId,
    ),
  );
}

// ---------------------------------------------------------------------------
// Business logic (module-level functions in services/utils/domain)
// ---------------------------------------------------------------------------

function processBusinessLogic(file: SourceFileIR, runId: string, out: AdapterOutput): void {
  const inBizDir = BUSINESS_LOGIC_DIR_RE.test(file.filePath) || BUSINESS_LOGIC_FILE_RE.test(file.filePath);
  if (!inBizDir) return;

  for (const fn of file.functions) {
    if (fn.name.startsWith('_')) continue;
    const lower = fn.name;
    let skip = false;
    for (const pfx of BUSINESS_LOGIC_EXCLUDE_PREFIXES) {
      if (lower.startsWith(pfx)) {
        const remainder = lower.slice(pfx.length);
        if (remainder === '' || /^_/.test(remainder)) { skip = true; break; }
      }
    }
    if (skip) continue;
    out.candidates.push(
      makeCandidate(
        'business_logics',
        fn.name,
        file.filePath,
        { returnType: fn.returnType, parameterCount: fn.parameters.length },
        runId,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

interface AdapterOutput { candidates: DiscoveryCandidate[]; }

export function runDjangoAdapter(files: SourceFileIR[], runId: string): DiscoveryCandidate[] {
  const out: AdapterOutput = { candidates: [] };
  const index = buildClassIndex(files);
  for (const file of files) {
    for (const cls of file.classes) {
      processDjangoModel(cls, file, runId, out, index);
      processDjangoView(cls, file, runId, out, index);
      processSerializer(cls, file, runId, out, index);
    }
    processUrlsModule(file, runId, out);
    processBusinessLogic(file, runId, out);
  }
  return out.candidates;
}
