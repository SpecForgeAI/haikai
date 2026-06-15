# Task Breakdown: UnifiedChatPanel UX Polish

## Overview
Total Tasks: 5 Task Groups, 29 sub-tasks

All changes are frontend-only. No backend modifications required.

## Key Source Files

| File | Path |
|------|------|
| UnifiedChatPanel | `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` |
| UnifiedChatPanel CSS | `frontend/src/components/UnifiedChat/UnifiedChatPanel.module.css` |
| ChatInputBar | `frontend/src/components/UnifiedChat/ChatInputBar.tsx` |
| MentionInput | `frontend/src/components/UnifiedChat/MentionInput.tsx` |
| MessageBubble | `frontend/src/components/UnifiedChat/MessageBubble.tsx` |
| useChatThread | `frontend/src/hooks/useChatThread.ts` |
| personaConfig | `frontend/src/config/personaConfig.ts` |
| Existing tests (components) | `frontend/src/components/UnifiedChat/__tests__/` |
| Existing tests (hooks) | `frontend/src/hooks/__tests__/` |

## Task List

### Hook & Logic Layer (Small Independent Changes)

#### Task Group 1: Persona Switch Auto-Send, Task Label Fix, and @-Mention Input Clear
**Dependencies:** None
**Parallelism:** This group covers FR2, FR3, and FR4 -- three small, independent changes that can be implemented together since they touch different functions in different files.

- [x] 1.0 Complete hook logic and input behavior changes (FR2 + FR3 + FR4)
  - [x] 1.1 Write 6 focused tests for FR2, FR3, and FR4
    - Create test file: `frontend/src/components/UnifiedChat/__tests__/uxPolish.test.tsx`
    - **FR2 tests (2 tests):**
      - Test that `selectPersona` calls `sendMessage('')` after switching persona (verify the auto-send trigger)
      - Test that `selectPersona` still inserts the "Switched to {name}" system message before auto-send
    - **FR3 tests (2 tests):**
      - Test that selecting a persona from the MentionInput dropdown clears the input value (calls `onChange('')`) instead of inserting `@DisplayName`
      - Test that `onPersonaSelected` is called with the correct persona ID when selecting from dropdown
    - **FR4 tests (2 tests):**
      - Test that `selectTask` sends the menuLabel directly (e.g., `"Define Product"`) not `"Selected task: Define Product"`
      - Test that `selectTask` falls back to taskId when no menuLabel is found in the last structured response
  - [x] 1.2 Modify `selectPersona` in `useChatThread.ts` to auto-send after switch (FR2)
    - File: `frontend/src/hooks/useChatThread.ts`
    - At line 663 (end of `selectPersona` callback, after `setActiveTaskId('unknown')`), add: `sendMessage('');`
    - Update the dependency array at line 663 from `[]` to `[sendMessage]`
    - The existing system message insertion (lines 641-653) and `postHandoff` call (lines 655-658) remain unchanged
    - Because `activeTaskIdRef.current` is set to `'unknown'` synchronously at line 662, the `sendMessage('')` call will enter the queuing path and hit the backend with `taskId='unknown'`, triggering the greeting + task menu response
  - [x] 1.3 Modify `handleSelectPersona` in `MentionInput.tsx` to clear input (FR3)
    - File: `frontend/src/components/UnifiedChat/MentionInput.tsx`
    - In `handleSelectPersona` (lines 143-174):
      - Remove the text insertion logic at lines 150-154 (the `before`, `after`, `insertion`, `newValue` variables and `onChange(newValue)` call)
      - Replace with: `onChange('')` to clear the input
      - Keep the `onPersonaSelected(persona.id)` call at line 157
      - Keep the dropdown close logic at lines 159-162
      - Replace the `setTimeout` cursor-positioning logic at lines 165-171 with a simple: `if (textarea) { textarea.focus(); }`
    - Update the dependency array at line 173: remove `value` since it is no longer used in the function body (keep `mentionStartPos`, `onChange`, `onPersonaSelected`)
  - [x] 1.4 Modify `selectTask` in `useChatThread.ts` to send label directly (FR4)
    - File: `frontend/src/hooks/useChatThread.ts`
    - At line 716, change: `sendMessage(\`Selected task: ${label}\`)` to `sendMessage(label)`
    - No other changes needed; the `label` variable resolution at lines 700-713 remains as-is
  - [x] 1.5 Verify FR2, FR3, FR4 tests pass
    - Run ONLY the tests written in 1.1: `frontend/src/components/UnifiedChat/__tests__/uxPolish.test.tsx`
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `selectPersona` calls `sendMessage('')` after switching, triggering the backend greeting + task menu
- `selectPersona` dependency array includes `sendMessage`
- MentionInput `handleSelectPersona` clears the input via `onChange('')` instead of inserting `@DisplayName` text
- MentionInput textarea is focused after persona selection
- `selectTask` sends the menuLabel directly (e.g., "Define Product") not "Selected task: Define Product"
- All 6 tests from 1.1 pass

