import type { DiscoveryCandidateDto } from '../../api/discoveryApi';

export const SUPPORTED_DETAIL_TYPES: ReadonlySet<string> = new Set<string>([
  'endpoints',
  'interfaces',
  'logical_data_entities',
  'interface_logical_entities',
  'endpoint_data_effects',
  'business_logics',
  'logical_data_attributes',
  // Spec 2026-05-30 Outbound Integration Graph (Spec #5) -- Task Group 6:
  // the OUTBOUND-integration edge candidate. Enabling it here flips the
  // existing per-row "Show Details" toggle on for `data_movements` rows so
  // the source -> target / movement-kind block renders in the EXISTING
  // candidate-details surface (no bespoke widget).
  'data_movements',
  // Spec 2026-05-30 Data-Layer Fidelity 2 (Spec #6) -- Task Group H: the
  // `physical_data_attributes` column candidate. Enabling it here flips the
  // existing per-row "Show Details" toggle on so the Spec-3 structural
  // metadata (source_type / column_default / is_identity / ...) PLUS the new
  // collation / computed-column (is_generated + generation_expression) signals
  // render in the EXISTING candidate-details surface (no bespoke widget).
  'physical_data_attributes',
]);

export function supportsDetails(candidateType: string): boolean {
  if (!candidateType) {
    return false;
  }
  return SUPPORTED_DETAIL_TYPES.has(candidateType);
}

export interface SoapFieldMetadata {
  cardinality?: {
    min_occurs?: number;
    max_occurs?: number | 'unbounded' | string;
    is_collection?: boolean;
  };
  xsd_source_type?: string;
  source?: string;
  restrictions?: {
    enumeration?: unknown;
    pattern?: unknown;
    min_length?: unknown;
    max_length?: unknown;
    min_inclusive?: unknown;
    max_inclusive?: unknown;
    total_digits?: unknown;
    fraction_digits?: unknown;
    [key: string]: unknown;
  };
  complex_type_ref?: string;
  [key: string]: unknown;
}

export interface SoapFieldDisplay {
  type?: string;
  nullable?: boolean;
  optional?: boolean;
  collection?: boolean;
  cardinalityLabel?: string;
  restrictionLines: string[];
  complexTypeRef?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}

function asNumberOrUnbounded(value: unknown): number | 'unbounded' | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === 'unbounded') return 'unbounded';
  return undefined;
}

export function readSoapFieldMetadata(
  candidate: DiscoveryCandidateDto
): SoapFieldMetadata | undefined {
  const data = candidate.data ?? {};
  const raw = asRecord(data['field_metadata']);
  if (!raw) return undefined;
  return raw as SoapFieldMetadata;
}

function formatEnumeration(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : undefined))
    .filter((v): v is string => v !== undefined && v.length > 0);
  if (values.length === 0) return undefined;
  return `Enum: ${values.join(', ')}`;
}

function formatScalarRestriction(label: string, value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return `${label}: ${value}`;
  if (typeof value === 'number' && Number.isFinite(value)) return `${label}: ${value}`;
  return undefined;
}

export function buildSoapRestrictionLines(meta: SoapFieldMetadata | undefined): string[] {
  const restrictions = asRecord(meta?.restrictions);
  if (!restrictions) return [];
  const lines: string[] = [];

  const enumLine = formatEnumeration(restrictions['enumeration']);
  if (enumLine) lines.push(enumLine);

  const patternLine = formatScalarRestriction('Pattern', restrictions['pattern']);
  if (patternLine) lines.push(patternLine);

  const minLen = formatScalarRestriction('Min length', restrictions['min_length']);
  if (minLen) lines.push(minLen);
  const maxLen = formatScalarRestriction('Max length', restrictions['max_length']);
  if (maxLen) lines.push(maxLen);

  const minInc = formatScalarRestriction('Min', restrictions['min_inclusive']);
  if (minInc) lines.push(minInc);
  const maxInc = formatScalarRestriction('Max', restrictions['max_inclusive']);
  if (maxInc) lines.push(maxInc);

  const totalDigits = formatScalarRestriction('Total digits', restrictions['total_digits']);
  if (totalDigits) lines.push(totalDigits);
  const fractionDigits = formatScalarRestriction(
    'Fraction digits',
    restrictions['fraction_digits']
  );
  if (fractionDigits) lines.push(fractionDigits);

  return lines;
}

