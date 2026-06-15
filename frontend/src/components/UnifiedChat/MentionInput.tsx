/**
 * MentionInput Component
 *
 * Spec 2026-02-28: Unified Chat Panel v1 (Frontend)
 * Task Group 6, Task 6.2: Create MentionInput component
 *
 * Spec 2026-03-03: UnifiedChatPanel UX Polish
 * Task Group 1, Task 1.3: FR3 -- Clear input on persona selection instead of inserting @DisplayName
 *
 * Textarea with inline @-mention support for persona selection.
 * Detects `@` character, opens a filterable dropdown of personas,
 * supports keyboard navigation (ArrowUp/ArrowDown/Enter/Escape),
 * and clears the input on selection (triggering persona switch via onPersonaSelected).
 *
 * Features:
 * - Dropdown positioned above the textarea listing personas filtered by text after `@`
 * - If `allowedPersonaIds` is provided, only those personas are shown; otherwise all 6
 * - Keyboard navigation: ArrowUp/ArrowDown to move selection, Enter to select, Escape to dismiss
 * - On selection: clears input via onChange(''), calls onPersonaSelected(personaId), closes dropdown
 * - Dropdown styled as floating list with persona color dots and display names
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { PERSONA_CONFIGS } from '../../config/personaConfig';
import type { PersonaConfig } from '../../config/personaConfig';
import styles from './MentionInput.module.css';

// ============================================================================
// Props Interface
// ============================================================================

export interface MentionInputProps {
  /** Current textarea value */
  value: string;
  /** Callback when textarea value changes */
  onChange: (value: string) => void;
  /** Callback when a persona is selected from the dropdown */
  onPersonaSelected: (personaId: string) => void;
  /** If provided, only show these personas; otherwise show all 6 */
  allowedPersonaIds?: string[];
  /** Whether the textarea is disabled */
  disabled?: boolean;
  /** Callback when user presses Enter (without Shift) to submit */
  onSubmit: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Analyze text up to cursorPos for an active @-mention.
 * Returns { isActive, filterText, startPos } if an @-mention is active,
 * or null if no active mention is found.
 */
function detectMention(text: string, cursorPos: number) {
  const textBeforeCursor = text.slice(0, cursorPos);
  const lastAtIndex = textBeforeCursor.lastIndexOf('@');

  if (lastAtIndex === -1) return null;

  // Check that the `@` is at the start of a word (preceded by space, newline, or at position 0)
  const charBefore = lastAtIndex > 0 ? text[lastAtIndex - 1] : ' ';
  if (charBefore !== ' ' && charBefore !== '\n' && lastAtIndex !== 0) return null;

  const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
  // Only active if there is no newline in the filter text
  if (textAfterAt.includes('\n')) return null;

  return {
    isActive: true,
    filterText: textAfterAt,
    startPos: lastAtIndex,
  };
}

// ============================================================================
// Component
// ============================================================================

export function MentionInput({
  value,
  onChange,
  onPersonaSelected,
  allowedPersonaIds,
  disabled = false,
  onSubmit,
}: MentionInputProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState<number | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Determine which personas to show in the dropdown
  const availablePersonas: PersonaConfig[] = allowedPersonaIds
    ? PERSONA_CONFIGS.filter((p) => allowedPersonaIds.includes(p.id))
    : PERSONA_CONFIGS;

  // Filter personas by the text after `@`
  const filteredPersonas = availablePersonas.filter((p) =>
    p.displayName.toLowerCase().includes(filterText.toLowerCase())
  );

  // Reset selected index when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filterText]);

  /**
   * Handle textarea input changes.
   * Detects `@` character to open the dropdown and tracks filter text.
   * Reads cursor position from the textarea ref for reliable access in jsdom.
   */
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      onChange(newValue);

      // Use a microtask to read selectionStart after React has flushed
      // the value update to the DOM. This is more reliable than reading
      // from the event target directly, especially in jsdom.
      const textarea = textareaRef.current;
      const cursorPos = textarea ? textarea.selectionStart : newValue.length;

      const mention = detectMention(newValue, cursorPos);

      if (mention) {
        setShowDropdown(true);
        setFilterText(mention.filterText);
        setMentionStartPos(mention.startPos);
      } else {
        setShowDropdown(false);
        setFilterText('');
        setMentionStartPos(null);
      }
    },
    [onChange]
  );

  /**
   * Handle persona selection from the dropdown.
   * Spec 2026-03-03: UX Polish FR3 -- Clears input and triggers persona switch
   * instead of inserting @DisplayName text.
   */
  const handleSelectPersona = useCallback(
    (persona: PersonaConfig) => {
      if (mentionStartPos === null) return;

      const textarea = textareaRef.current;

      // Clear the input instead of inserting @DisplayName text
      onChange('');
      onPersonaSelected(persona.id);

      // Close dropdown
      setShowDropdown(false);
      setFilterText('');
      setMentionStartPos(null);

      // Focus textarea after clearing
      if (textarea) {
        textarea.focus();
      }
    },
    [mentionStartPos, onChange, onPersonaSelected]
  );

  /**
   * Handle keyboard events for navigation and submission.
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showDropdown && filteredPersonas.length > 0) {
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            setSelectedIndex((prev) =>
              prev < filteredPersonas.length - 1 ? prev + 1 : 0
            );
            return;
          case 'ArrowUp':
            e.preventDefault();
            setSelectedIndex((prev) =>
              prev > 0 ? prev - 1 : filteredPersonas.length - 1
            );
            return;
          case 'Enter':
            e.preventDefault();
            handleSelectPersona(filteredPersonas[selectedIndex]);
            return;
          case 'Escape':
            e.preventDefault();
            setShowDropdown(false);
            setFilterText('');
            setMentionStartPos(null);
            return;
        }
      }

      // Submit on Enter without Shift (when dropdown is not open)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSubmit();
      }
    },
    [showDropdown, filteredPersonas, selectedIndex, handleSelectPersona, onSubmit]
  );

  return (
    <div className={styles.container}>
      {/* Mention dropdown -- positioned above the textarea */}
      {showDropdown && filteredPersonas.length > 0 && (
        <ul
          className={styles.dropdown}
          role="listbox"
          data-testid="mention-dropdown"
        >
          {filteredPersonas.map((persona, index) => (
            <li
              key={persona.id}
              className={`${styles.dropdownItem} ${
                index === selectedIndex ? styles.dropdownItemSelected : ''
              }`}
              role="option"
              aria-selected={index === selectedIndex}
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent textarea blur
                handleSelectPersona(persona);
              }}
              onMouseEnter={() => setSelectedIndex(index)}
              data-testid={`mention-option-${persona.id}`}
            >
              <span
                className={styles.colorDot}
                style={{ backgroundColor: persona.color }}
              />
              <span className={styles.personaName}>{persona.displayName}</span>
            </li>
          ))}
        </ul>
      )}

      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Type a message... Use @ to mention a persona"
        disabled={disabled}
        aria-label="Chat message input"
        data-testid="mention-input-textarea"
        rows={3}
      />
    </div>
  );
}