---

### Component Layer (Room Header)

#### Task Group 2: Room Header Redesign (FR1)
**Dependencies:** Task Group 1 (selectPersona must auto-send before wiring click handlers)
**Parallelism:** Can run in parallel with Task Group 3 (FR5) since they modify different files.

- [x] 2.0 Complete room header with room/persona model (FR1)
  - [x] 2.1 Write 6 focused tests for FR1 header rendering
    - Add tests to: `frontend/src/components/UnifiedChat/__tests__/uxPolish.test.tsx`
    - **Room name tests (2 tests):**
      - Test that header displays "Room: Project Room" when threadKey is `{ type: 'hub' }`
      - Test that header displays "Room: Product Strategy Room" when threadKey is `{ type: 'panel', screen: 'product' }` and "Room: Architecture Room" when `screen: 'architecture'`
    - **Active persona "In:" tests (2 tests):**
      - Test that header "In:" section renders the active persona's colored circle with initials and displayName text
      - Test that "In:" section updates when activePersonaId changes
    - **Available personas tests (2 tests):**
      - Test that "Available:" section renders clickable icons for all allowed personas except the active one, and always includes 'assistant'
      - Test that clicking an available persona icon calls `selectPersona` with the correct personaId
  - [x] 2.2 Add `getRoomName` helper function to `UnifiedChatPanel.tsx`
    - File: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`
    - Add a pure function above the component (near line 77, after the `getInitialWidth` helper):
      ```
      function getRoomName(threadKey: ThreadKey): string
      ```
    - Implementation: switch on `threadKey.type`:
      - `'hub'` => `"Project Room"`
      - `'panel'` => check `threadKey.screen`: `'product' | 'roadmap' | 'backlog'` => `"Product Strategy Room"`, `'metamodel' | 'architecture'` => `"Architecture Room"`, others => `"Room"`
      - default (`'feature'` or unknown) => `"Room"`
  - [x] 2.3 Add `PERSONA_CONFIGS` import and compute available personas with `useMemo`
    - File: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`
    - At line 59, update import to include `PERSONA_CONFIGS`:
      ```
      import { getPersonaConfig, PERSONA_CONFIGS } from '../../config/personaConfig';
      ```
    - After the `personaConfig` declaration (line 309), add a `useMemo` computation:
      ```typescript
      const availablePersonas = useMemo(() => {
        const allowedSet = allowedPersonaIds
          ? new Set(allowedPersonaIds)
          : new Set(PERSONA_CONFIGS.map(p => p.id));
        // Always include assistant
        allowedSet.add('assistant');
        // Remove the currently active persona
        allowedSet.delete(activePersonaId);
        return PERSONA_CONFIGS.filter(p => allowedSet.has(p.id));
      }, [allowedPersonaIds, activePersonaId]);
      ```
    - Add `useMemo` to the React import at line 56 (already present)
  - [x] 2.4 Replace header JSX in expanded state
    - File: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`
    - Replace the header block at lines 354-374 with the new layout:
      ```
      Chat -- Room: <roomName> -- In: <personaIndicator icon> <displayName> -- Available: <clickable persona icons...> [collapse button]
      ```
    - Use `getRoomName(threadKey)` for the room name
    - "In:" section reuses the existing `personaIndicator` CSS class with the active persona's color, initials, and displayName text
    - "Available:" section maps over `availablePersonas` to render 24px circle icons (initials only, no names) with `onClick={() => selectPersona(persona.id)}`
    - Collapse button stays at far right using flex layout
    - Add `data-testid` attributes: `"header-room-name"`, `"header-active-persona"`, `"header-available-personas"`, `"available-persona-{id}"` for each available icon
  - [x] 2.5 Add new CSS classes to `UnifiedChatPanel.module.css`
    - File: `frontend/src/components/UnifiedChat/UnifiedChatPanel.module.css`
    - Modify `.header` (line 41) to add `flex-wrap: wrap` and adjust padding for the new multi-section layout
    - Modify `.headerLeft` (line 50) to hold the full content row with `flex-wrap: wrap` and `gap: 8px`
    - Add new CSS classes after the existing `.personaIndicator` block (after line 72):
      - `.headerSection` -- flex container for each section (Room, In, Available) with `display: flex; align-items: center; gap: 6px;`
      - `.headerLabel` -- muted label text ("Room:", "In:", "Available:") with `font-size: 13px; font-weight: 400; color: #888;`
      - `.headerSeparator` -- en-dash separator with `color: #ccc; margin: 0 4px;`
      - `.headerPersonaName` -- active persona display name text with `font-size: 14px; font-weight: 500; color: #333;`
      - `.availableIcon` -- clickable variant of `personaIndicator` with `cursor: pointer; transition: opacity 0.2s, box-shadow 0.2s;`
      - `.availableIcon:hover` -- `opacity: 0.85; box-shadow: 0 0 0 2px rgba(0,0,0,0.15);`
  - [x] 2.6 Verify FR1 tests pass
    - Run ONLY the tests written in 2.1 (within `uxPolish.test.tsx`)
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Header displays: "Chat -- Room: {name} -- In: {icon} {name} -- Available: {icons} [collapse]"
- `getRoomName` correctly maps all threadKey variants to room names
- "Available:" shows only allowed personas (minus active), always including 'assistant'
- Clicking an available persona icon calls `selectPersona(personaId)`
- Header gracefully wraps at narrow widths (280px minimum) via `flex-wrap`
- Collapse button remains pinned to the far right
- All 6 tests from 2.1 pass

