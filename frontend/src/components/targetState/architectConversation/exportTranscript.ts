/**
 * exportTranscript -- Markdown transcript export utility.
 *
 * Spec: 2026-05-26 Architect Conversation Enrichments (Batched #11 + #12)
 *
 * Builds a Markdown string carrying the full Architect Conversation
 * transcript (header + one fragment per turn) for download from the
 * "Export transcript" toolbar button in `ArchitectConversationTab`.
 *
 * Per-turn emit shapes apply the per-kind table in
 * `agent-os/specs/2026-05-26-architect-conversation-enrichments/planning/requirements.md`
 * VERBATIM. The 15 turn kinds:
 *   open, close, tech-stack-prefill-summary, question, answer,
 *   cascade-summary, cascade-accepted, cascade-overridden,
 *   decision-captured, mapping-mutation-summary, exception-pinned,
 *   edit-superseded, system-skip, error, tier-confirmation.
 *
 * Heading levels:
 *   - `## H2` for session lifecycle (open, close).
 *   - `### H3` for question turns and tech-stack-prefill-summary.
 *   - Bold-label paragraphs (no heading) for all other kinds, so they nest
 *     visually under the most recent `##` / `###`.
 *
 * `unknown`-typed values (cascade `proposedValue`, captured `answerValue`)
 * are coerced via `String(v)` -- NOT `JSON.stringify(v)` -- to match the
 * existing `ConversationMainPane` on-screen rendering at line 320 (cascade
 * `proposedValue` -> `String(c.proposedValue)`). This keeps export and
 * on-screen content visually consistent.
 *
 * Fragments are joined with `\n\n` so blocks visually separate in any
 * Markdown previewer.
 */

import { resolveCapturedAnswerLabel } from '../../../api/architectConversationApi';
import type { ConversationTurn, TierFlags } from '../../../api/architectConversationApi';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ExportTranscriptArgs {
  turns: ConversationTurn[];
  /**
   * The architecture's display name. Falls back to
   * `selectedTargetArchitectureId` (then a literal `'unknown'`) so the header
   * always has a non-empty value.
   */
  architectureName?: string | null;
  /**
   * The target architecture id. Used as the architecture-name fallback when
   * the display name is null/undefined/empty.
   */
  selectedTargetArchitectureId?: string | null;
  /** The project id. Required for the header. */
  projectId: string;
}

/**
 * Produce a Markdown string of the full conversation transcript.
 *
 * @returns A Markdown string suitable for download as a `.md` file. Per spec,
 *  the fragments are joined with `\n\n` so blocks visually separate in any
 *  Markdown previewer. The header occupies the first block; one fragment per
 *  turn follows in chronological order.
 */
export function exportTranscript(args: ExportTranscriptArgs): string {
  const { turns, architectureName, selectedTargetArchitectureId, projectId } = args;
  const archDisplay =
    architectureName != null && architectureName.length > 0
      ? architectureName
      : selectedTargetArchitectureId ?? 'unknown';
  const exportedAt = new Date().toISOString();

  const header = [
    '# Architect Conversation',
    '',
    `**Project:** ${projectId}`,
    `**Architecture:** ${archDisplay}`,
    `**Exported:** ${exportedAt}`,
    '',
    '---',
  ].join('\n');

  const fragments: string[] = [header];
  for (const turn of turns) {
    fragments.push(renderTurn(turn));
  }
  return fragments.join('\n\n');
}

/**
 * Slugify a name for use in a download filename. Lowercases, replaces any
 * non-`[a-z0-9-]` run with `-`, and trims leading/trailing `-`.
 *
 * Exported so the toolbar's `handleExportTranscript` can derive the
 * filename without duplicating the regex pattern.
 */
export function slugifyForFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Human-readable list of the technology tiers that are ON in a {@link TierFlags}
 * set (e.g. `"Service, Persistence"`), or `"none"` when all are off. Shared by
 * the tier-confirmation export fragment.
 */