export function buildSoapFieldDisplay(
  candidate: DiscoveryCandidateDto
): SoapFieldDisplay | undefined {
  const data = candidate.data ?? {};
  const meta = readSoapFieldMetadata(candidate);

  const type =
    asNonEmptyString(data['dataType']) ??
    asNonEmptyString(data['data_type']) ??
    asNonEmptyString(meta?.xsd_source_type);

  const nullableRaw = data['isNullable'];
  const nullable =
    typeof nullableRaw === 'boolean'
      ? nullableRaw
      : typeof data['is_nullable'] === 'boolean'
        ? (data['is_nullable'] as boolean)
        : undefined;

  const cardinality = asRecord(meta?.cardinality);
  let optional: boolean | undefined;
  let collection: boolean | undefined;
  let cardinalityLabel: string | undefined;
  if (cardinality) {
    const minOccurs =
      typeof cardinality['min_occurs'] === 'number' ? (cardinality['min_occurs'] as number) : undefined;
    const maxOccurs = asNumberOrUnbounded(cardinality['max_occurs']);
    if (minOccurs !== undefined) {
      optional = minOccurs === 0;
    }
    if (typeof cardinality['is_collection'] === 'boolean') {
      collection = cardinality['is_collection'] as boolean;
    } else if (maxOccurs === 'unbounded' || (typeof maxOccurs === 'number' && maxOccurs > 1)) {
      collection = true;
    }
    if (minOccurs !== undefined || maxOccurs !== undefined) {
      const minPart = minOccurs !== undefined ? String(minOccurs) : '?';
      const maxPart = maxOccurs !== undefined ? String(maxOccurs) : '?';
      cardinalityLabel = `${minPart}..${maxPart}`;
    }
  }

  const restrictionLines = buildSoapRestrictionLines(meta);
  const complexTypeRef = asNonEmptyString(meta?.complex_type_ref);

  if (
    type === undefined &&
    nullable === undefined &&
    optional === undefined &&
    collection === undefined &&
    cardinalityLabel === undefined &&
    restrictionLines.length === 0 &&
    complexTypeRef === undefined
  ) {
    return undefined;
  }

  return {
    type,
    nullable,
    optional,
    collection,
    cardinalityLabel,
    restrictionLines,
    complexTypeRef,
  };
}

export function readSoapEntityProvenance(
  candidate: DiscoveryCandidateDto
): string | undefined {
  const data = candidate.data ?? {};
  const direct = asNonEmptyString(data['source_provenance']);
  if (direct) return direct;

  const parts: string[] = [];
  const ns = asNonEmptyString(data['provenance_namespace']);
  if (ns) parts.push(`namespace=${ns}`);
  const cls = asNonEmptyString(data['provenance_class']);
  if (cls) parts.push(`class=${cls}`);
  return parts.length > 0 ? parts.join('; ') : undefined;
}

export interface ResponseContractBlob {
  schema_version?: string | number;
  error_responses?: unknown;
  auth?: unknown;
  validation?: unknown;
  serialization?: unknown;
  status_codes?: unknown;
  conditional_variants?: unknown;
  provenance?: unknown;
  confidence?: number | null;
  [key: string]: unknown;
}

export interface ResponseContractSection {
  key: string;
  label: string;
  lines: string[];
}

export interface ResponseContractDisplay {
  sections: ResponseContractSection[];
  confidence?: number;
}

const RESPONSE_CONTRACT_SECTION_DEFS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'error_responses', label: 'Error responses' },
  { key: 'auth', label: 'Authentication / authorization' },
  { key: 'validation', label: 'Validation' },
  { key: 'serialization', label: 'Serialization' },
  { key: 'status_codes', label: 'Status codes' },
  { key: 'conditional_variants', label: 'Conditional variants' },
  { key: 'provenance', label: 'Provenance' },
];

function flattenContractValue(value: unknown, depth = 0): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') {
    return value.length > 0 ? [value] : [];
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  if (depth > 4) return [];
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      out.push(...flattenContractValue(item, depth + 1));
    }
    return out;
  }
  if (typeof value === 'object') {
    const out: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'string') {
        if (v.length > 0) out.push(`${k}: ${v}`);
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        out.push(`${k}: ${String(v)}`);
      } else {
        const nested = flattenContractValue(v, depth + 1);
        for (const line of nested) out.push(`${k}: ${line}`);
      }
    }
    return out;
  }
  return [];
}