---

### Component Layer (Questions Rendering)

#### Task Group 3: Questions Response Renders Summary Only (FR5)
**Dependencies:** None
**Parallelism:** Can run in parallel with Task Group 2 (FR1) since they modify different files.

- [x] 3.0 Complete questions rendering fix (FR5)
  - [x] 3.1 Write 4 focused tests for FR5 questions rendering
    - Add tests to: `frontend/src/components/UnifiedChat/__tests__/uxPolish.test.tsx`
    - **Questions rendering tests (4 tests):**
      - Test that when `showQuestions` is true and `structuredResponse.summary` exists, the summary text is rendered above the questions table and `message.content` is NOT rendered
      - Test that when `showQuestions` is true and `structuredResponse.summary` is absent/empty, only the questions table is rendered (no content, no summary)
      - Test that when `showQuestions` is true and `message.content` contains JSON-like text, the content is suppressed (not shown anywhere)
      - Test that regular (non-questions) assistant messages still render `message.content` normally
  - [x] 3.2 Restructure conditional rendering in `MessageBubble.tsx`
    - File: `frontend/src/components/UnifiedChat/MessageBubble.tsx`
    - Move the `showQuestions` branch into the main ternary chain between the `showCompletionChip` branch (ending at line 375) and the else (regular text) branch (line 376)
    - New ternary branch inserted before the final `) : (` at line 376:
      ```
      ) : showQuestions && onSubmitAnswers ? (
        <div className={styles.structuredResponseArea}>
          {(() => {
            const sr = structuredResponse as { summary?: string } | null;
            const summary = sr && typeof sr === 'object' ? (sr as { summary?: string }).summary : undefined;
            return summary ? (
              <div className={styles.messageContent}>{summary}</div>
            ) : null;
          })()}
          <StructuredQuestionsRenderer
            questions={questions}
            onSubmitAnswers={onSubmitAnswers}
            disabled={disabled}
          />
        </div>
      ) : (
      ```
    - Remove the standalone `showQuestions` block at lines 383-392 (the one that currently renders questions as an addendum after the else branch)
    - This ensures that when `showQuestions` is true, `message.content` is entirely suppressed
  - [x] 3.3 Verify FR5 tests pass
    - Run ONLY the tests written in 3.1 (within `uxPolish.test.tsx`)
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- When a structured response contains questions, `message.content` is fully suppressed
- `structuredResponse.summary` is displayed as plain text above the questions table when present
- When summary is absent, only the questions table renders (no empty space or placeholder)
- Regular text messages continue to render normally
- All 4 tests from 3.1 pass

---

### Integration & Verification

#### Task Group 4: Integration Verification
**Dependencies:** Task Groups 1, 2, and 3 (all implementation complete)

- [x] 4.0 Verify all feature tests pass together
  - [x] 4.1 Run all tests from the `uxPolish.test.tsx` test file
    - Run: `frontend/src/components/UnifiedChat/__tests__/uxPolish.test.tsx`
    - Expected: all 16 tests (6 from TG1 + 6 from TG2 + 4 from TG3) pass
  - [x] 4.2 Run existing test suites to check for regressions
    - Run existing component tests: `frontend/src/components/UnifiedChat/__tests__/containerIntegration.test.tsx`
    - Run existing component tests: `frontend/src/components/UnifiedChat/__tests__/coreComponents.test.tsx`
    - Run existing hook tests: `frontend/src/hooks/__tests__/useChatThread-enhancements.test.ts`
    - Check for failures caused by:
      - Changed `selectPersona` behavior (now calls `sendMessage`)
      - Changed `selectTask` message format (no longer "Selected task: " prefix)
      - Changed MentionInput behavior (no longer inserts `@DisplayName`)
      - Changed header structure (tests asserting old header layout)
      - Changed MessageBubble rendering (questions now in ternary chain)
  - [x] 4.3 Fix any regression test failures
    - Update existing test assertions that relied on:
      - `selectPersona` NOT calling `sendMessage` -- add mock expectations
      - `selectTask` sending `"Selected task: {label}"` -- update to expect just `"{label}"`
      - MentionInput inserting `@DisplayName` text -- update to expect cleared input
      - Header containing only "Chat" title + single persona indicator -- update to expect new header structure
      - Questions rendering appearing after content -- update to expect content suppressed

