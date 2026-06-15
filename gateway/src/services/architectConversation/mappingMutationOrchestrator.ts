/**
 * Mapping Mutation Orchestrator -- Architect-Persona Conversation
 * (Spec 3, Commit 4)
 *
 * Spec: 2026-05-24-target-state-architect-conversation
 *
 * After the decision capture orchestrator (Commit 3) writes a captured-
 * decision row through Spec 2's POST endpoint, this orchestrator selects the
 * gateway-owned mutation rule subset for the decision's `decisionCode` and
 * invokes the new Architecture Model Service `apply-mapping-mutations`
 * endpoint. The endpoint runs everything inside one `@Transactional`
 * boundary; this orchestrator translates the AMS response into a
 * `mapping-mutation-summary` conversation turn that the UI surface and the
 * downstream transcript reader can consume.
 *
 * Failure mode (per Q13 + spec.md §"AMS apply-mapping-mutations endpoint"):
 * decisions and mutations are SEPARATE transactions. If the mutation call
 * fails the captured-decision row is NOT rolled back. The orchestrator
 * appends an `error` turn with `errorKind = 'mapping-mutation-failed'` and
 * returns; the user can re-trigger the mutation by re-running the same
 * decision flow later.
 *
 * Cascade-accept-batch interaction (per tasks.md §4.5): the caller runs this
 * orchestrator ONCE per cascaded decision id -- the orchestrator does not
 * know about batches, it just operates on a single (decisionId, decisionCode)
 * pair.
 */

import {
  appendTurn as defaultAppendTurn,
} from '../targetStateConversationStore';
import {
  ApplyMappingMutationsError,
  ApplyMappingMutationsRequestBody,
  ApplyMappingMutationsResponseBody,
  applyMappingMutationsForDecision as defaultApplyMappingMutations,
} from './applyMappingMutationsClient';
import {
  MAPPING_MUTATION_RULES,
  MappingMutationRule,
  MappingMutationRules,
} from '../../config/architect-conversation/mappingMutationRules';
import type {
  ConversationErrorKind,
  ErrorTurn,
  MappingMutationSummaryTurn,
  MappingMutationTableSetSummary,
} from './turnShape';
import type { ScopeRefType } from '../../config/architect-conversation/questionLibrary';
import { logger } from '../logger';

// ---------------------------------------------------------------------------
// Error kind extension -- the decision-capture turn shape already declares a
// `mapping-mutation-failed` variant via the shared `ConversationErrorKind`
// union maintained in turnShape.ts. We re-export the constant here so callers
// have a single import path for the orchestrator's failure semantics.
// ---------------------------------------------------------------------------

/** Errors emitted by this orchestrator carry this `errorKind` value. */
export const MAPPING_MUTATION_ERROR_KIND: ConversationErrorKind =
  'mapping-mutation-failed';

// ---------------------------------------------------------------------------
// Injectable dependencies (test seam)
// ---------------------------------------------------------------------------

export interface MappingMutationDeps {
  /** POST helper for the AMS apply-mapping-mutations endpoint. Tests mock this directly. */
  applyMutations: typeof defaultApplyMappingMutations;
  /** Append a turn to the thread store. Tests mock this directly. */
  appendTurn: typeof defaultAppendTurn;
  /** Rules map (decisionCode -> rule). Defaults to the gateway-owned `MAPPING_MUTATION_RULES`. */
  rules: MappingMutationRules;
}

export const defaultMappingMutationDeps: MappingMutationDeps = {
  applyMutations: defaultApplyMappingMutations,
  appendTurn: defaultAppendTurn,
  rules: MAPPING_MUTATION_RULES,
};

// ---------------------------------------------------------------------------
// Inputs / Outputs
// ---------------------------------------------------------------------------

/**
 * Per-element exception narrowing. Mirrors the AMS request DTO's optional
 * `elementRefType` + `elementRefId` fields. Both present or both absent.
 */
export interface MutationElementRef {
  refType: ScopeRefType;
  refId: string;
}

export interface ApplyMutationArgs {
  projectId: string;
  targetArchitectureId: string;
  /** The captured-decision row id whose mutations are being applied. */
  decisionId: string;
  /** The captured-decision row's decision code -- selects the rule subset. */
  decisionCode: string;
  /**
   * Optional element-ref narrowing the affected set to a single row. Set when
   * the captured decision was a per-element exception (scope_kind = element).
   */
  elementRef?: MutationElementRef;
}

export type ApplyMutationOutcome =
  | {
      kind: 'applied';
      summaryTurn: MappingMutationSummaryTurn;
      response: ApplyMappingMutationsResponseBody;
    }
  | {
      kind: 'error';
      errorTurn: ErrorTurn;
      cause: unknown;
    };

