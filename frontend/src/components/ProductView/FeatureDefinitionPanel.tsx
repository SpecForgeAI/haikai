/**
 * FeatureDefinitionPanel Component
 *
 * Spec 2026-02-11: 3-Zone LHS Layout
 * - Zone 1: Collapsible "Implementation Plan" (user-toggled, auto-expands when increments arrive)
 * - Zone 2: Collapsible "Clarifying Questions" (tool-managed, auto-expands when questions exist)
 * - Zone 3: Scrollable feature detail (flex:1, always visible)
 *
 * Previous specs preserved for context:
 * - Spec 2026-01-22: Feature Shaping UI Consumes Planner JSON
 * - Spec 2026-01-23: Questions System v1, Plan Generation, SA Handoff, Pipeline Execution
 * - Spec 2026-01-24: Screen Changes, Context Relocation, Density Reduction
 * - Spec 2026-01-25: Collapse and Provenance Icons
 * - Spec 2026-01-28: Shape-Spec 2 - Streaming Questions
 * - Spec 2026-01-30: Auto-scroll LHS Panel
 * - Spec 2026-02-06: Part Sequencing Workflow
 */

import { useMemo, useRef, useState, useEffect } from 'react';
import type { PlannerResponse, Question, ImplementationPlan, TestDefinition } from '../../api/chatApi';
import type { IncrementStatus } from './ImplementationAssistantPanel';
import type { Part, PartStatus } from '../../types/part';
import type { ContextState, EntityRef, DiagramRef, RelationshipRef } from '../../utils/contextStorage';
import { FeatureHeader } from './FeatureHeader';
import { FeatureSectionCard } from './FeatureSectionCard';
import { QuestionsTable } from './QuestionsTable';
import { ImplementationPlanSection } from './ImplementationPlanSection';
import { PartsListSection } from './PartsListSection';
import { RELATIONSHIP_TYPE_DISPLAY_LABELS } from '../../utils/contextRelationshipLabelUtils';
import { SquareUserRound, Bot } from 'lucide-react';
import styles from './FeatureDefinitionPanel.module.css';

// ============================================================================
// Constants
// ============================================================================


// ============================================================================
// Context Section Helper Functions
// ============================================================================

const ENTITY_TYPE_PLURAL_LABELS: Record<string, string> = {
  business_users: 'Business Users',
  business_processes: 'Business Processes',
  process_activities: 'Process Activities',
  applications: 'Applications',
  app_components: 'App Components',
  services: 'Services',
  interfaces: 'Interfaces',
  endpoints: 'Endpoints',
  classes: 'Classes',
  methods: 'Methods',
  logical_data_entities: 'Logical Data Entities',
  logical_data_attributes: 'Logical Data Attributes',
  physical_data_entities: 'Physical Data Entities',
  physical_data_attributes: 'Physical Data Attributes',
  interactions: 'Interactions',
  events: 'Events',
  states: 'States',
  activities: 'Activities',
  ui_screens: 'UI Screens',
  ui_components: 'UI Components',
  ui_actions: 'UI Actions',
};