**Acceptance Criteria:**
- All 16 feature-specific tests pass
- All existing test suites pass (with any necessary assertion updates)
- No regressions introduced in unrelated functionality

---

### Test Coverage Review

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Group 4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-3
    - Review the 6 tests from Task Group 1 (FR2/FR3/FR4 hook and input behavior)
    - Review the 6 tests from Task Group 2 (FR1 header rendering)
    - Review the 4 tests from Task Group 3 (FR5 questions rendering)
    - Total existing feature tests: 16 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to FR1-FR5 requirements
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
    - Key areas to check:
      - FR1: Does the available persona list handle undefined `allowedPersonaIds` (hub case)?
      - FR2: Does the auto-send correctly trigger with `activeTaskId='unknown'`?
      - FR3: Does the MentionInput keyboard Enter selection also clear input (not just mouse click)?
      - FR5: Does the summary extraction handle edge cases (null structuredResponse, empty summary string)?
  - [x] 5.3 Write up to 8 additional strategic tests maximum
    - Add maximum of 8 new tests to fill identified critical gaps
    - Focus on integration points and edge cases specific to this feature
    - Suggested gap tests:
      - FR1: Available personas when `allowedPersonaIds` is undefined (hub = all 6 minus active)
      - FR1: Available personas always includes assistant even when not in `allowedPersonaIds`
      - FR2: `selectPersona` with same persona ID (no system message, no sendMessage)
      - FR3: MentionInput keyboard Enter persona selection clears input (not just click)
      - FR4: `selectTask` with pending queued message sends the queued text, not the label
      - FR5: Questions rendering with empty string summary (should not render empty div)
      - Integration: End-to-end flow -- click available persona icon => system message + auto-send triggered
      - Integration: End-to-end flow -- @-mention select => input cleared + auto-send triggered
    - Do NOT write exhaustive coverage for all edge cases
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY: `frontend/src/components/UnifiedChat/__tests__/uxPolish.test.tsx`
    - Expected total: approximately 24 tests maximum (16 original + up to 8 gap tests)
    - Verify all tests pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24 tests total)
- Critical user workflows for FR1-FR5 are covered
- No more than 8 additional tests added to fill gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

```
Task Group 1 (FR2 + FR3 + FR4: Hook logic + MentionInput)
    |
    |--- Task Group 2 (FR1: Room Header) ---\
    |                                         \
    |--- Task Group 3 (FR5: Questions)  -------> Task Group 4 (Integration)
                                                       |
                                                  Task Group 5 (Test Gaps)
```

**Recommended implementation sequence:**

1. **Task Group 1** (FR2 + FR3 + FR4) -- Start here. These are small, focused changes to `useChatThread.ts` and `MentionInput.tsx`. FR2 must be done before FR1 can wire click handlers.
2. **Task Group 2** (FR1) and **Task Group 3** (FR5) -- Can run **in parallel** after TG1. They modify different files (`UnifiedChatPanel.tsx` + CSS vs. `MessageBubble.tsx`).
3. **Task Group 4** (Integration) -- Run after TG1, TG2, and TG3 are all complete. Validates everything works together and fixes regressions.
4. **Task Group 5** (Test Gaps) -- Final pass to review coverage and fill critical gaps only.

## Files Modified Summary

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/hooks/useChatThread.ts` | TG1 | FR2: `selectPersona` adds `sendMessage('')` + deps. FR4: `selectTask` sends `label` directly |
| `frontend/src/components/UnifiedChat/MentionInput.tsx` | TG1 | FR3: `handleSelectPersona` clears input instead of inserting text |
| `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` | TG2 | FR1: `getRoomName` helper, `PERSONA_CONFIGS` import, `useMemo` available personas, new header JSX |
| `frontend/src/components/UnifiedChat/UnifiedChatPanel.module.css` | TG2 | FR1: New CSS classes for header sections, labels, separators, clickable icons |
| `frontend/src/components/UnifiedChat/MessageBubble.tsx` | TG3 | FR5: Restructure ternary chain, suppress content for questions, render summary |
| `frontend/src/components/UnifiedChat/__tests__/uxPolish.test.tsx` | TG1-5 | New test file for all FR1-FR5 tests |
