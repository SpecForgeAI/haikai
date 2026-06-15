/**
 * Ruby on Rails Framework Adapter
 *
 * Detects Rails-idiomatic patterns in Ruby classes:
 *   class FooController < ApplicationController   → interface
 *   def index / def show / def create / ...       → endpoint (conventional action methods)
 *   class Foo < ApplicationRecord                 → physical_entity
 *   has_many :bars / belongs_to :baz              → entity_relationship
 *   class FooSerializer < ActiveModel::Serializer → logical_entity (AMS) — if present
 *
 * NOT in scope:
 *   - config/routes.rb DSL parsing (resources :users, scope '/api' { ... })
 *   - db/schema.rb → physical_attribute discovery
 *   - ActiveRecord attr_* macros → field-level annotations
 *   - ActionMailer / ActionCable / ActiveJob
 */
import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR, ClassIR, FunctionIR } from '../../languageIR';
import { hasAnnotation, annotationArg, findAnnotation } from '../../languageIR';

const CONTROLLER_BASE_RE = /(ApplicationController|ActionController::Base|ActionController::API)$/;
const MODEL_BASE_RE = /(ApplicationRecord|ActiveRecord::Base)$/;
const SERIALIZER_BASE_RE = /(ActiveModel::Serializer)$/;

const ACTION_METHOD_TO_VERB: Record<string, string> = {
  index: 'GET', show: 'GET', new: 'GET', edit: 'GET',
  create: 'POST', update: 'PUT', destroy: 'DELETE',
};

const RELATIONSHIP_MACROS = ['has_many', 'has_one', 'belongs_to', 'has_and_belongs_to_many'];

function makeCandidate(
  type: DiscoveryCandidate['candidateType'],
  name: string,
  filePath: string,
  data: Record<string, unknown>,
  runId: string,
  parentCandidateId?: string,
): DiscoveryCandidate {
  const c: DiscoveryCandidate = {
    id: uuidv4(), runId, candidateType: type, name, confidence: 0.85,
    status: 'proposed', sourceClusterIds: [filePath],
    data: { ...data, _addedBy: 'rails-adapter' },
    synthesizedAt: new Date().toISOString(),
  };
  if (parentCandidateId) c.parentCandidateId = parentCandidateId;
  return c;
}

type ClassIndex = Map<string, { cls: ClassIR; file: SourceFileIR }>;

function buildClassIndex(files: SourceFileIR[]): ClassIndex {
  const idx: ClassIndex = new Map();
  for (const f of files) for (const c of f.classes) idx.set(c.name, { cls: c, file: f });
  return idx;
}

function inheritsFromPattern(cls: ClassIR, index: ClassIndex, re: RegExp): boolean {
  if (cls.extends && re.test(cls.extends)) return true;
  const visited = new Set<string>();
  let current = cls.extends;
  while (current) {
    if (visited.has(current)) break;
    visited.add(current);
    if (re.test(current)) return true;
    const parent = index.get(current);
    if (!parent) break;
    current = parent.cls.extends;
  }
  return false;
}

function processController(cls: ClassIR, file: SourceFileIR, runId: string, out: AdapterOutput, index: ClassIndex): void {
  if (!inheritsFromPattern(cls, index, CONTROLLER_BASE_RE)) return;
  // Derive the resource name from the controller class: UsersController → users
  const resource = cls.name.replace(/Controller$/, '').toLowerCase();
  const iface = makeCandidate('interfaces', cls.name, file.filePath, {
    className: cls.name, controllerType: 'RailsController', resource,
  }, runId);
  out.candidates.push(iface);

  for (const method of cls.methods) {
    const verb = ACTION_METHOD_TO_VERB[method.name];
    if (!verb) continue;
    // Emit conventional REST endpoints. Path inference:
    //   index/create → /<resource>
    //   show/update/destroy → /<resource>/:id
    //   new → /<resource>/new
    //   edit → /<resource>/:id/edit
    let path = `/${resource}`;
    if (method.name === 'show' || method.name === 'update' || method.name === 'destroy') path = `/${resource}/:id`;
    else if (method.name === 'new') path = `/${resource}/new`;
    else if (method.name === 'edit') path = `/${resource}/:id/edit`;
    out.candidates.push(makeCandidate('endpoints', `${verb} ${path}`, file.filePath, {
      httpMethod: verb, fullPath: path, methodName: method.name,
      controllerClassName: cls.name, inferredFromConvention: true,
    }, runId, iface.id));
  }
}