function getEntityTypePluralLabel(entityType: string): string {
  if (ENTITY_TYPE_PLURAL_LABELS[entityType]) {
    return ENTITY_TYPE_PLURAL_LABELS[entityType];
  }
  return entityType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getChipDisplayLabel(label: string | undefined, idValue: string): string {
  if (!label || !label.trim() || label === idValue) {
    return 'Loading...';
  }
  return label;
}

interface AggregatedChipData {
  type: 'individual' | 'aggregated';
  label: string;
  entityType?: string;
  relationshipType?: string;
  count?: number;
  refs: (EntityRef | DiagramRef | RelationshipRef)[];
}

function aggregateEntityChips(entityRefs: EntityRef[]): AggregatedChipData[] {
  const grouped = new Map<string, EntityRef[]>();

  for (const ref of entityRefs) {
    const key = ref.entity_type;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(ref);
  }

  const result: AggregatedChipData[] = [];

  for (const [entityType, refs] of grouped) {
    if (refs.length === 1) {
      result.push({
        type: 'individual',
        label: refs[0].label,
        entityType,
        refs,
      });
    } else {
      const pluralLabel = getEntityTypePluralLabel(entityType);
      result.push({
        type: 'aggregated',
        label: `${refs.length} ${pluralLabel}`,
        entityType,
        count: refs.length,
        refs,
      });
    }
  }

  return result;
}

function aggregateDiagramChips(diagramRefs: DiagramRef[]): AggregatedChipData[] {
  if (diagramRefs.length === 0) {
    return [];
  }

  if (diagramRefs.length === 1) {
    return [
      {
        type: 'individual',
        label: diagramRefs[0].label,
        refs: diagramRefs,
      },
    ];
  }

  return [
    {
      type: 'aggregated',
      label: `${diagramRefs.length} Diagrams`,
      count: diagramRefs.length,
      refs: diagramRefs,
    },
  ];
}

function aggregateRelationshipChips(
  relationshipRefs: RelationshipRef[]
): AggregatedChipData[] {
  const grouped = new Map<string, RelationshipRef[]>();

  for (const ref of relationshipRefs) {
    const key = ref.relationship_type;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(ref);
  }

  const result: AggregatedChipData[] = [];

  for (const [relationshipType, refs] of grouped) {
    if (refs.length === 1) {
      result.push({
        type: 'individual',
        label: refs[0].label,
        relationshipType,
        refs,
      });
    } else {
      const displayLabel = RELATIONSHIP_TYPE_DISPLAY_LABELS[relationshipType] || relationshipType;
      result.push({
        type: 'aggregated',
        label: `${refs.length} ${displayLabel}`,
        relationshipType,
        count: refs.length,
        refs,
      });
    }
  }

  return result;
}

// ============================================================================
// Context Section Chip Components
// ============================================================================

function EntityChip({
  entityRef,
  onRemove,
}: {
  entityRef: EntityRef;
  onRemove: (entityId: string) => void;
}) {
  const displayLabel = getChipDisplayLabel(entityRef.label, entityRef.entity_id);

  return (
    <span className={styles.entityChip} data-testid={`entity-chip-${entityRef.entity_id}`}>
      <span className={styles.chipLabel}>{displayLabel}</span>
      <button
        className={styles.chipRemove}
        onClick={() => onRemove(entityRef.entity_id)}
        title="Remove"
        data-testid={`remove-entity-${entityRef.entity_id}`}
      >
        &times;
      </button>
    </span>
  );
}

function DiagramChip({
  diagramRef,
  onRemove,
}: {
  diagramRef: DiagramRef;
  onRemove: (diagramId: string) => void;
}) {
  const displayLabel = getChipDisplayLabel(diagramRef.label, diagramRef.diagram_id);

  return (
    <span className={styles.diagramChip} data-testid={`diagram-chip-${diagramRef.diagram_id}`}>
      <span className={styles.chipLabel}>{displayLabel}</span>
      <button
        className={styles.chipRemove}
        onClick={() => onRemove(diagramRef.diagram_id)}
        title="Remove"
        data-testid={`remove-diagram-${diagramRef.diagram_id}`}
      >
        &times;
      </button>
    </span>
  );
}

function RelationshipChip({
  relationshipRef,
  onRemove,
}: {
  relationshipRef: RelationshipRef;
  onRemove: (relationshipId: string) => void;
}) {
  const displayLabel = getChipDisplayLabel(relationshipRef.label, relationshipRef.relationship_id);

  return (
    <span
      className={styles.relationshipChip}
      data-testid={`relationship-chip-${relationshipRef.relationship_id}`}
    >
      <span className={styles.chipLabel}>{displayLabel}</span>
      <button
        className={styles.chipRemove}
        onClick={() => onRemove(relationshipRef.relationship_id)}
        title="Remove"
        data-testid={`remove-relationship-${relationshipRef.relationship_id}`}
      >
        &times;
      </button>
    </span>
  );
}

function AggregatedEntityChip({ chipData }: { chipData: AggregatedChipData }) {
  return (
    <span className={styles.entityChip} data-testid={`aggregated-entity-chip-${chipData.entityType}`}>
      <span className={styles.chipLabel}>{chipData.label}</span>
    </span>
  );
}

function AggregatedDiagramChip({ chipData }: { chipData: AggregatedChipData }) {
  return (
    <span className={styles.diagramChip} data-testid="aggregated-diagram-chip">
      <span className={styles.chipLabel}>{chipData.label}</span>
    </span>
  );
}

function AggregatedRelationshipChip({ chipData }: { chipData: AggregatedChipData }) {
  return (
    <span
      className={styles.relationshipChip}
      data-testid={`aggregated-relationship-chip-${chipData.relationshipType}`}
    >
      <span className={styles.chipLabel}>{chipData.label}</span>
    </span>
  );
}

// ============================================================================
// Props Interface
// ============================================================================

export interface FeatureDefinitionPanelProps {
  workItemTitle: string;
  workItemDescription: string;
  plannerResponse: PlannerResponse | null;
  answers: Record<string, string>;
  onAnswerChange: (id: string, answer: string) => void;
  onSubmitAnswers: () => void;
  activeIncrementId: string | null;
  onIncrementSelect: (incrementId: string) => void;
  getIncrementStatus?: (incrementId: string) => IncrementStatus;
  onStartImplementation?: (incrementId: string) => void;
  epicName?: string;
  featureName?: string;
  workItemType?: string;
  contextState?: ContextState;
  contextLoading?: boolean;
  onAddContext?: () => void;
  onRemoveEntityChip?: (entityId: string) => void;
  onRemoveDiagramChip?: (diagramId: string) => void;
  onRemoveRelationshipChip?: (relationshipId: string) => void;
  questionStatuses?: Map<string, 'Open' | 'Answered'>;
  isSubmittingAnswers?: boolean;
  streamedQuestions?: Question[];
  streamedAnswers?: Record<string, string>;
  onStreamedAnswerChange?: (id: string, answer: string) => void;
  onSubmitStreamedAnswers?: () => void;
  isStreamedQuestionsSubmitting?: boolean;
  canAnswerStreamedQuestions?: boolean;
  parts?: Part[];
  partStatuses?: Map<number, PartStatus>;
  activePartIndex?: number | null;
  onPartClick?: (partIndex: number) => void;
  onRetryOrchestration?: (partIndex: number) => void;
  onResumeQA?: (partIndex: number) => void;
  onSeeSpec?: (incrementId: string) => void;
  onMarkComplete?: (incrementId: string) => void;
  /** Test plan definitions from the Test Engineer */
  testPlan?: TestDefinition[];
  /** Test Engineer open question answers */
  teAnswers?: Record<string, string>;
  /** Test Engineer open question statuses */
  teQuestionStatuses?: Map<string, 'Open' | 'Answered'>;
  /** Callback for TE answer changes */
  onTeAnswerChange?: (id: string, answer: string) => void;
  /** Callback to submit TE answers */
  onSubmitTeAnswers?: () => void;
  /** Whether TE answers are being submitted */
  isTeSubmitting?: boolean;
  /** Test Engineer open questions from latest response */
  teOpenQuestions?: Array<{ id: string; question: string }>;
  /** Inline refinement progress label for FeatureHeader */
  refinementProgressLabel?: string;
  /** When true, hides PM-specific sections (Understanding, Scope, Acceptance Criteria) */
  isHolisticReview?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

function deriveQuestions(
  openQuestions: PlannerResponse['openQuestions'],
  answers: Record<string, string>,
  statuses: Map<string, 'Open' | 'Answered'>
): Question[] {
  return openQuestions.map(oq => {
    const answer = answers[oq.id] ?? '';
    const status = statuses.get(oq.id) ?? 'Open';
    return {
      id: oq.id,
      question: oq.question,
      status,
      answer,
      source: 'Product Manager' as const,
    };
  });
}

function ContextContent({
  contextState,
  contextLoading,
  onRemoveEntityChip,
  onRemoveDiagramChip,
  onRemoveRelationshipChip,
}: {
  contextState?: ContextState;
  contextLoading?: boolean;
  onRemoveEntityChip?: (entityId: string) => void;
  onRemoveDiagramChip?: (diagramId: string) => void;
  onRemoveRelationshipChip?: (relationshipId: string) => void;
}) {
  const entityRefs = contextState?.entity_refs || [];
  const diagramRefs = contextState?.diagram_refs || [];
  const relationshipRefs = contextState?.relationship_refs || [];

  const hasContext =
    entityRefs.length > 0 || diagramRefs.length > 0 || relationshipRefs.length > 0;

  const aggregatedEntities = aggregateEntityChips(entityRefs);
  const aggregatedDiagrams = aggregateDiagramChips(diagramRefs);
  const aggregatedRelationships = aggregateRelationshipChips(relationshipRefs);

  if (contextLoading) {
    return (
      <div className={styles.contextLoading} data-testid="context-loading">
        Loading context...
      </div>
    );
  }

  if (!hasContext) {
    return (
      <div className={styles.noContext}>
        No context linked yet. Click "+ Add context" to link architecture entities, diagrams, and
        relationships.
      </div>
    );
  }

  return (
    <div className={styles.chipContainer}>
      {aggregatedEntities.map((chipData, index) => {
        if (chipData.type === 'individual') {
          const entityRef = chipData.refs[0] as EntityRef;
          return (
            <EntityChip
              key={entityRef.entity_id}
              entityRef={entityRef}
              onRemove={onRemoveEntityChip || (() => {})}
            />
          );
        } else {
          return (
            <AggregatedEntityChip key={`agg-entity-${chipData.entityType}-${index}`} chipData={chipData} />
          );
        }
      })}

      {aggregatedDiagrams.map((chipData, index) => {
        if (chipData.type === 'individual') {
          const diagramRef = chipData.refs[0] as DiagramRef;
          return (
            <DiagramChip
              key={diagramRef.diagram_id}
              diagramRef={diagramRef}
              onRemove={onRemoveDiagramChip || (() => {})}
            />
          );
        } else {
          return <AggregatedDiagramChip key={`agg-diagram-${index}`} chipData={chipData} />;
        }
      })}

      {aggregatedRelationships.map((chipData, index) => {
        if (chipData.type === 'individual') {
          const relationshipRef = chipData.refs[0] as RelationshipRef;
          return (
            <RelationshipChip
              key={relationshipRef.relationship_id}
              relationshipRef={relationshipRef}
              onRemove={onRemoveRelationshipChip || (() => {})}
            />
          );
        } else {
          return (
            <AggregatedRelationshipChip
              key={`agg-rel-${chipData.relationshipType}-${index}`}
              chipData={chipData}
            />
          );
        }
      })}
    </div>
  );
}

function OpenQuestionsHeader() {
  return (
    <span className={styles.openQuestionsHeader}>
      <Bot size={16} />
      <span className={styles.ampersand}>&amp;</span>
      <SquareUserRound size={16} />
      <span style={{ marginLeft: '4px' }}>Open Questions</span>
    </span>
  );
}

function SAQuestionsHeader() {
  return (
    <span className={styles.openQuestionsHeader}>
      <Bot size={16} />
      <span style={{ marginLeft: '4px' }}>Software Developer Questions</span>
    </span>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function FeatureDefinitionPanel({
  workItemTitle,
  workItemDescription,
  plannerResponse,
  answers,
  onAnswerChange,
  onSubmitAnswers,
  activeIncrementId,
  onIncrementSelect,
  getIncrementStatus,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onStartImplementation: _onStartImplementation,
  epicName,
  featureName,
  workItemType,
  contextState,
  contextLoading,
  onAddContext,
  onRemoveEntityChip,
  onRemoveDiagramChip,
  onRemoveRelationshipChip,
  questionStatuses,
  isSubmittingAnswers,
  streamedQuestions = [],
  streamedAnswers = {},
  onStreamedAnswerChange,
  onSubmitStreamedAnswers,
  isStreamedQuestionsSubmitting = false,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canAnswerStreamedQuestions: _canAnswerStreamedQuestions = false,
  parts = [],
  partStatuses = new Map(),
  activePartIndex = null,
  onPartClick,
  onRetryOrchestration,
  onResumeQA,
  onSeeSpec,
  onMarkComplete,
  testPlan,
  teAnswers = {},
  teQuestionStatuses,
  onTeAnswerChange,
  onSubmitTeAnswers,
  isTeSubmitting = false,
  teOpenQuestions = [],
  refinementProgressLabel,
  isHolisticReview = false,
}: FeatureDefinitionPanelProps) {
  // ==========================================================================
  // Zone 1: Implementation Plan collapse state
  // ==========================================================================
  const [planCollapsed, setPlanCollapsed] = useState(true);
  const prevIncrementCountRef = useRef(0);

  // ==========================================================================
  // Zone 2: Questions collapse state (tool-managed)
  // ==========================================================================
  const [questionsCollapsed, setQuestionsCollapsed] = useState(true);

  // ==========================================================================
  // Extract data from plannerResponse
  // ==========================================================================

  const featureUnderstanding = plannerResponse?.featureUnderstanding ?? '';
  const scopeIn = plannerResponse?.scope?.in ?? [];
  const scopeOut = plannerResponse?.scope?.out ?? [];
  const acceptanceCriteria = plannerResponse?.acceptanceCriteria ?? [];
  const assumptions = plannerResponse?.assumptions ?? [];
  const openQuestions = plannerResponse?.openQuestions ?? [];
  const implementationPlan = plannerResponse?.implementationPlan ?? null;

  const isReadyForSpec = plannerResponse?.plannerReadyForSpec === true;
  const featureTitle = workItemTitle;

  const questions = deriveQuestions(openQuestions, answers, questionStatuses ?? new Map());
  const hasScopeContent = scopeIn.length > 0 || scopeOut.length > 0;

  const streamedQuestionsWithAnswers = useMemo(() => {
    return streamedQuestions.map((q) => ({
      ...q,
      answer: streamedAnswers[q.id] || '',
    }));
  }, [streamedQuestions, streamedAnswers]);

  const isSplit = (implementationPlan as ImplementationPlan & { isSplit?: boolean })?.isSplit === true;
  const showPartsList = isSplit && parts.length > 0;

  // ==========================================================================
  // Zone 1: Auto-expand when increments first arrive
  // ==========================================================================
  const incrementCount = implementationPlan?.increments?.length ?? 0;
  useEffect(() => {
    if (incrementCount > 0 && prevIncrementCountRef.current === 0) {
      setPlanCollapsed(false);
    }
    prevIncrementCountRef.current = incrementCount;
  }, [incrementCount]);

  // ==========================================================================
  // Zone 2: Auto-expand/collapse based on question presence
  // ==========================================================================
  const hasPOQuestions = questions.length > 0;
  const hasSAQuestions = streamedQuestions.length > 0;

  // Convert TE open questions to Question[] for QuestionsTable
  const teQuestionsForTable: Question[] = teOpenQuestions.map((q) => ({
    id: q.id,
    question: q.question,
    status: teQuestionStatuses?.get(q.id) === 'Answered' ? 'Answered' : 'Open',
    answer: teAnswers[q.id] || '',
    source: 'Test Engineer',
  }));
  const hasTEQuestions = teQuestionsForTable.length > 0;

  const hasAnyQuestions = hasPOQuestions || hasSAQuestions || hasTEQuestions;

  useEffect(() => {
    setQuestionsCollapsed(!hasAnyQuestions);
  }, [hasAnyQuestions]);

  // ==========================================================================
  // Render
  // ==========================================================================

  const renderAddContextButton = () => {
    if (!onAddContext) return null;
    return (
      <button
        className={styles.addContextButton}
        onClick={onAddContext}
        disabled={contextLoading}
        data-testid="add-context-button"
      >
        + Add context
      </button>
    );
  };

  // Count open questions for badge
  const openQuestionCount = questions.filter(q => q.status === 'Open').length + streamedQuestions.length + teQuestionsForTable.filter(q => q.status === 'Open').length;

  return (
    <div className={styles.panel}>
      {/* Feature Header */}
      <FeatureHeader title={featureTitle} epicName={epicName} featureName={featureName} workItemType={workItemType} isReadyForSpec={isReadyForSpec} refinementProgressLabel={refinementProgressLabel} isHolisticReview={isHolisticReview} />

      {/* Zone 1: Collapsible Implementation Plan */}
      <ImplementationPlanSection
        implementationPlan={implementationPlan}
        activeIncrementId={activeIncrementId}
        onIncrementSelect={onIncrementSelect}
        getIncrementStatus={getIncrementStatus}
        collapsed={planCollapsed}
        onToggleCollapse={() => setPlanCollapsed((prev) => !prev)}
        onSeeSpec={onSeeSpec}
        onMarkComplete={onMarkComplete}
      />

      {/* Zone 2: Collapsible Clarifying Questions */}
      <div className={styles.questionsZone} data-testid="questions-zone">
        <div
          className={styles.questionsZoneHeader}
          onClick={() => setQuestionsCollapsed((prev) => !prev)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setQuestionsCollapsed((prev) => !prev);
            }
          }}
          data-testid="questions-zone-header"
        >
          <span className={`${styles.questionsChevron} ${questionsCollapsed ? '' : styles.questionsChevronExpanded}`}>
            &#9656;
          </span>
          <span className={styles.questionsZoneTitle}>Clarifying Questions</span>
          {openQuestionCount > 0 && (
            <span className={styles.questionsZoneCount}>{openQuestionCount}</span>
          )}
        </div>

        {!questionsCollapsed && hasAnyQuestions && (
          <div className={styles.questionsZoneBody} data-testid="questions-zone-body">
            {/* PO Open Questions */}
            {hasPOQuestions && (
              <div className={styles.questionsGroup}>
                <FeatureSectionCard title={<OpenQuestionsHeader />}>
                  <QuestionsTable
                    questions={questions}
                    onAnswerChange={onAnswerChange}
                    onSubmitAnswers={onSubmitAnswers}
                    activeIncrementId={activeIncrementId}
                    isSubmitting={isSubmittingAnswers}
                  />
                </FeatureSectionCard>
              </div>
            )}

            {/* SA Streamed Questions */}
            {hasSAQuestions && (
              <div className={styles.questionsGroup}>
                <FeatureSectionCard title={<SAQuestionsHeader />} data-testid="sa-questions-section">
                  <QuestionsTable
                    questions={streamedQuestionsWithAnswers}
                    onAnswerChange={onStreamedAnswerChange || (() => {})}
                    onSubmitAnswers={onSubmitStreamedAnswers || (() => {})}
                    isSubmitting={isStreamedQuestionsSubmitting}
                  />
                </FeatureSectionCard>
              </div>
            )}

            {/* TE Open Questions */}
            {hasTEQuestions && (
              <div className={styles.questionsGroup}>
                <FeatureSectionCard title="Test Engineer Questions" data-testid="te-questions-section">
                  <QuestionsTable
                    questions={teQuestionsForTable}
                    onAnswerChange={onTeAnswerChange || (() => {})}
                    onSubmitAnswers={onSubmitTeAnswers || (() => {})}
                    isSubmitting={isTeSubmitting}
                  />
                </FeatureSectionCard>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Zone 3 header: non-collapsible */}
      <div className={styles.zone3Header} data-testid="work-item-details-header">
        <span className={styles.zone3HeaderTitle}>Work Item Details</span>
      </div>

      {/* Zone 3: Scrollable feature detail */}
      <div
        className={styles.content}
        data-testid="feature-definition-content"
      >
        {/* 1. Combined Initial Description & Context */}
        <FeatureSectionCard
          title="Initial Description & Context"
          icon={<SquareUserRound size={16} />}
          headerRightContent={renderAddContextButton()}
          className={styles.topSectionCard}
        >
          <p className={styles.description}>{workItemDescription}</p>
          <div className={styles.descriptionContextSeparator} />
          <ContextContent
            contextState={contextState}
            contextLoading={contextLoading}
            onRemoveEntityChip={onRemoveEntityChip}
            onRemoveDiagramChip={onRemoveDiagramChip}
            onRemoveRelationshipChip={onRemoveRelationshipChip}
          />
        </FeatureSectionCard>

        {/* 2. Understanding (dynamic label based on work item type) — hidden during holistic review */}
        {!isHolisticReview && (
          <FeatureSectionCard
            title={workItemType === 'TEST' ? 'Test Engineer Understanding' : 'Product Manager Understanding'}
            icon={<Bot size={16} />}
            isEmpty={!featureUnderstanding}
            emptyMessage={workItemType === 'TEST' ? 'Waiting for Test Engineer understanding...' : 'Waiting for Product Manager understanding...'}
          >
            <p className={styles.understanding}>{featureUnderstanding}</p>
          </FeatureSectionCard>
        )}

        {/* 3. Combined Scope Section — hidden during holistic review */}
        {!isHolisticReview && hasScopeContent && (
          <FeatureSectionCard title="Scope" icon={<Bot size={16} />}>
            <div className={styles.scopeGrid}>
              <div className={styles.scopeColumn}>
                <div className={styles.scopeColumnTitle}>In Scope</div>
                {scopeIn.length > 0 ? (
                  <ul className={styles.bulletList}>
                    {scopeIn.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <div className={styles.scopeNoneDefined}>None defined</div>
                )}
              </div>
              <div className={styles.scopeColumn}>
                <div className={styles.scopeColumnTitle}>Out of Scope</div>
                {scopeOut.length > 0 ? (
                  <ul className={styles.bulletList}>
                    {scopeOut.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <div className={styles.scopeNoneDefined}>None defined</div>
                )}
              </div>
            </div>
          </FeatureSectionCard>
        )}

        {/* 4. Acceptance Criteria — hidden during holistic review */}
        {!isHolisticReview && (
          <FeatureSectionCard
            title="Acceptance Criteria"
            icon={<Bot size={16} />}
            isEmpty={acceptanceCriteria.length === 0}
            emptyMessage="No acceptance criteria defined yet."
          >
            <ol className={styles.numberedList}>
              {acceptanceCriteria.map((criterion, index) => (
                <li key={index}>{criterion}</li>
              ))}
            </ol>
          </FeatureSectionCard>
        )}

        {/* 5. Test Plan (from Test Engineer) */}
        {(isHolisticReview || (testPlan && testPlan.length > 0)) && (
          <FeatureSectionCard
            title="Test Plan"
            icon={<Bot size={16} />}
            isEmpty={!testPlan || testPlan.length === 0}
            emptyMessage="Waiting for Test Engineer to define tests..."
          >
            <ul className={styles.bulletList}>
              {(testPlan || []).map((test, index) => (
                <li key={index}>
                  <strong>[{test.type}]</strong> {test.title}
                  {test.description && <span className={styles.testDescription}> — {test.description}</span>}
                </li>
              ))}
            </ul>
          </FeatureSectionCard>
        )}

        {/* 6. Assumptions — hidden during holistic review */}
        {!isHolisticReview && assumptions.length > 0 && (
          <FeatureSectionCard title="Assumptions" icon={<Bot size={16} />}>
            <ul className={styles.bulletList}>
              {assumptions.map((assumption, index) => (
                <li key={index}>{assumption}</li>
              ))}
            </ul>
          </FeatureSectionCard>
        )}

        {/* 6. Implementation Parts (split plans) */}
        {showPartsList && (
          <PartsListSection
            parts={parts}
            partStatuses={partStatuses}
            activePartIndex={activePartIndex}
            onPartClick={onPartClick || (() => {})}
            onRetryOrchestration={onRetryOrchestration}
            onResumeQA={onResumeQA}
          />
        )}
      </div>
    </div>
  );
}
