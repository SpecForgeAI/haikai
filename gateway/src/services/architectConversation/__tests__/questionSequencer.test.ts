import { selectNextQuestion, toPendingQuestionDto } from '../questionSequencer';
import { QUESTION_LIBRARY } from '../../../config/architect-conversation/questionLibrary';

/**
 * Tests for the question sequencer — the driver that decides which question the
 * architect is asked next. This is the piece the conversation feature was
 * missing (no consumer of orderInGroup existed before).
 */
describe('selectNextQuestion', () => {
  it('returns the first walk-order question (group A, orderInGroup 1) when nothing is answered', () => {
    const next = selectNextQuestion({ answeredCodes: new Set() });
    expect(next).not.toBeNull();
    expect(next!.group).toBe('A');
    expect(next!.orderInGroup).toBe(1);
  });

  it('enforces intra-group order: A.1 is surfaced before A.2', () => {
    const groupA = QUESTION_LIBRARY.filter((e) => e.group === 'A').sort(
      (a, b) => a.orderInGroup - b.orderInGroup,
    );
    const next = selectNextQuestion({ answeredCodes: new Set() })!;
    expect(next.code).toBe(groupA[0].code);
  });

  it('skips already-captured codes and advances to the next', () => {
    const first = selectNextQuestion({ answeredCodes: new Set() })!;
    const second = selectNextQuestion({ answeredCodes: new Set([first.code]) });
    expect(second).not.toBeNull();
    expect(second!.code).not.toBe(first.code);
  });

  it('returns null once every question has a captured-decision row (walk complete)', () => {
    const all = new Set(QUESTION_LIBRARY.map((e) => e.code));
    expect(selectNextQuestion({ answeredCodes: all })).toBeNull();
  });

  it('auto-skips Group E (frontend) questions when hasUiTier is false', () => {
    const nonE = new Set(
      QUESTION_LIBRARY.filter((e) => e.group !== 'E').map((e) => e.code),
    );
    const next = selectNextQuestion({
      answeredCodes: nonE,
      relevanceContext: { hasUiTier: false, hasServiceTier: true, hasPersistenceTier: true },
    });
    expect(next).toBeNull();
  });

  it('presents Group E questions when hasUiTier is true', () => {
    const hasGroupE = QUESTION_LIBRARY.some((e) => e.group === 'E');
    if (!hasGroupE) {
      return; // library has no frontend questions; nothing to assert
    }
    const nonE = new Set(
      QUESTION_LIBRARY.filter((e) => e.group !== 'E').map((e) => e.code),
    );
    const next = selectNextQuestion({
      answeredCodes: nonE,
      relevanceContext: { hasUiTier: true, hasServiceTier: true, hasPersistenceTier: true },
    });
    expect(next).not.toBeNull();
    expect(next!.group).toBe('E');
  });

  it('projects the fixed library prompt + metadata into the pending-question DTO', () => {
    const entry = QUESTION_LIBRARY[0];
    const dto = toPendingQuestionDto(entry);
    expect(dto.decisionCode).toBe(entry.code);
    expect(dto.promptText).toContain(entry.prompt);
    expect(dto.expectedAnswerShape).toBe(entry.expectedAnswerShape);
    expect(dto.defaultsWhenUnchanged).toBe(entry.defaultsWhenUnchanged);
  });

  it('flags optional-capability questions via the DTO `optional` field and leaves fundamentals non-optional', () => {
    const metrics = QUESTION_LIBRARY.find((e) => e.code === 'metrics.framework');
    const language = QUESTION_LIBRARY.find((e) => e.code === 'service.language');
    expect(metrics).toBeDefined();
    expect(language).toBeDefined();
    // metrics.framework is an opt-out-able capability; service.language is not.
    expect(toPendingQuestionDto(metrics!).optional).toBe(true);
    expect(toPendingQuestionDto(language!).optional).toBe(false);
  });
});