function processActiveRecordModel(cls: ClassIR, file: SourceFileIR, runId: string, out: AdapterOutput, index: ClassIndex): void {
  if (!inheritsFromPattern(cls, index, MODEL_BASE_RE)) return;
  const entity = makeCandidate('physical_data_entities', cls.name, file.filePath, {
    entityClassName: cls.name, tableName: cls.name.toLowerCase() + 's', // Rails convention pluralise — simplistic
  }, runId);
  out.candidates.push(entity);

  // Relationships: has_many :posts, belongs_to :author, has_one :profile, etc.
  for (const ann of cls.annotations) {
    if (!RELATIONSHIP_MACROS.includes(ann.name)) continue;
    // first arg is a symbol: :posts → target = Post (singular, capitalised)
    const arg0 = (ann.args.arg0 || '').replace(/^:/, '');
    if (!arg0) continue;
    const targetCapitalised = ann.name === 'belongs_to' || ann.name === 'has_one'
      ? arg0.charAt(0).toUpperCase() + arg0.slice(1)
      : arg0.replace(/s$/, '').charAt(0).toUpperCase() + arg0.replace(/s$/, '').slice(1);
    const cardinality =
      ann.name === 'has_many' ? 'ONE_TO_MANY'
      : ann.name === 'has_one' ? 'ONE_TO_ONE'
      : ann.name === 'belongs_to' ? 'MANY_TO_ONE'
      : 'MANY_TO_MANY';
    out.candidates.push(
      makeCandidate('logical_data_entity_relationships', `${cls.name} → ${targetCapitalised}`, file.filePath, {
        sourceEntity: cls.name, targetEntity: targetCapitalised, cardinality,
        relationshipType: 'association', fieldName: arg0,
      }, runId),
    );
  }
}

function processSerializer(cls: ClassIR, file: SourceFileIR, runId: string, out: AdapterOutput, index: ClassIndex): void {
  if (!inheritsFromPattern(cls, index, SERIALIZER_BASE_RE)) return;
  out.candidates.push(makeCandidate('logical_data_entities', cls.name, file.filePath, {
    className: cls.name, serializer: true,
  }, runId));
  // Serializer attributes come via `attributes :name, :email` macro — capture from annotations
  for (const ann of cls.annotations) {
    if (ann.name !== 'attributes' && ann.name !== 'attribute') continue;
    for (const key of Object.keys(ann.args)) {
      if (!key.startsWith('arg')) continue;
      const fieldName = ann.args[key].replace(/^:/, '').trim();
      if (!fieldName) continue;
      out.candidates.push(makeCandidate('logical_data_attributes', fieldName, file.filePath, {
        fieldName, dataType: 'unknown', logicalEntityName: cls.name,
      }, runId));
    }
  }
}

interface AdapterOutput { candidates: DiscoveryCandidate[]; }

export function runRailsAdapter(files: SourceFileIR[], runId: string): DiscoveryCandidate[] {
  const out: AdapterOutput = { candidates: [] };
  const index = buildClassIndex(files);
  for (const file of files) {
    for (const cls of file.classes) {
      processController(cls, file, runId, out, index);
      processActiveRecordModel(cls, file, runId, out, index);
      processSerializer(cls, file, runId, out, index);
    }
  }
  return out.candidates;
}
