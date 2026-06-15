/**
 * AddFragmentDrawer Component
 * Task Group 4: Drawer for creating and editing control flow fragments in sequence diagrams
 *
 * This drawer allows users to create or edit fragments (Loop, Optional, Alternative) with
 * appropriate operands.
 *
 * Features:
 * - Fields: fragmentKind dropdown (Loop/Optional/Alternative)
 * - Loop/Optional: single operand with guardExpression input
 * - Alternative: 2 operands by default, "+ Add Operand" button for additional branches
 * - On save: create SequenceFragment, SequenceOperand(s), and SequenceNode at correct position
 * - Edit mode: pre-populate form from editData, preserve IDs on update, reset operands on kind change
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  SequenceFragment,
  SequenceOperand,
  SequenceNode,
  FRAGMENT_KINDS,
  FragmentKind,
} from '../../../types/sequenceDiagram';
import styles from '../CreateAndPlaceDrawer.module.css';

// ============================================================================
// Types
// ============================================================================

/** Data provided when opening the drawer in edit mode */
export interface FragmentEditData {
  fragmentId: string;
  fragment: SequenceFragment;
  operands: SequenceOperand[];
  node: SequenceNode;
}

export interface AddFragmentDrawerProps {
  /** Whether the drawer is open */
  isOpen: boolean;
  /** Callback to close the drawer */
  onClose: () => void;
  /** Existing nodes (for order_index calculation) */
  existingNodes: SequenceNode[];
  /** Callback when fragment is submitted (add mode) */
  onSubmit: (fragment: SequenceFragment, operands: SequenceOperand[], node: SequenceNode) => void;
  /** Target operand ID for nested insertion */
  targetOperandId?: string;
  /** Target parent node ID for nested insertion */
  targetParentNodeId?: string;
  /** Optional edit data for edit mode */
  editData?: FragmentEditData | null;
  /** Optional callback for update mode (edit) */
  onUpdate?: (fragment: SequenceFragment, operands: SequenceOperand[], node: SequenceNode, removedOperandIds?: string[]) => void;
}

interface OperandData {
  id: string;
  guardExpression: string;
}