function tierFlagsLabel(flags: TierFlags): string {
  const on: string[] = [];
  if (flags.hasUiTier) on.push('UI');
  if (flags.hasServiceTier) on.push('Service');
  if (flags.hasPersistenceTier) on.push('Persistence');
  return on.length > 0 ? on.join(', ') : 'none';
}

// ---------------------------------------------------------------------------
// Per-turn-kind fragment templates (planning/requirements.md, verbatim)
// ---------------------------------------------------------------------------

function renderTurn(turn: ConversationTurn): string {
  switch (turn.kind) {
    case 'open':
      return [
        '## Session opened',
        '',
        `- Opened by: ${turn.openedBy}`,
        `- Session id: \`${turn.sessionId}\``,
      ].join('\n');

    case 'close':
      return [
        '## Session closed',
        '',
        `- Reason: ${turn.closeReason}`,
        `- Session id: \`${turn.sessionId}\``,
        '',
        // summaryMarkdown is already a well-formed Markdown fragment built by
        // buildCloseSummaryMarkdown; emit verbatim.
        turn.summaryMarkdown,
      ].join('\n');

    case 'tech-stack-prefill-summary': {
      const orgPath = turn.orgFilePath ?? '—';
      const projectPath = turn.projectFilePath ?? '—';
      const partial =
        turn.partialFailureCodes.length > 0
          ? turn.partialFailureCodes.join(', ')
          : 'none';
      const failureReason = turn.failureReason ?? '—';
      return [
        `### Tech-stack pre-fill (${turn.bannerVariant})`,
        '',
        `- Matched: ${turn.matchedCount} of ${turn.denominator}`,
        `- Org file present: ${turn.orgFilePresent} (${orgPath})`,
        `- Project file present: ${turn.projectFilePresent} (${projectPath})`,
        `- Partial failures: ${partial}`,
        `- Failure reason: ${failureReason}`,
      ].join('\n');
    }

    case 'tier-confirmation':
      return [
        '### Technology tiers',
        '',
        `- Detected: ${tierFlagsLabel(turn.derivedTiers)}`,
        `- Confirmed: ${tierFlagsLabel(turn.confirmedTiers)}`,
      ].join('\n');

    case 'question': {
      const heading = `### Q · ${turn.decisionCode} · round ${turn.roundIndex}`;
      const promptLine = `> ${turn.promptText}`;
      // Lead-in (when present) appears as an italicised paragraph below the
      // prompt block.
      if (
        turn.staticContextLeadIn != null &&
        turn.staticContextLeadIn.length > 0
      ) {
        return [heading, '', promptLine, '', `_${turn.staticContextLeadIn}_`].join(
          '\n',
        );
      }
      return [heading, '', promptLine].join('\n');
    }

    case 'answer':
      return `**Architect:** ${turn.answerText}`;

    case 'cascade-summary': {
      const lines = turn.cascadedDecisions.map(
        (c) =>
          `- \`${c.decisionCode}\` → ${String(c.proposedValue)}  _(source: ${c.sourceStandardId})_`,
      );
      return [
        '**Cascade summary** — proposed downstream values:',
        '',
        ...lines,
      ].join('\n');
    }

    case 'cascade-accepted': {
      const lines = turn.cascadedDecisions.map(
        (c) => `- \`${c.decisionCode}\` → ${resolveCapturedAnswerLabel(c.answerValue)}`,
      );
      return ['**Cascades accepted:**', '', ...lines].join('\n');
    }

    case 'cascade-overridden': {
      const lines = turn.cascadedDecisions.map(
        (c) =>
          `- \`${c.decisionCode}\` → ${resolveCapturedAnswerLabel(c.answerValue)}  _(reason: ${c.overrideReason})_`,
      );
      return ['**Cascades overridden:**', '', ...lines].join('\n');
    }

    case 'decision-captured': {
      const scopeFragment =
        turn.scope.kind === 'element'
          ? `element:${turn.scope.refType}:${turn.scope.refId}`
          : 'architecture';
      const standardSuffix =
        turn.standardsLookupRef != null
          ? `; standard: ${turn.standardsLookupRef}`
          : '';
      return (
        `**Captured:** \`${turn.decisionCode}\` = ${resolveCapturedAnswerLabel(turn.answerValue)}  ` +
        `_(scope: ${scopeFragment}; id: \`${turn.decisionId}\`${standardSuffix})_`
      );
    }

    case 'mapping-mutation-summary': {
      const headLine =
        `**Mapping mutations:** ${turn.affectedMappings} mappings affected, ` +
        `${turn.mappingTypeChanges} type changes, ${turn.notesDecorations} notes added.`;
      const tableLines = turn.tableSetSummary.map(
        (t) =>
          `- ${t.tableSet}: ${t.affectedMappings}/${t.mappingTypeChanges}/${t.notesDecorations}`,
      );
      return [headLine, '', ...tableLines].join('\n');
    }

    case 'exception-pinned':
      return (
        `**Exception pinned:** \`${turn.decisionCode}\` = ${resolveCapturedAnswerLabel(turn.answerValue)} ` +
        `_(on ${turn.scope.refType}:${turn.scope.refId})_`
      );

    case 'edit-superseded': {
      const codes =
        turn.affectedDownstreamCodes.length > 0
          ? turn.affectedDownstreamCodes.join(', ')
          : '(none)';
      return (
        `**Revision:** decision \`${turn.originalDecisionId}\` → ` +
        `\`${turn.newDecisionId}\`.  Downstream codes possibly affected: ${codes}`
      );
    }

    case 'system-skip':
      return `**Skipped:** \`${turn.decisionCode}\` — ${turn.relevanceReason}`;

    case 'error': {
      const hint =
        turn.recoverableHint != null && turn.recoverableHint.length > 0
          ? ` — hint: ${turn.recoverableHint}`
          : '';
      return `**Error** _(${turn.errorKind})_: ${turn.errorMessage}${hint}`;
    }

    // -----------------------------------------------------------------------
    // Open-phase turns (Spec 2026-06-06-architect-conversation-open-ended-phase).
    // The five turn kinds that begin after the deterministic preset walk exhausts.
    // -----------------------------------------------------------------------
    case 'open-phase-prompt': {
      const areaLines =
        turn.suggestedAreas.length > 0
          ? turn.suggestedAreas.map((a) =>
              a.rationale != null && a.rationale.length > 0
                ? `- ${a.label} — _${a.rationale}_`
                : `- ${a.label}`,
            )
          : ['- (none suggested)'];
      return ['### Open discussion', '', `> ${turn.promptText}`, '', '**Suggested areas:**', '', ...areaLines].join('\n');
    }

    case 'user-raised-topic': {
      const detail =
        turn.topicText != null && turn.topicText.length > 0
          ? `: ${turn.topicText}`
          : '';
      return `**Architect raised topic:** ${turn.topicLabel}${detail}`;
    }

    case 'option-proposal': {
      const optionLines = turn.options.map((o) =>
        o.label != null && o.label.length > 0
          ? `- ${o.label} (\`${o.value}\`)`
          : `- \`${o.value}\``,
      );
      if (turn.allowFreeTextEscape) {
        optionLines.push(`- ${turn.freeTextEscapeLabel ?? 'Something else…'} (free text)`);
      }
      return [
        `**Proposed options for ${turn.topicLabel}** _(${turn.selectionMode}-select)_:`,
        '',
        ...optionLines,
      ].join('\n');
    }

    case 'user-pick': {
      const picked =
        turn.freeTextValue != null && turn.freeTextValue.length > 0
          ? turn.freeTextValue
          : turn.selectedValues.length > 0
            ? turn.selectedValues.join(', ')
            : '(none)';
      return `**Architect picked:** \`${turn.decisionCode}\` = ${picked}`;
    }

    case 'free-form-discussion': {
      const who = turn.speaker === 'assistant' ? 'Assistant' : 'Architect';
      return `**${who}:** ${turn.messageText}`;
    }

    default: {
      // Exhaustiveness guard: a future spec adding a new turn kind will surface
      // a compile-time error here via the `never` widening.
      const _exhaustive: never = turn;
      void _exhaustive;
      return '';
    }
  }
}