export function readResponseContractBlob(
  candidate: DiscoveryCandidateDto
): ResponseContractBlob | undefined {
  const data = candidate.data ?? {};
  const raw = asRecord(data['response_contract']) ?? asRecord(data['responseContract']);
  if (!raw) return undefined;
  return raw as ResponseContractBlob;
}

function readResponseContractConfidence(
  blob: ResponseContractBlob
): number | undefined {
  const top = blob['confidence'];
  if (typeof top === 'number' && Number.isFinite(top)) return top;
  return undefined;
}

export function buildResponseContractBlock(
  candidate: DiscoveryCandidateDto
): ResponseContractDisplay | undefined {
  const blob = readResponseContractBlob(candidate);
  if (!blob) return undefined;

  const confidence = readResponseContractConfidence(blob);

  const sections: ResponseContractSection[] = [];
  for (const def of RESPONSE_CONTRACT_SECTION_DEFS) {
    const lines = flattenContractValue(blob[def.key]);
    if (lines.length > 0) {
      sections.push({ key: def.key, label: def.label, lines });
    }
  }

  if (sections.length === 0 && confidence === undefined) {
    return undefined;
  }

  return { sections, confidence };
}


// ============================================================================
// Outbound integration edge (`data_movements` candidate) -- Spec 2026-05-30
// Outbound Integration Graph for Discovery (Spec #5), Task Group 6.
//
// The discovery-service emits ONE `data_movements` candidate per resolved
// OUTBOUND edge. Its `data` carries the source service/endpoint NAME + the
// verbatim resolved target + the integration kind + a `targetLooksExternal`
// shape hint (read here BY NAME, mirroring the keys the Spring Classic adapter
// emits in `outboundIntegrationCandidates.ts` and the keys the MCP Group-5
// save-back producer reads). EVERY read is DEFENSIVE so a partial / older row
// still renders the block (NO silent failure, NO crash).
// ============================================================================

/**
 * The display fields for an outbound-integration (`data_movements`) edge,
 * derived defensively from the candidate `data` payload.
 */
