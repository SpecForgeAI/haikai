/**
 * AddParticipantDrawer Component
 * Task Group 3: Drawer for adding new participants to a Sequence diagram
 * Task Group 2: Extended with edit mode support
 *
 * This component provides a form-based drawer for adding or editing participants.
 * It follows the same pattern as CreateAndPlaceDrawer.tsx.
 *
 * Features:
 * - refKind dropdown (PARTICIPANT_REF_KINDS from sequenceDiagram.ts)
 * - refId selector populated based on selected refKind
 * - Validation: both refKind and refId required
 * - Add mode: calls onSubmit callback with refKind and refId
 * - Edit mode: pre-populates from editData, calls onUpdate callback with (participantId, refKind, refId)
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { MetaModel } from '../../../types/model';
import { ParticipantRefKind, PARTICIPANT_REF_KINDS } from '../../../types/sequenceDiagram';
import { getParticipantReferenceOptions } from '../../../utils/sequenceDiagramUtils';
import drawerStyles from '../CreateAndPlaceDrawer.module.css';

/**
 * Edit data for populating the drawer in edit mode
 */
export interface ParticipantEditData {
  participantId: string;
  refKind: ParticipantRefKind;
  refId: string;
}

/**
 * Props for the AddParticipantDrawer component
 */
export interface AddParticipantDrawerProps {
  /** Whether the drawer is open */
  isOpen: boolean;
  /** Callback to close the drawer */
  onClose: () => void;
  /** Callback when a participant is submitted (add mode) */
  onSubmit: (refKind: ParticipantRefKind, refId: string) => void;
  /** The meta-model for populating reference options */
  metaModel: MetaModel | null;
  /** Optional edit data for edit mode -- when provided, drawer opens in edit mode */
  editData?: ParticipantEditData | null;
  /** Optional callback when a participant is updated (edit mode) */
  onUpdate?: (participantId: string, refKind: ParticipantRefKind, refId: string) => void;
}

/**
 * AddParticipantDrawer - Drawer for adding or editing participants in a sequence diagram
 */
