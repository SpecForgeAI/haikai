/**
 * EditActivityFlowConditionModal Component
 *
 * Task Group 4: Modal for editing activity flow conditions
 * Spec 2025-12-31: Activity Diagram UX Improvements - A3
 *
 * This modal appears after creating a new activity flow from a Decision node.
 * It allows the user to set condition fields on the flow:
 * - flow_kind: Control or Data flow type
 * - condition_ref_kind / condition_ref_id: Reference to a Method entity as guard
 * - condition_expression: Guard condition expression text
 *
 * The modal provides Save and Skip buttons:
 * - Save: Updates the ActivityFlow entity with condition fields
 * - Skip: Closes the modal without making any changes
 */

import React, { useState, useCallback, useEffect } from 'react';
import { ActivityFlow, GuardRefKind, ActivityFlowKind, MetaModel, Method } from '../../../types/model';
import styles from './EditActivityFlowConditionModal.module.css';

/**
 * Props for the EditActivityFlowConditionModal component
 */
export interface EditActivityFlowConditionModalProps {
  /** The ID of the ActivityFlow entity being edited */
  flowId: string;
  /** Whether the modal is open */
  isOpen: boolean;
  /** The current ActivityFlow entity (for initial values) */
  flow: ActivityFlow | null;
  /** The meta-model for entity lookups (e.g., Method entities) */
  metaModel: MetaModel | null;
  /** Callback when Save is clicked - receives the updated fields */
  onSave: (updates: Partial<ActivityFlow>) => void;
  /** Callback when Skip is clicked - closes modal without changes */
  onSkip: () => void;
}

/**
 * Flow kind options for the dropdown
 */
const FLOW_KIND_OPTIONS: { value: ActivityFlowKind; label: string }[] = [
  { value: 'Control', label: 'Control Flow' },
  { value: 'Data', label: 'Data Flow' },
];

/**
 * Guard reference kind options (currently only Method is supported)
 */
const CONDITION_REF_KIND_OPTIONS: { value: GuardRefKind | ''; label: string }[] = [
  { value: '', label: '(None)' },
  { value: 'Method', label: 'Method' },
];

/**
 * EditActivityFlowConditionModal Component
 *
 * Modal for editing condition fields on an ActivityFlow entity.
 */
export function EditActivityFlowConditionModal({
  flowId,
  isOpen,
  flow,
  metaModel,
  onSave,
  onSkip,
}: EditActivityFlowConditionModalProps) {
  // Form state
  const [flowKind, setFlowKind] = useState<ActivityFlowKind>('Control');
  const [conditionRefKind, setConditionRefKind] = useState<GuardRefKind | ''>('');
  const [conditionRefId, setConditionRefId] = useState<string>('');
  const [conditionExpression, setConditionExpression] = useState<string>('');

  // Initialize form state from flow when modal opens
  useEffect(() => {
    if (isOpen && flow) {
      setFlowKind(flow.flow_kind || 'Control');
      setConditionRefKind(flow.condition_ref_kind || '');
      setConditionRefId(flow.condition_ref_id || '');
      setConditionExpression(flow.condition_expression || '');
    }
  }, [isOpen, flow]);

  // Get Method entities for the condition reference dropdown
  const methods: Method[] = metaModel?.entities?.methods || [];

  // Handle flow kind change
  const handleFlowKindChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setFlowKind(e.target.value as ActivityFlowKind);
  }, []);

  // Handle condition ref kind change
  const handleConditionRefKindChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as GuardRefKind | '';
    setConditionRefKind(value);
    // Clear ref ID when kind changes
    if (value === '') {
      setConditionRefId('');
    }
  }, []);

  // Handle condition ref ID change
  const handleConditionRefIdChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setConditionRefId(e.target.value);
  }, []);

  // Handle condition expression change
  const handleConditionExpressionChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setConditionExpression(e.target.value);
  }, []);

  // Handle Save button click
  const handleSave = useCallback(() => {
    const updates: Partial<ActivityFlow> = {
      flow_kind: flowKind,
    };

    // Only set condition ref fields if kind is selected
    if (conditionRefKind) {
      updates.condition_ref_kind = conditionRefKind;
      updates.condition_ref_id = conditionRefId || undefined;
    } else {
      updates.condition_ref_kind = undefined;
      updates.condition_ref_id = undefined;
    }

    // Only set condition expression if it has content
    if (conditionExpression.trim()) {
      updates.condition_expression = conditionExpression.trim();
    } else {
      updates.condition_expression = undefined;
    }

    onSave(updates);
  }, [flowKind, conditionRefKind, conditionRefId, conditionExpression, onSave]);

  // Handle Skip button click
  const handleSkip = useCallback(() => {
    onSkip();
  }, [onSkip]);

  // Handle overlay click (close on click outside)
  const handleOverlayClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the overlay itself, not the modal content
    if (e.target === e.currentTarget) {
      onSkip();
    }
  }, [onSkip]);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onSkip();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, onSkip]);

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Decision Flow Condition</h2>
          <button className={styles.closeButton} onClick={handleSkip} title="Close">
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          <div className={styles.form}>
            {/* Flow Kind */}
            <div className={styles.formGroup}>
              <label className={styles.label}>
                Flow Type
                <span className={styles.labelHint}>(Control or Data flow)</span>
              </label>
              <select
                className={styles.select}
                value={flowKind}
                onChange={handleFlowKindChange}
              >
                {FLOW_KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.divider} />

            {/* Section: Guard Condition */}
            <div className={styles.sectionTitle}>Guard Condition</div>

            {/* Condition Reference (Kind + ID) */}
            <div className={styles.refFieldsRow}>
              <div className={styles.refFieldGroup}>
                <label className={styles.label}>Condition Type</label>
                <select
                  className={styles.select}
                  value={conditionRefKind}
                  onChange={handleConditionRefKindChange}
                >
                  {CONDITION_REF_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.refFieldGroup}>
                <label className={styles.label}>Method Reference</label>
                <select
                  className={styles.select}
                  value={conditionRefId}
                  onChange={handleConditionRefIdChange}
                  disabled={conditionRefKind !== 'Method'}
                >
                  <option value="">(Select Method)</option>
                  {methods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Condition Expression */}
            <div className={styles.formGroup}>
              <label className={styles.label}>
                Condition Expression
                <span className={styles.labelHint}>(e.g., [amount {'>'} 1000])</span>
              </label>
              <textarea
                className={styles.textarea}
                value={conditionExpression}
                onChange={handleConditionExpressionChange}
                placeholder="Enter guard condition expression..."
              />
            </div>
          </div>
        </div>

        {/* Footer with action buttons */}
        <div className={styles.footer}>
          <button className={styles.skipButton} onClick={handleSkip}>
            Skip
          </button>
          <button className={styles.saveButton} onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Helper function to check if an activity is a Decision type.
 * Used to determine if the condition modal should open after flow creation.
 *
 * @param activityKind - The activity kind to check
 * @returns true if the activity is a Decision type
 */
export function isDecisionActivityKind(activityKind: string | undefined): boolean {
  return activityKind === 'Decision';
}