interface FormData {
  fragmentKind: FragmentKind | '';
  labelText: string;
  operands: OperandData[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate unique ID
 */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get next order_index for new nodes
 */
function getNextOrderIndex(
  nodes: SequenceNode[],
  parentNodeId?: string,
  parentOperandId?: string
): number {
  const siblings = nodes.filter(n =>
    n.parent_node_id === parentNodeId &&
    n.parent_operand_id === parentOperandId
  );

  if (siblings.length === 0) return 0;

  return Math.max(...siblings.map(s => s.order_index)) + 1;
}

/**
 * Get default operands for a fragment kind
 */
function getDefaultOperands(fragmentKind: FragmentKind | ''): OperandData[] {
  switch (fragmentKind) {
    case 'Loop':
      return [{ id: generateId('temp-op'), guardExpression: '' }];
    case 'Optional':
      return [{ id: generateId('temp-op'), guardExpression: '' }];
    case 'Alternative':
      return [
        { id: generateId('temp-op'), guardExpression: '' },
        { id: generateId('temp-op'), guardExpression: 'else' },
      ];
    default:
      return [];
  }
}

/**
 * Get hint text for operand based on fragment kind
 */
function getOperandHint(fragmentKind: FragmentKind | '', index: number): string {
  switch (fragmentKind) {
    case 'Loop':
      return 'Loop condition (e.g., "i < 10", "items.hasNext()")';
    case 'Optional':
      return 'Condition (e.g., "isValid", "user != null")';
    case 'Alternative':
      return index === 0
        ? 'Condition for first branch (e.g., "status == SUCCESS")'
        : 'Condition for alternative branch';
    default:
      return 'Guard expression';
  }
}

// ============================================================================
// AddFragmentDrawer Component
// ============================================================================

export function AddFragmentDrawer({
  isOpen,
  onClose,
  existingNodes,
  onSubmit,
  targetOperandId,
  targetParentNodeId,
  editData,
  onUpdate,
}: AddFragmentDrawerProps) {
  const [formData, setFormData] = useState<FormData>({
    fragmentKind: '',
    labelText: '',
    operands: [],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Track the original fragment_kind to detect changes during edit
  const originalFragmentKindRef = useRef<FragmentKind | ''>('');

  // Track whether this is the initial form population (to avoid the useEffect
  // that resets operands on fragmentKind change from overwriting edit data)
  const isInitialPopulationRef = useRef(false);

  const isEditMode = !!(editData);

  // Reset form when drawer opens
  useEffect(() => {
    if (isOpen) {
      setErrors({});
      setIsSubmitting(false);

      if (editData) {
        // Edit mode: populate from editData
        const editOperands: OperandData[] = editData.operands.map(op => ({
          id: op.id,
          guardExpression: op.guard_expression,
        }));

        isInitialPopulationRef.current = true;
        originalFragmentKindRef.current = editData.fragment.fragment_kind;

        setFormData({
          fragmentKind: editData.fragment.fragment_kind,
          labelText: editData.fragment.label_text || '',
          operands: editOperands,
        });
      } else {
        // Add mode: reset to empty
        originalFragmentKindRef.current = '';
        isInitialPopulationRef.current = false;

        setFormData({
          fragmentKind: '',
          labelText: '',
          operands: [],
        });
      }
    }
  }, [isOpen, editData]);

  // Update operands when fragment kind changes (only for non-initial changes)
  useEffect(() => {
    if (formData.fragmentKind) {
      if (isInitialPopulationRef.current) {
        // Skip resetting operands on the initial population from editData
        isInitialPopulationRef.current = false;
        return;
      }
      setFormData(prev => ({
        ...prev,
        operands: getDefaultOperands(prev.fragmentKind),
      }));
    }
  }, [formData.fragmentKind]);

  // Handle fragment kind change
  const handleFragmentKindChange = useCallback((kind: string) => {
    setFormData(prev => ({
      ...prev,
      fragmentKind: kind as FragmentKind | '',
      operands: getDefaultOperands(kind as FragmentKind | ''),
    }));
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors.fragmentKind;
      return newErrors;
    });
  }, []);

  // Handle label text change
  const handleLabelTextChange = useCallback((value: string) => {
    setFormData(prev => ({ ...prev, labelText: value }));
  }, []);

  // Handle operand guard expression change
  const handleOperandChange = useCallback((index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      operands: prev.operands.map((op, i) =>
        i === index ? { ...op, guardExpression: value } : op
      ),
    }));
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[`operand_${index}`];
      return newErrors;
    });
  }, []);

  // Add new operand (for Alternative fragments)
  const handleAddOperand = useCallback(() => {
    setFormData(prev => ({
      ...prev,
      operands: [...prev.operands, { id: generateId('temp-op'), guardExpression: '' }],
    }));
  }, []);

  // Remove operand (for Alternative fragments, keep minimum of 2)
  const handleRemoveOperand = useCallback((index: number) => {
    if (formData.operands.length <= 2) return; // Keep minimum of 2 for Alternative
    setFormData(prev => ({
      ...prev,
      operands: prev.operands.filter((_, i) => i !== index),
    }));
  }, [formData.operands.length]);

  // Validate form
  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.fragmentKind) {
      newErrors.fragmentKind = 'Fragment kind is required';
    }

    // Validate operands
    formData.operands.forEach((op, index) => {
      if (!op.guardExpression.trim()) {
        newErrors[`operand_${index}`] = 'Guard expression is required';
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  // Handle form submission
  const handleSubmit = useCallback(async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      if (isEditMode && editData && onUpdate) {
        // Edit mode submission
        const fragmentKindChanged = formData.fragmentKind !== originalFragmentKindRef.current;

        // Build updated fragment (always reuse existing fragment id)
        const fragment: SequenceFragment = {
          id: editData.fragment.id,
          fragment_kind: formData.fragmentKind as FragmentKind,
          label_text: formData.labelText.trim() || undefined,
        };

        let operands: SequenceOperand[];
        let removedOperandIds: string[] | undefined;

        if (fragmentKindChanged) {
          // Fragment kind changed: recreate operands with new IDs
          removedOperandIds = editData.operands.map(op => op.id);

          operands = formData.operands.map((op, index) => ({
            id: generateId('op'),
            fragment_id: editData.fragmentId,
            guard_expression: op.guardExpression,
            operand_index: index,
          }));
        } else {
          // Fragment kind did NOT change: reuse existing operand IDs
          operands = formData.operands.map((op, index) => ({
            id: op.id,
            fragment_id: editData.fragmentId,
            guard_expression: op.guardExpression,
            operand_index: index,
          }));
        }

        // Build updated node (reuse existing node properties)
        const node: SequenceNode = {
          id: editData.node.id,
          node_kind: 'Fragment',
          fragment_id: editData.fragmentId,
          order_index: editData.node.order_index,
          parent_node_id: editData.node.parent_node_id,
          parent_operand_id: editData.node.parent_operand_id,
        };

        onUpdate(fragment, operands, node, removedOperandIds);
      } else {
        // Add mode submission (original behavior)
        const fragmentId = generateId('frag');

        // Create fragment
        const fragment: SequenceFragment = {
          id: fragmentId,
          fragment_kind: formData.fragmentKind as FragmentKind,
          label_text: formData.labelText.trim() || undefined,
        };

        // Create operands
        const operands: SequenceOperand[] = formData.operands.map((op, index) => ({
          id: generateId('op'),
          fragment_id: fragmentId,
          guard_expression: op.guardExpression,
          operand_index: index,
        }));

        // Create node
        const orderIndex = getNextOrderIndex(existingNodes, targetParentNodeId, targetOperandId);
        const node: SequenceNode = {
          id: generateId('node'),
          node_kind: 'Fragment',
          fragment_id: fragmentId,
          order_index: orderIndex,
          parent_node_id: targetParentNodeId,
          parent_operand_id: targetOperandId,
        };

        onSubmit(fragment, operands, node);
      }
    } catch (error) {
      console.error('Failed to create fragment:', error);
      setErrors(prev => ({
        ...prev,
        _form: error instanceof Error ? error.message : 'Failed to create fragment',
      }));
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, validateForm, existingNodes, targetParentNodeId, targetOperandId, onSubmit, isEditMode, editData, onUpdate]);

  // Handle overlay click
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Handle keyboard events
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && e.ctrlKey) {
      handleSubmit();
    }
  }, [onClose, handleSubmit]);

  if (!isOpen) return null;

  // Determine title and button text based on mode
  const drawerTitle = isEditMode ? 'Edit Fragment' : 'Add Fragment';
  const submitButtonText = isEditMode
    ? (isSubmitting ? 'Updating...' : 'Update')
    : (isSubmitting ? 'Adding...' : 'Add Fragment');

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      data-testid="add-fragment-drawer"
    >
      <div className={`${styles.drawer} ${isSubmitting ? styles.loading : ''}`}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>{drawerTitle}</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            title="Close"
            data-testid="drawer-close-button"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          <div className={styles.form}>
            {/* Fragment Kind */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                Fragment Kind
                <span className={styles.required}>*</span>
              </label>
              <select
                className={`${styles.select} ${errors.fragmentKind ? styles.inputError : ''}`}
                value={formData.fragmentKind}
                onChange={(e) => handleFragmentKindChange(e.target.value)}
                data-testid="field-fragmentKind"
              >
                <option value="">-- Select --</option>
                {FRAGMENT_KINDS.map(kind => (
                  <option key={kind} value={kind}>{kind}</option>
                ))}
              </select>
              {errors.fragmentKind && (
                <span className={styles.errorMessage}>{errors.fragmentKind}</span>
              )}
              <span className={styles.hint}>
                Loop: Repeat while condition is true.
                Optional: Execute if condition is true.
                Alternative: Branch based on conditions.
              </span>
            </div>

            {/* Label Text (optional) */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Label (optional)</label>
              <input
                type="text"
                className={styles.input}
                value={formData.labelText}
                onChange={(e) => handleLabelTextChange(e.target.value)}
                placeholder="e.g., 'for each item', 'retry logic'"
                data-testid="field-labelText"
              />
              <span className={styles.hint}>
                Optional descriptive label displayed on the fragment
              </span>
            </div>

            {/* Operands Section */}
            {formData.fragmentKind && (
              <div className={styles.conditionalGroup}>
                <div className={styles.conditionalLabel}>
                  {formData.fragmentKind === 'Alternative' ? 'Branches' : 'Condition'}
                </div>

                {formData.operands.map((operand, index) => (
                  <div key={operand.id} className={styles.fieldGroup} style={{ marginBottom: '12px' }}>
                    <label className={styles.label}>
                      {formData.fragmentKind === 'Alternative'
                        ? `Branch ${index + 1} Guard`
                        : 'Guard Expression'}
                      <span className={styles.required}>*</span>
                    </label>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                      <input
                        type="text"
                        className={`${styles.input} ${errors[`operand_${index}`] ? styles.inputError : ''}`}
                        value={operand.guardExpression}
                        onChange={(e) => handleOperandChange(index, e.target.value)}
                        placeholder={getOperandHint(formData.fragmentKind, index)}
                        data-testid={`field-operand-${index}`}
                        style={{ flex: 1 }}
                      />
                      {formData.fragmentKind === 'Alternative' && formData.operands.length > 2 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveOperand(index)}
                          className={styles.secondaryButton}
                          style={{ padding: '8px 12px', minWidth: 'auto' }}
                          title="Remove branch"
                        >
                          x
                        </button>
                      )}
                    </div>
                    {errors[`operand_${index}`] && (
                      <span className={styles.errorMessage}>{errors[`operand_${index}`]}</span>
                    )}
                  </div>
                ))}

                {/* Add Operand Button (for Alternative) */}
                {formData.fragmentKind === 'Alternative' && (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={handleAddOperand}
                    data-testid="add-operand-button"
                    style={{ marginTop: '8px' }}
                  >
                    + Add Branch
                  </button>
                )}
              </div>
            )}
          </div>

          {errors._form && (
            <div className={styles.errorMessage} style={{ marginTop: 12 }}>
              {errors._form}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button
            className={styles.secondaryButton}
            onClick={onClose}
            disabled={isSubmitting}
            data-testid="drawer-cancel-button"
          >
            Cancel
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleSubmit}
            disabled={isSubmitting || !formData.fragmentKind}
            data-testid="drawer-submit-button"
          >
            {submitButtonText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AddFragmentDrawer;