export function AddParticipantDrawer({
  isOpen,
  onClose,
  onSubmit,
  metaModel,
  editData,
  onUpdate,
}: AddParticipantDrawerProps) {
  // Form state
  const [refKind, setRefKind] = useState<string>('');
  const [refId, setRefId] = useState<string>('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Determine if we are in edit mode
  const isEditMode = !!editData;

  // Get reference options based on selected refKind
  const referenceOptions = useMemo(() => {
    if (!refKind) return [];
    return getParticipantReferenceOptions(refKind, metaModel);
  }, [refKind, metaModel]);

  // Reset form when drawer opens: populate from editData if present, otherwise clear
  useEffect(() => {
    if (isOpen) {
      if (editData) {
        setRefKind(editData.refKind);
        setRefId(editData.refId);
      } else {
        setRefKind('');
        setRefId('');
      }
      setErrors({});
    }
  }, [isOpen, editData]);

  // Clear refId when refKind changes -- but only when the user explicitly changes refKind
  // We use a ref to track whether this is the initial population from editData
  const [isInitializing, setIsInitializing] = useState(false);

  useEffect(() => {
    if (isOpen && editData) {
      setIsInitializing(true);
    }
  }, [isOpen, editData]);

  // Handle refKind change
  const handleRefKindChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newRefKind = e.target.value;
    setRefKind(newRefKind);
    // Clear refId when user changes refKind (not during initial edit population)
    setRefId('');
    setIsInitializing(false);
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors.refKind;
      return newErrors;
    });
  }, []);

  // Handle refId change
  const handleRefIdChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setRefId(e.target.value);
    setIsInitializing(false);
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors.refId;
      return newErrors;
    });
  }, []);

  // Validate form
  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!refKind || refKind.trim() === '') {
      newErrors.refKind = 'Reference Kind is required';
    }

    if (!refId || refId.trim() === '') {
      newErrors.refId = 'Reference is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [refKind, refId]);

  // Handle form submission
  const handleSubmit = useCallback(() => {
    if (!validateForm()) {
      return;
    }

    if (isEditMode && onUpdate && editData) {
      onUpdate(editData.participantId, refKind as ParticipantRefKind, refId);
    } else {
      onSubmit(refKind as ParticipantRefKind, refId);
    }
  }, [validateForm, isEditMode, onUpdate, editData, onSubmit, refKind, refId]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  // Handle overlay click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter' && e.ctrlKey) {
        handleSubmit();
      }
    },
    [onClose, handleSubmit]
  );

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  // Determine title and button text based on mode
  const title = isEditMode ? 'Edit Participant' : 'Add Participant';
  const submitButtonText = isEditMode ? 'Update' : 'Add Participant';

  return (
    <div
      className={drawerStyles.overlay}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      data-testid="add-participant-drawer"
    >
      <div className={drawerStyles.drawer}>
        {/* Header */}
        <div className={drawerStyles.header}>
          <h2 className={drawerStyles.title}>{title}</h2>
          <button
            className={drawerStyles.closeButton}
            onClick={handleCancel}
            title="Close"
            data-testid="drawer-close-button"
          >
            &times;
          </button>
        </div>

        {/* Content - Form */}
        <div className={drawerStyles.content}>
          <div className={drawerStyles.form}>
            {/* Reference Kind Dropdown */}
            <div className={drawerStyles.fieldGroup}>
              <label className={drawerStyles.label}>
                Reference Kind
                <span className={drawerStyles.required}>*</span>
              </label>
              <select
                className={`${drawerStyles.select} ${errors.refKind ? drawerStyles.inputError : ''}`}
                value={refKind}
                onChange={handleRefKindChange}
                data-testid="field-refKind"
              >
                <option value="">-- Select Kind --</option>
                {PARTICIPANT_REF_KINDS.map(kind => (
                  <option key={kind} value={kind}>
                    {formatRefKindLabel(kind)}
                  </option>
                ))}
              </select>
              {errors.refKind && (
                <span className={drawerStyles.errorMessage}>{errors.refKind}</span>
              )}
              <span className={drawerStyles.hint}>
                Select the type of entity this participant represents
              </span>
            </div>

            {/* Reference ID Dropdown (only visible when refKind is selected) */}
            {refKind && (
              <div className={drawerStyles.fieldGroup}>
                <label className={drawerStyles.label}>
                  Reference
                  <span className={drawerStyles.required}>*</span>
                </label>
                <select
                  className={`${drawerStyles.select} ${errors.refId ? drawerStyles.inputError : ''}`}
                  value={refId}
                  onChange={handleRefIdChange}
                  data-testid="field-refId"
                >
                  <option value="">-- Select Entity --</option>
                  {referenceOptions.map(option => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                {errors.refId && (
                  <span className={drawerStyles.errorMessage}>{errors.refId}</span>
                )}
                {referenceOptions.length === 0 && (
                  <span className={drawerStyles.hint}>
                    No {formatRefKindLabel(refKind as ParticipantRefKind).toLowerCase()} entities available
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer - Action Buttons */}
        <div className={drawerStyles.footer}>
          <button
            className={drawerStyles.secondaryButton}
            onClick={handleCancel}
            data-testid="drawer-cancel-button"
          >
            Cancel
          </button>
          <button
            className={drawerStyles.primaryButton}
            onClick={handleSubmit}
            disabled={!refKind || !refId}
            data-testid="drawer-submit-button"
          >
            {submitButtonText}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Formats a ParticipantRefKind value for display in the UI.
 * Converts PascalCase to spaced words.
 */
function formatRefKindLabel(refKind: ParticipantRefKind): string {
  switch (refKind) {
    case 'BusinessUser':
      return 'Business User';
    case 'Application':
      return 'Application';
    case 'ApplicationComponent':
      return 'Application Component';
    case 'Service':
      return 'Service';
    case 'Interface':
      return 'Interface';
    case 'InterfaceEndpoint':
      return 'Interface Endpoint';
    case 'Class':
      return 'Class';
    default:
      return refKind;
  }
}

export default AddParticipantDrawer;
