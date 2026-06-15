/**
 * CandidateDetailsPanel Component
 *
 * Spec 2026-05-30 (Per-endpoint response-contract capture -- Spec 1) Task
 * Group 4.2: a read-only, EXPANDABLE response-contract block + confidence
 * badge is rendered for `endpoints` candidates, MIRRORING the Spec 2
 * `business_logics` behaviour block. (Header doc trimmed in the mount copy;
 * the authoritative Windows file carries the full multi-spec header.)
 *
 * Spec 2026-05-30 (Data-Layer Fidelity 2 -- Spec #6) Task Group H: the
 * `endpoint_data_effects` block additionally renders the VERBATIM captured SQL
 * text (`query_text`) in the EXISTING expandable read-only viewer pattern,
 * labelled by `query_kind` (Task Group A); and a NEW `physical_data_attributes`
 * block surfaces the Spec-3 structural metadata (`source_type` / `column_default`
 * / `is_identity` / ...) ALONGSIDE the new collation (Group B) +
 * computed-column (`is_generated` / `generation_expression`, Group E) signals.
 * Both reuse the EXISTING in-panel block idiom -- no bespoke widget, no new
 * panel type; every field is read defensively from the candidate `data`.
 */

import React, { useState } from 'react';
import type { DiscoveryCandidateDto } from '../../api/discoveryApi';
import { buildCandidateEvidenceDetails } from './candidateEvidenceBuilder';
import { CandidateEvidenceSectionCard } from './CandidateEvidenceSectionCard';
import {
  buildEndpointDataEffectPathHops,
  readEndpointDataEffectOperationHint,
  readEndpointDataEffectTransactional,
  buildBehaviourBlock,
} from './codeDetectionMappers';
import {
  readCandidateOperation,
  readEnrichTargetName,
  readEnrichAddition,
  readLinkEndpointNames,
} from './candidateOperationSupport';
import {
  buildSoapFieldDisplay,
  readSoapEntityProvenance,
  buildResponseContractBlock,
  readDataMovementDisplay,
  readEndpointDataEffectQuery,
  labelForQueryKind,
  readPhysicalAttributeDisplay,
} from './candidateDetailsSupport';
import type {
  CandidateEvidenceSection,
  RuntimeEvidenceContext,
} from './candidateEvidenceTypes';
import styles from './DiscoveryRunDetailView.module.css';

export interface CandidateDetailsPanelProps {
  candidate: DiscoveryCandidateDto;
  runtimeEvidenceContext?: RuntimeEvidenceContext;
}