export interface DataMovementDisplay {
  /** The SOURCE label: the calling endpoint identity when present, else the owning service NAME. */
  source?: string;
  /** The owning service/interface class NAME (resolves the source application_point at save-back). */
  sourceServiceName?: string;
  /** The calling endpoint identity (`${verb} ${path}`), when reached from a controller mapping. */
  sourceEndpointName?: string;
  /** `'endpoint'` (reached from a controller mapping) or `'service'` (owning service). */
  sourceKind?: string;
  /** The verbatim resolved target (URL / topic / queue / exchange / store / path). */
  target?: string;
  /** The integration kind (`outbound-rest` / `messaging-producer` / `cache-store` / ...). */
  movementType?: string;
  /** TRUE when the target is purely external (no in-model counterpart) -> drives the external marker. */
  targetLooksExternal?: boolean;
  /** Optional HTTP verb (outbound-rest). */
  httpVerb?: string;
  /** Optional messaging operation (`send` / `convertAndSend` / `publish` / ...). */
  messagingOperation?: string;
  /** Optional best-effort payload-type hint (the static type of the send payload arg). */
  payloadHint?: string;
  /** Call-site FQN (`package.Class#method`) of the outbound call (evidence). */
  callSiteFqn?: string;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Read the outbound-integration edge display fields off a `data_movements`
 * candidate. Returns `undefined` when there is NOTHING worth rendering (an
 * empty / shapeless `data`), so the caller can render nothing rather than an
 * empty block. Every individual field is read defensively -- a partial `data`
 * (e.g. target present but no movement kind) still yields a usable block.
 */
export function readDataMovementDisplay(
  candidate: DiscoveryCandidateDto
): DataMovementDisplay | undefined {
  const data = candidate.data ?? {};

  const sourceServiceName =
    asNonEmptyString(data['sourceServiceName']) ?? asNonEmptyString(data['ownerClassName']);
  const sourceEndpointName = asNonEmptyString(data['sourceEndpointName']);
  const sourceKind = asNonEmptyString(data['sourceKind']);
  // SOURCE label: the calling endpoint identity wins (more specific) when the
  // edge was reached from a controller mapping; else the owning service NAME.
  const source =
    sourceKind === 'endpoint' && sourceEndpointName
      ? sourceEndpointName
      : sourceServiceName ?? sourceEndpointName;

  const target = asNonEmptyString(data['target']) ?? asNonEmptyString(data['targetName']);
  const movementType = asNonEmptyString(data['movementType']);
  const targetLooksExternal = asBoolean(data['targetLooksExternal']);
  const httpVerb = asNonEmptyString(data['httpVerb']);
  const messagingOperation = asNonEmptyString(data['messagingOperation']);
  const payloadHint = asNonEmptyString(data['payloadHint']);
  const callSiteFqn = asNonEmptyString(data['callSiteFqn']);

  if (
    source === undefined &&
    sourceServiceName === undefined &&
    sourceEndpointName === undefined &&
    target === undefined &&
    movementType === undefined &&
    targetLooksExternal === undefined &&
    httpVerb === undefined &&
    messagingOperation === undefined &&
    payloadHint === undefined &&
    callSiteFqn === undefined
  ) {
    return undefined;
  }

  return {
    source,
    sourceServiceName,
    sourceEndpointName,
    sourceKind,
    target,
    movementType,
    targetLooksExternal,
    httpVerb,
    messagingOperation,
    payloadHint,
    callSiteFqn,
  };
}


// ============================================================================
// Per-endpoint SQL text (`endpoint_data_effects` candidate) -- Spec 2026-05-30
// Data-Layer Fidelity 2 (Spec #6), Task Group H (consumes Task Group A).
//
// Task Group A added two additive keys to the resolved `path_metadata_json`
// JSONB on an `endpoint_data_effects` candidate: `query_text` (the VERBATIM
// SQL/JPQL string behind the edge) and `query_kind` (`jpql` | `native` |
// `jdbc_template` | `mybatis`). They are present ONLY when an explicit query
// string was statically captured (a `@Query` value or a MyBatis / JdbcTemplate
// literal); Spring-Data derived-query edges carry neither. Read here BY NAME,
// defensively, so an older edge with no SQL text simply yields `undefined` and
// the SQL viewer is not rendered.
// ============================================================================

/**
 * The render-ready SQL-text fields of an `endpoint_data_effects` edge, derived
 * defensively from the candidate `data.path_metadata_json`.
 */
export interface EndpointDataEffectQueryDisplay {
  /** The VERBATIM captured SQL/JPQL string (never normalized). */
  queryText: string;
  /** The dialect/source label of {@link queryText} when present. */
  queryKind?: string;
}

/**
 * A friendly, human-readable label for a `query_kind` value (the four kinds
 * Task Group A emits). Unknown / future kinds fall back to the raw value so the
 * viewer label never goes blank.
 */
export function labelForQueryKind(kind: string | null | undefined): string | undefined {
  if (kind == null) return undefined;
  const trimmed = String(kind).trim();
  if (trimmed.length === 0) return undefined;
  switch (trimmed) {
    case 'jpql':
      return 'JPQL';
    case 'native':
      return 'Native SQL';
    case 'jdbc_template':
      return 'JdbcTemplate SQL';
    case 'mybatis':
      return 'MyBatis SQL';
    default:
      return trimmed;
  }
}

/**
 * Read the verbatim SQL text + its kind off an `endpoint_data_effects`
 * candidate's `data.path_metadata_json` (the keys Task Group A added alongside
 * `hops` / `operation_hint` / `transactional`). Returns `undefined` when no SQL
 * text was captured (a derived-query edge or a malformed `path_metadata_json`),
 * so the caller renders nothing rather than an empty SQL viewer. Never throws.
 */
export function readEndpointDataEffectQuery(
  candidate: DiscoveryCandidateDto
): EndpointDataEffectQueryDisplay | undefined {
  const data = candidate.data ?? {};
  const meta = asRecord(data['path_metadata_json']);
  if (!meta) return undefined;
  const queryText = asNonEmptyString(meta['query_text']);
  if (queryText === undefined) return undefined;
  const queryKind = asNonEmptyString(meta['query_kind']);
  return { queryText, queryKind };
}


// ============================================================================
// Physical-attribute structural metadata (`physical_data_attributes`
// candidate) -- Spec 2026-05-30 Data-Layer Fidelity 2 (Spec #6), Task Group H.
//
// The DB discovery packs (`candidateStructuralFidelity.ts#attributeStructural
// FidelityFields`) spread the Spec-3 structural-fidelity keys DIRECTLY onto a
// `physical_data_attributes` candidate `data` (snake_case, verbatim): a
// `source_type` (the verbatim engine column type), `column_default`, `scale`,
// `precision`, `ordinal`, `is_identity`, `sequence_name`. Task Groups B + E of
// THIS spec added three more ALONGSIDE them: `collation` (Group B) and
// `is_generated` + `generation_expression` (Group E). All are read here BY
// NAME, defensively, so a column with no special collation / not generated
// simply omits those lines (and an empty / shapeless `data` yields no block).
// ============================================================================

/**
 * The render-ready structural-fidelity fields of a `physical_data_attributes`
 * column candidate, derived defensively from the candidate `data` payload. The
 * Spec-3 fields (`sourceType` / `columnDefault` / `isIdentity` / ...) render
 * alongside the new Data-Layer Fidelity 2 collation + computed-column fields.
 */
export interface PhysicalAttributeDisplay {
  /** The verbatim engine column type (`source_type`; e.g. `varchar(64)` / `numeric(10,2)`). */
  sourceType?: string;
  /** The verbatim column default expression (`column_default`), unchanged (flag-only hazards live in Findings). */
  columnDefault?: string;
  /** Numeric scale (`scale`) when present. */
  scale?: number;
  /** Numeric precision (`precision`) when present. */
  precision?: number;
  /** Whether the column is an identity column (`is_identity`). */
  isIdentity?: boolean;
  /** The backing sequence name (`sequence_name`) when present. */
  sequenceName?: string;
  /** The verbatim column collation (`collation`, Group B) -- the cross-engine CI/CS hazard lives in a Finding. */
  collation?: string;
  /** Whether the column is computed/generated (`is_generated`, Group E). */
  isGenerated?: boolean;
  /** The verbatim generation expression (`generation_expression`, Group E) when the column is generated. */
  generationExpression?: string;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

/**
 * Read the structural-fidelity display fields off a `physical_data_attributes`
 * candidate. Returns `undefined` when there is NOTHING worth rendering (an
 * empty / shapeless `data`), so the caller renders nothing rather than an empty
 * block. Every individual field is read defensively -- a partial `data` (e.g.
 * `source_type` present but no collation) still yields a usable block, and a
 * `collation: null` / `is_generated: false` column simply omits those lines.
 */
export function readPhysicalAttributeDisplay(
  candidate: DiscoveryCandidateDto
): PhysicalAttributeDisplay | undefined {
  const data = candidate.data ?? {};

  const sourceType =
    asNonEmptyString(data['source_type']) ?? asNonEmptyString(data['dataType']);
  const columnDefault =
    asNonEmptyString(data['column_default']) ?? asNonEmptyString(data['defaultExpression']);
  const scale = asFiniteNumber(data['scale']);
  const precision = asFiniteNumber(data['precision']);
  const isIdentity = asBoolean(data['is_identity']);
  const sequenceName = asNonEmptyString(data['sequence_name']);
  // Spec 2026-05-30 Data-Layer Fidelity 2 -- Group B (collation) + Group E
  // (computed/generated column). Verbatim; the cross-engine hazards are in
  // Findings, not a mutation of these captured values.
  const collation = asNonEmptyString(data['collation']);
  const isGeneratedRaw = asBoolean(data['is_generated']);
  // Only surface the computed flag when it is genuinely TRUE -- a plain
  // writable column carries `is_generated: false` and should not show a line.
  const isGenerated = isGeneratedRaw === true ? true : undefined;
  const generationExpression = asNonEmptyString(data['generation_expression']);

  if (
    sourceType === undefined &&
    columnDefault === undefined &&
    scale === undefined &&
    precision === undefined &&
    isIdentity === undefined &&
    sequenceName === undefined &&
    collation === undefined &&
    isGenerated === undefined &&
    generationExpression === undefined
  ) {
    return undefined;
  }

  return {
    sourceType,
    columnDefault,
    scale,
    precision,
    isIdentity,
    sequenceName,
    collation,
    isGenerated,
    generationExpression,
  };
}