// ---------------------------------------------------------------------------
// Orchestrator class
// ---------------------------------------------------------------------------

export class MappingMutationOrchestrator {
  constructor(private readonly deps: MappingMutationDeps = defaultMappingMutationDeps) {}

  /**
   * Look up the rule subset for the captured decision's code, POST to the AMS
   * apply-mapping-mutations endpoint, and append a
   * `mapping-mutation-summary` turn on success. On failure, append an
   * `error` turn with `errorKind = 'mapping-mutation-failed'` and return
   * without re-throwing -- decisions and mutations are separate transactions
   * and the captured-decision row stays intact (the user retries by
   * re-triggering the same answer flow).
   *
   * Returns the outcome so callers can branch on success vs. failure without
   * inspecting transcript state.
   */
  async applyForCapturedDecision(args: ApplyMutationArgs): Promise<ApplyMutationOutcome> {
    const rule = this.resolveRule(args.decisionCode);
    const body: ApplyMappingMutationsRequestBody = {
      affectedTableSets: [...rule.affectedTableSets],
      defaultMappingTypeChange: rule.defaultMappingTypeChange,
      scopeBoundary: rule.scopeBoundary,
      elementRefType: args.elementRef ? args.elementRef.refType : null,
      elementRefId: args.elementRef ? args.elementRef.refId : null,
    };

    try {
      const response = await this.deps.applyMutations(
        args.projectId,
        args.targetArchitectureId,
        args.decisionId,
        body,
      );

      const summaryTurn: MappingMutationSummaryTurn = {
        kind: 'mapping-mutation-summary',
        affectedMappings: response.affectedMappings,
        mappingTypeChanges: response.mappingTypeChanges,
        notesDecorations: response.notesDecorations,
        tableSetSummary: response.tableSetSummary.map(
          (entry): MappingMutationTableSetSummary => ({
            tableSet: entry.tableSet,
            affectedMappings: entry.affectedMappings,
            mappingTypeChanges: entry.mappingTypeChanges,
            notesDecorations: entry.notesDecorations,
          }),
        ),
      };
      await this.deps.appendTurn(
        args.projectId,
        args.targetArchitectureId,
        summaryTurn,
      );
      return { kind: 'applied', summaryTurn, response };
    } catch (err) {
      const errorTurn = buildErrorTurnFromMutationFailure(err);
      await this.deps.appendTurn(
        args.projectId,
        args.targetArchitectureId,
        errorTurn,
      );
      logger.warn('apply-mapping-mutations failed; appended error turn', {
        projectId: args.projectId,
        targetArchitectureId: args.targetArchitectureId,
        decisionId: args.decisionId,
        decisionCode: args.decisionCode,
        errorKind: errorTurn.errorKind,
        errorMessage: errorTurn.errorMessage,
      });
      return { kind: 'error', errorTurn, cause: err };
    }
  }

  /**
   * Resolves the rule subset for a decision code. Falls back to a notes-only
   * rule when the code is not present in `MAPPING_MUTATION_RULES` (defence in
   * depth -- `MAPPING_MUTATION_RULES` should cover all 51 codes already, but
   * unknown codes still get the audit-trail notes decoration rather than
   * silently doing nothing).
   */
  private resolveRule(decisionCode: string): MappingMutationRule {
    const rule = this.deps.rules[decisionCode];
    if (rule) return rule;
    logger.warn(
      'No mapping-mutation rule found for decision code; falling back to notes-only',
      { decisionCode },
    );
    return {
      affectedTableSets: [],
      defaultMappingTypeChange: 'none',
      scopeBoundary: 'parent-not-leaf',
    };
  }
}

// ---------------------------------------------------------------------------
// Error turn builder
// ---------------------------------------------------------------------------

function buildErrorTurnFromMutationFailure(err: unknown): ErrorTurn {
  if (err instanceof ApplyMappingMutationsError) {
    return {
      kind: 'error',
      errorKind: MAPPING_MUTATION_ERROR_KIND,
      errorMessage: err.message,
      recoverableHint:
        err.status >= 500
          ? 'Architecture model service is unavailable. The captured decision was saved; '
            + 'retry the answer to re-apply mapping mutations.'
          : 'Apply-mapping-mutations was rejected by the architecture model service. '
            + 'The captured decision was saved; inspect the rule subset and retry.',
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    kind: 'error',
    errorKind: MAPPING_MUTATION_ERROR_KIND,
    errorMessage: `Unexpected error while applying mapping mutations: ${message}`,
  };
}

// ---------------------------------------------------------------------------
// Convenience singleton (production usage)
// ---------------------------------------------------------------------------

export const defaultMappingMutationOrchestrator = new MappingMutationOrchestrator(
  defaultMappingMutationDeps,
);