const EndpointDataEffectPathBlock: React.FC<{ candidate: DiscoveryCandidateDto }> = ({
  candidate,
}) => {
  const [expanded, setExpanded] = useState(false);
  // Spec 2026-05-30 Data-Layer Fidelity 2 (Spec #6) Task Group H: the verbatim
  // captured SQL text behind the edge (Task Group A) renders in its OWN
  // expandable read-only viewer (independent of the path hop list), so an edge
  // with SQL text but no resolvable hop list still surfaces the SQL.
  const [sqlExpanded, setSqlExpanded] = useState(false);

  const hops = buildEndpointDataEffectPathHops(candidate);
  const operationHint = readEndpointDataEffectOperationHint(candidate);
  const transactional = readEndpointDataEffectTransactional(candidate);
  const query = readEndpointDataEffectQuery(candidate);

  // The block renders when there is EITHER a resolvable path OR captured SQL
  // text (Task Group A edges can carry SQL even when the hop list is empty).
  if (hops.length === 0 && !query) {
    return null;
  }

  const queryKindLabel = query ? labelForQueryKind(query.queryKind) : undefined;

  return (
    <div
      data-testid={`endpoint-data-effect-path-${candidate.id}`}
      className={styles.detailsColumnBody}
    >
      <h4 className={styles.detailsColumnHeading}>Data-effect path</h4>

      {operationHint !== undefined && (
        <div data-testid={`endpoint-data-effect-operation-hint-${candidate.id}`}>
          Operation hint: {operationHint}
        </div>
      )}
      {transactional !== undefined && (
        <div data-testid={`endpoint-data-effect-transactional-${candidate.id}`}>
          Transactional: {String(transactional)}
        </div>
      )}

      {hops.length > 0 && (
        <>
          <button
            type="button"
            className={styles.actionButton}
            aria-expanded={expanded}
            onClick={() => setExpanded((prev) => !prev)}
            data-testid={`endpoint-data-effect-path-toggle-${candidate.id}`}
          >
            {expanded ? 'Hide path' : `Show path (${hops.length} hops)`}
          </button>

          {expanded && (
            <ol data-testid={`endpoint-data-effect-path-list-${candidate.id}`}>
              {hops.map((hop, index) => (
                <li
                  key={`${index}-${hop.methodId}`}
                  data-testid={`endpoint-data-effect-path-hop-${index}`}
                >
                  {hop.role && <span>{hop.role}: </span>}
                  <code>{hop.methodId}</code>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      {query && (
        <div data-testid={`endpoint-data-effect-sql-${candidate.id}`}>
          {queryKindLabel !== undefined && (
            <div data-testid={`endpoint-data-effect-sql-kind-${candidate.id}`}>
              SQL kind: {queryKindLabel}
            </div>
          )}
          <button
            type="button"
            className={styles.actionButton}
            aria-expanded={sqlExpanded}
            onClick={() => setSqlExpanded((prev) => !prev)}
            data-testid={`endpoint-data-effect-sql-toggle-${candidate.id}`}
          >
            {sqlExpanded ? 'Hide SQL' : 'Show SQL'}
          </button>

          {sqlExpanded && (
            <pre data-testid={`endpoint-data-effect-sql-text-${candidate.id}`}>
              <code>{query.queryText}</code>
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

const HIGH_CONFIDENCE_THRESHOLD = 0.85;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.45;

const BehaviourConfidenceBadge: React.FC<{
  candidateId: string;
  confidence: number;
}> = ({ candidateId, confidence }) => {
  let label = 'Low';
  let cls = styles.behaviourConfidenceLow;
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) {
    label = 'High';
    cls = styles.behaviourConfidenceHigh;
  } else if (confidence >= MEDIUM_CONFIDENCE_THRESHOLD) {
    label = 'Medium';
    cls = styles.behaviourConfidenceMedium;
  }
  return (
    <span
      className={`${styles.behaviourConfidenceBadge} ${cls}`}
      data-testid={`behaviour-confidence-badge-${candidateId}`}
    >
      Confidence: {label} ({confidence.toFixed(2)})
    </span>
  );
};

const BehaviourBlock: React.FC<{ candidate: DiscoveryCandidateDto }> = ({ candidate }) => {
  const [expanded, setExpanded] = useState(false);

  const block = buildBehaviourBlock(candidate);

  if (!block) {
    return null;
  }

  const { sections, confidence } = block;

  return (
    <div
      data-testid={`behaviour-block-${candidate.id}`}
      className={styles.detailsColumnBody}
    >
      <h4 className={styles.detailsColumnHeading}>Captured behaviour</h4>

      {confidence !== undefined && (
        <BehaviourConfidenceBadge candidateId={candidate.id} confidence={confidence} />
      )}

      <button
        type="button"
        className={styles.actionButton}
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        data-testid={`behaviour-block-toggle-${candidate.id}`}
      >
        {expanded ? 'Hide behaviour' : `Show behaviour (${sections.length} sections)`}
      </button>

      {expanded && (
        <div data-testid={`behaviour-block-sections-${candidate.id}`}>
          {sections.map((section) => (
            <div
              key={section.key}
              data-testid={`behaviour-section-${section.key}-${candidate.id}`}
            >
              <h5 className={styles.behaviourSectionHeading}>{section.label}</h5>
              <ul className={styles.behaviourSectionList}>
                {section.lines.map((line, index) => (
                  <li key={`${section.key}-${index}`}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ResponseContractBlock: React.FC<{ candidate: DiscoveryCandidateDto }> = ({
  candidate,
}) => {
  const [expanded, setExpanded] = useState(false);

  const block = buildResponseContractBlock(candidate);

  if (!block) {
    return null;
  }

  const { sections, confidence } = block;

  return (
    <div
      data-testid={`response-contract-block-${candidate.id}`}
      className={styles.detailsColumnBody}
    >
      <h4 className={styles.detailsColumnHeading}>Response contract</h4>

      {confidence !== undefined && (
        <BehaviourConfidenceBadge candidateId={candidate.id} confidence={confidence} />
      )}

      <button
        type="button"
        className={styles.actionButton}
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        data-testid={`response-contract-block-toggle-${candidate.id}`}
      >
        {expanded ? 'Hide contract' : `Show contract (${sections.length} sections)`}
      </button>

      {expanded && (
        <div data-testid={`response-contract-block-sections-${candidate.id}`}>
          {sections.map((section) => (
            <div
              key={section.key}
              data-testid={`response-contract-section-${section.key}-${candidate.id}`}
            >
              <h5 className={styles.behaviourSectionHeading}>{section.label}</h5>
              <ul className={styles.behaviourSectionList}>
                {section.lines.map((line, index) => (
                  <li key={`${section.key}-${index}`}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const PhysicalDataAttributeBlock: React.FC<{ candidate: DiscoveryCandidateDto }> = ({
  candidate,
}) => {
  // Spec 2026-05-30 Data-Layer Fidelity 2 (Spec #6) Task Group H. Surface the
  // Spec-3 structural-fidelity metadata (source_type / column_default /
  // is_identity / sequence_name / scale / precision) ALONGSIDE the new
  // collation (Group B) + computed-column (is_generated / generation_expression,
  // Group E) signals in the EXISTING candidate-details surface. Fields are read
  // DEFENSIVELY from the candidate `data`; a partial / shapeless `data` yields
  // no block (and never crashes).
  const display = readPhysicalAttributeDisplay(candidate);

  if (!display) {
    return null;
  }

  return (
    <div
      data-testid={`physical-data-attribute-block-${candidate.id}`}
      className={styles.detailsColumnBody}
    >
      <h4 className={styles.detailsColumnHeading}>Physical column metadata</h4>

      {display.sourceType !== undefined && (
        <div data-testid={`physical-attribute-source-type-${candidate.id}`}>
          Source type: <code>{display.sourceType}</code>
        </div>
      )}

      {display.precision !== undefined && (
        <div data-testid={`physical-attribute-precision-${candidate.id}`}>
          Precision: {display.precision}
        </div>
      )}

      {display.scale !== undefined && (
        <div data-testid={`physical-attribute-scale-${candidate.id}`}>
          Scale: {display.scale}
        </div>
      )}

      {display.columnDefault !== undefined && (
        <div data-testid={`physical-attribute-default-${candidate.id}`}>
          Default: <code>{display.columnDefault}</code>
        </div>
      )}

      {display.isIdentity !== undefined && (
        <div data-testid={`physical-attribute-identity-${candidate.id}`}>
          Identity: {String(display.isIdentity)}
        </div>
      )}

      {display.sequenceName !== undefined && (
        <div data-testid={`physical-attribute-sequence-${candidate.id}`}>
          Sequence: {display.sequenceName}
        </div>
      )}

      {display.collation !== undefined && (
        <div data-testid={`physical-attribute-collation-${candidate.id}`}>
          Collation: <code>{display.collation}</code>
        </div>
      )}

      {display.isGenerated === true && (
        <div data-testid={`physical-attribute-generated-${candidate.id}`}>
          Computed/generated: true
        </div>
      )}

      {display.generationExpression !== undefined && (
        <div data-testid={`physical-attribute-generation-expression-${candidate.id}`}>
          Generation expression: <code>{display.generationExpression}</code>
        </div>
      )}
    </div>
  );
};

const OperationTargetBlock: React.FC<{ candidate: DiscoveryCandidateDto }> = ({
  candidate,
}) => {
  const operation = readCandidateOperation(candidate);

  if (operation !== 'enrich' && operation !== 'link') {
    return null;
  }

  if (operation === 'link') {
    const { logicalName, physicalName } = readLinkEndpointNames(candidate);
    return (
      <div
        data-testid={`operation-target-block-${candidate.id}`}
        className={styles.detailsColumnBody}
      >
        <h4 className={styles.detailsColumnHeading}>Logical ↔ physical link</h4>
        <div data-testid={`operation-target-logical-${candidate.id}`}>
          Logical entity: {logicalName ?? '(unresolved)'}
        </div>
        <div data-testid={`operation-target-physical-${candidate.id}`}>
          Physical entity: {physicalName ?? '(unresolved)'}
        </div>
      </div>
    );
  }

  const targetName = readEnrichTargetName(candidate);
  const addition = readEnrichAddition(candidate);

  return (
    <div
      data-testid={`operation-target-block-${candidate.id}`}
      className={styles.detailsColumnBody}
    >
      <h4 className={styles.detailsColumnHeading}>Enrich existing entity</h4>
      <div data-testid={`operation-target-entity-${candidate.id}`}>
        Target entity: {targetName ?? '(unresolved)'}
      </div>

      {addition.attributeName !== undefined && (
        <div data-testid={`operation-enrich-attribute-${candidate.id}`}>
          Adds attribute: {addition.attributeName}
          {addition.attributeDataType !== undefined
            ? ` (${addition.attributeDataType})`
            : ''}
        </div>
      )}

      {addition.relatedEntityName !== undefined && (
        <div data-testid={`operation-enrich-relationship-${candidate.id}`}>
          Adds relationship to: {addition.relatedEntityName}
          {addition.relationshipType !== undefined
            ? ` [${addition.relationshipType}]`
            : ''}
          {addition.cardinality !== undefined ? ` (${addition.cardinality})` : ''}
        </div>
      )}
    </div>
  );
};

const SoapMessageShapeBlock: React.FC<{ candidate: DiscoveryCandidateDto }> = ({
  candidate,
}) => {
  if (candidate.candidate_type === 'logical_data_attributes') {
    const field = buildSoapFieldDisplay(candidate);
    if (!field) {
      return null;
    }
    return (
      <div
        data-testid={`soap-message-field-${candidate.id}`}
        className={styles.detailsColumnBody}
      >
        <h4 className={styles.detailsColumnHeading}>Message field</h4>

        {field.type !== undefined && (
          <div data-testid={`soap-field-type-${candidate.id}`}>Type: {field.type}</div>
        )}

        {field.cardinalityLabel !== undefined && (
          <div data-testid={`soap-field-cardinality-${candidate.id}`}>
            Cardinality: {field.cardinalityLabel}
            {field.optional === true ? ' (optional)' : ''}
            {field.collection === true ? ' (collection)' : ''}
          </div>
        )}

        {field.nullable !== undefined && (
          <div data-testid={`soap-field-nullable-${candidate.id}`}>
            Nullable: {String(field.nullable)}
          </div>
        )}

        {field.complexTypeRef !== undefined && (
          <div data-testid={`soap-field-complex-type-${candidate.id}`}>
            References type: {field.complexTypeRef}
          </div>
        )}

        {field.restrictionLines.length > 0 && (
          <div data-testid={`soap-field-restrictions-${candidate.id}`}>
            <h5 className={styles.behaviourSectionHeading}>Value-domain restrictions</h5>
            <ul className={styles.behaviourSectionList}>
              {field.restrictionLines.map((line, index) => (
                <li key={`restriction-${index}`}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (candidate.candidate_type === 'logical_data_entities') {
    const provenance = readSoapEntityProvenance(candidate);
    if (provenance === undefined) {
      return null;
    }
    return (
      <div
        data-testid={`soap-message-entity-${candidate.id}`}
        className={styles.detailsColumnBody}
      >
        <h4 className={styles.detailsColumnHeading}>Message provenance</h4>
        <div data-testid={`soap-entity-provenance-${candidate.id}`}>
          Provenance: {provenance}
        </div>
      </div>
    );
  }

  return null;
};

const DataMovementBlock: React.FC<{ candidate: DiscoveryCandidateDto }> = ({
  candidate,
}) => {
  // Spec 2026-05-30 Outbound Integration Graph (Spec #5) -- Task Group 6.
  // Render the OUTBOUND dependency edge (source service/endpoint -> target,
  // with the movement/integration kind, plus an "external" marker when the
  // target is purely external) in the EXISTING candidate-details surface. The
  // fields are read DEFENSIVELY from the candidate `data`; a partial / shapeless
  // `data` yields no block (and never crashes).
  const display = readDataMovementDisplay(candidate);

  if (!display) {
    return null;
  }

  return (
    <div
      data-testid={`data-movement-block-${candidate.id}`}
      className={styles.detailsColumnBody}
    >
      <h4 className={styles.detailsColumnHeading}>Outbound integration</h4>

      <div data-testid={`data-movement-source-${candidate.id}`}>
        Source: {display.source ?? '(unresolved)'}
        {display.sourceKind ? ` (${display.sourceKind})` : ''}
      </div>

      <div data-testid={`data-movement-target-${candidate.id}`}>
        Target: {display.target ?? '(unresolved)'}
        {display.targetLooksExternal === true && (
          <span data-testid={`data-movement-external-marker-${candidate.id}`}>
            {' '}[external]
          </span>
        )}
      </div>

      {display.movementType !== undefined && (
        <div data-testid={`data-movement-kind-${candidate.id}`}>
          Integration kind: {display.movementType}
        </div>
      )}

      {display.httpVerb !== undefined && (
        <div data-testid={`data-movement-verb-${candidate.id}`}>
          HTTP verb: {display.httpVerb}
        </div>
      )}

      {display.messagingOperation !== undefined && (
        <div data-testid={`data-movement-operation-${candidate.id}`}>
          Messaging operation: {display.messagingOperation}
        </div>
      )}

      {display.payloadHint !== undefined && (
        <div data-testid={`data-movement-payload-hint-${candidate.id}`}>
          Payload type hint: {display.payloadHint}
        </div>
      )}

      {display.callSiteFqn !== undefined && (
        <div data-testid={`data-movement-call-site-${candidate.id}`}>
          Call site: <code>{display.callSiteFqn}</code>
        </div>
      )}
    </div>
  );
};

export const CandidateDetailsPanel: React.FC<CandidateDetailsPanelProps> = ({
  candidate,
  runtimeEvidenceContext,
}) => {
  const evidence = buildCandidateEvidenceDetails(candidate, runtimeEvidenceContext);

  const columns: Array<{ section: CandidateEvidenceSection; prefix: string }> = [
    { section: evidence.codeDetection, prefix: 'code-detection' },
    { section: evidence.logScans, prefix: 'log-scans' },
    { section: evidence.llmReview, prefix: 'llm-review' },
  ];

  const isEndpointDataEffect = candidate.candidate_type === 'endpoint_data_effects';
  const isBusinessLogic = candidate.candidate_type === 'business_logics';
  const isEndpoint = candidate.candidate_type === 'endpoints';
  // Spec 2026-05-30 Outbound Integration Graph (Spec #5) -- Task Group 6.
  const isDataMovement = candidate.candidate_type === 'data_movements';
  // Spec 2026-05-30 Data-Layer Fidelity 2 (Spec #6) -- Task Group H.
  const isPhysicalDataAttribute =
    candidate.candidate_type === 'physical_data_attributes';

  return (
    <div
      data-testid={`candidate-details-panel-${candidate.id}`}
      className={styles.detailsPanel}
    >
      {columns.map(({ section, prefix }) => (
        <div key={prefix} className={styles.detailsColumn}>
          <h4 className={styles.detailsColumnHeading}>{section.title}</h4>
          <CandidateEvidenceSectionCard section={section} testIdPrefix={prefix} />
        </div>
      ))}

      {isEndpointDataEffect && <EndpointDataEffectPathBlock candidate={candidate} />}

      {isBusinessLogic && <BehaviourBlock candidate={candidate} />}

      {isEndpoint && <ResponseContractBlock candidate={candidate} />}

      {isDataMovement && <DataMovementBlock candidate={candidate} />}

      {isPhysicalDataAttribute && <PhysicalDataAttributeBlock candidate={candidate} />}

      <SoapMessageShapeBlock candidate={candidate} />

      <OperationTargetBlock candidate={candidate} />
    </div>
  );
};
