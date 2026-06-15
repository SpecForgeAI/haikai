/**
 * AddMessageExchangeDrawer Component
 * Task Group 4: Drawer for creating message exchanges in sequence diagrams
 * Task Group 3: Extended with edit mode support (editData, onUpdate)
 *
 * This drawer allows users to create or edit a message exchange consisting of:
 * - A request message (required)
 * - An optional response message
 *
 * Features:
 * - Fields: fromParticipant dropdown, toParticipant dropdown
 * - Request content: toggle between "Reference" (refKind/refId) and "Label" (labelText)
 * - Response content: optional, same toggle pattern
 * - On save: create 2 SequenceMessage records with shared exchangeId, create 2 SequenceNode records
 * - Reuses FieldConfig pattern from CreateAndPlaceDrawer.tsx
 * - Self-message support: allows From === To, disables response for self-messages
 * - Collection flag support: "Is Collection?" checkbox for PhysicalEntity/LogicalEntity references
 * - "What to Show?" checkbox group for InterfaceEndpoint references
 * - "Endpoint Response" radio option for InterfaceEndpoint response messages
 * - Edit mode: when editData is provided, pre-populates form and preserves existing IDs on submit
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  SequenceParticipant,
  SequenceMessage,
  SequenceNode,
  MESSAGE_REF_KINDS,
  MessageRefKind,
} from '../../../types/sequenceDiagram';
import { MetaModel } from '../../../types/model';
import styles from '../CreateAndPlaceDrawer.module.css';

// ============================================================================
// Types
// ============================================================================

/**
 * Data needed to populate the drawer in edit mode for an existing message exchange.
 */
export interface MessageExchangeEditData {
  /** The exchange_id shared by request and response messages */
  exchangeId: string;
  /** The request message to edit */
  requestMessage: SequenceMessage;
  /** The optional response message to edit */
  responseMessage?: SequenceMessage;
  /** The request node to edit */
  requestNode: SequenceNode;
  /** The optional response node to edit */
  responseNode?: SequenceNode;
}

export interface AddMessageExchangeDrawerProps {
  /** Whether the drawer is open */
  isOpen: boolean;
  /** Callback to close the drawer */
  onClose: () => void;
  /** Available participants for from/to selection */
  participants: SequenceParticipant[];
  /** Existing nodes (for order_index calculation) */
  existingNodes: SequenceNode[];
  /** Optional meta model for entity lookups */
  metaModel?: MetaModel | null;
  /** Callback when message exchange is submitted (add mode) */
  onSubmit: (messages: SequenceMessage[], nodes: SequenceNode[]) => void;
  /** Target operand ID for nested insertion */
  targetOperandId?: string;
  /** Target parent node ID for nested insertion */
  targetParentNodeId?: string;
  /** Optional edit data for edit mode */
  editData?: MessageExchangeEditData | null;
  /** Callback when message exchange is updated (edit mode) */
  onUpdate?: (
    messages: SequenceMessage[],
    nodes: SequenceNode[],
    removedMessageIds?: string[],
    removedNodeIds?: string[]
  ) => void;
}

type ContentMode = 'reference' | 'label';
type ResponseContentMode = 'label' | 'reference' | 'endpoint_response';

export interface FormData {
  fromParticipantId: string;
  toParticipantId: string;
  requestMode: ContentMode;
  requestRefKind: string;
  requestRefId: string;
  requestLabelText: string;
  requestIsCollection: boolean;
  showEndpointName: boolean;
  showEndpointVerbPath: boolean;
  showEndpointReqResData: boolean;
  includeResponse: boolean;
  responseContentMode: ResponseContentMode;
  responseRefKind: string;
  responseRefId: string;
  responseLabelText: string;
  responseIsCollection: boolean;
  responseShowEndpointName: boolean;
  responseShowEndpointVerbPath: boolean;
  responseShowEndpointReqResData: boolean;
}

export const INITIAL_FORM_DATA: FormData = {
  fromParticipantId: '',
  toParticipantId: '',
  requestMode: 'label',
  requestRefKind: '',
  requestRefId: '',
  requestLabelText: '',
  requestIsCollection: false,
  showEndpointName: false,
  showEndpointVerbPath: true,
  showEndpointReqResData: true,
  includeResponse: false,
  responseContentMode: 'label',
  responseRefKind: '',
  responseRefId: '',
  responseLabelText: '',
  responseIsCollection: false,
  responseShowEndpointName: false,
  responseShowEndpointVerbPath: false,
  responseShowEndpointReqResData: true,
};

// ============================================================================
// Helper Constants and Functions
// ============================================================================

/**
 * MessageRefKind values that support the "Is Collection?" checkbox.
 * Only data entities can be collections.
 */
const ENTITY_REF_KINDS_SUPPORTING_COLLECTION: MessageRefKind[] = [
  'PhysicalEntity',
  'LogicalEntity',
];

/**
 * Checks if a ref_kind supports the collection flag.
 */
function supportsCollectionFlag(refKind: string | undefined): boolean {
  return ENTITY_REF_KINDS_SUPPORTING_COLLECTION.includes(refKind as MessageRefKind);
}

/**
 * Get participant label for display in dropdown
 */
function getParticipantDisplayLabel(
  participant: SequenceParticipant,
  metaModel?: MetaModel | null
): string {
  if (!metaModel) {
    return `${participant.ref_kind}`;
  }

  const refKind = participant.ref_kind;
  const refId = participant.ref_id;

  switch (refKind) {
    case 'BusinessUser':
      return metaModel.entities.business_users.find(e => e.id === refId)?.name || refKind;
    case 'Application':
      return metaModel.entities.applications.find(e => e.id === refId)?.name || refKind;
    case 'ApplicationComponent':
      return metaModel.entities.app_components.find(e => e.id === refId)?.name || refKind;
    case 'Service':
      return metaModel.entities.services.find(e => e.id === refId)?.name || refKind;
    case 'Interface':
      return metaModel.entities.interfaces.find(e => e.id === refId)?.name || refKind;
    case 'InterfaceEndpoint':
      return metaModel.entities.endpoints.find(e => e.id === refId)?.name || refKind;
    case 'Class':
      return metaModel.entities.classes?.find(e => e.id === refId)?.name || refKind;
    default:
      return refKind;
  }
}

/**
 * Get reference options based on refKind
 */
function getReferenceOptions(
  refKind: string,
  metaModel?: MetaModel | null
): Array<{ id: string; name: string }> {
  if (!metaModel || !refKind) return [];

  switch (refKind) {
    case 'Method':
      return (metaModel.entities.methods || []).map(m => ({ id: m.id, name: m.name }));
    case 'LogicalEntity':
      return metaModel.entities.logical_data_entities.map(e => ({ id: e.id, name: e.name }));
    case 'PhysicalEntity':
      return metaModel.entities.physical_data_entities.map(e => ({ id: e.id, name: e.name }));
    case 'Class':
      return (metaModel.entities.classes || []).map(c => ({ id: c.id, name: c.name }));
    case 'Event':
      return (metaModel.entities.events || []).map(e => ({ id: e.id, name: e.name }));
    case 'Interface':
      return (metaModel.entities.interfaces || []).map(i => ({ id: i.id, name: i.name }));
    case 'InterfaceEndpoint':
      return (metaModel.entities.endpoints || []).map(e => ({ id: e.id, name: e.name }));
    default:
      return [];
  }
}

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
 * Build FormData from editData for pre-populating the form in edit mode.
 */
function buildFormDataFromEditData(editData: MessageExchangeEditData): FormData {
  const { requestMessage, responseMessage } = editData;

  // Derive request mode: reference if ref_kind is set, otherwise label
  const requestMode: ContentMode = requestMessage.ref_kind ? 'reference' : 'label';

  // Derive response content mode
  let responseContentMode: ResponseContentMode = 'label';
  if (responseMessage) {
    if (responseMessage.response_mode === 'endpoint_response') {
      responseContentMode = 'endpoint_response';
    } else if (responseMessage.ref_kind) {
      responseContentMode = 'reference';
    } else {
      responseContentMode = 'label';
    }
  }

  return {
    fromParticipantId: requestMessage.from_participant_id,
    toParticipantId: requestMessage.to_participant_id,
    requestMode,
    requestRefKind: requestMessage.ref_kind || '',
    requestRefId: requestMessage.ref_id || '',
    requestLabelText: requestMessage.label_text || '',
    requestIsCollection: requestMessage.is_collection || false,
    showEndpointName: requestMessage.show_endpoint_name || false,
    showEndpointVerbPath: requestMessage.show_endpoint_verb_path ?? true,
    showEndpointReqResData: requestMessage.show_endpoint_req_res_data ?? true,
    includeResponse: !!responseMessage,
    responseContentMode,
    responseRefKind: responseMessage?.ref_kind || '',
    responseRefId: responseMessage?.ref_id || '',
    responseLabelText: responseMessage?.label_text || '',
    responseIsCollection: responseMessage?.is_collection || false,
    responseShowEndpointName: responseMessage?.show_endpoint_name || false,
    responseShowEndpointVerbPath: responseMessage?.show_endpoint_verb_path || false,
    responseShowEndpointReqResData: responseMessage?.show_endpoint_req_res_data ?? true,
  };
}

// ============================================================================
// AddMessageExchangeDrawer Component
// ============================================================================

export function AddMessageExchangeDrawer({
  isOpen,
  onClose,
  participants,
  existingNodes,
  metaModel,
  onSubmit,
  targetOperandId,
  targetParentNodeId,
  editData,
  onUpdate,
}: AddMessageExchangeDrawerProps) {
  const [formData, setFormData] = useState<FormData>(INITIAL_FORM_DATA);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Determine if we are in edit mode
  const isEditMode = !!editData;

  // Reference options based on selected refKind
  const requestRefOptions = useMemo(() =>
    getReferenceOptions(formData.requestRefKind, metaModel),
    [formData.requestRefKind, metaModel]
  );

  const responseRefOptions = useMemo(() =>
    getReferenceOptions(formData.responseRefKind, metaModel),
    [formData.responseRefKind, metaModel]
  );

  // Task 1.3: Detect if this is a self-message (from === to)
  const isSelfMessage = useMemo(() => {
    return (
      formData.fromParticipantId !== '' &&
      formData.toParticipantId !== '' &&
      formData.fromParticipantId === formData.toParticipantId
    );
  }, [formData.fromParticipantId, formData.toParticipantId]);

  // Computed visibility for request collection checkbox
  const showRequestIsCollectionCheckbox = useMemo(() => {
    return formData.requestMode === 'reference' &&
           supportsCollectionFlag(formData.requestRefKind);
  }, [formData.requestMode, formData.requestRefKind]);

  // Computed visibility for response collection checkbox
  const showResponseIsCollectionCheckbox = useMemo(() => {
    return formData.includeResponse &&
           formData.responseContentMode === 'reference' &&
           supportsCollectionFlag(formData.responseRefKind);
  }, [formData.includeResponse, formData.responseContentMode, formData.responseRefKind]);

  // Computed visibility for "What to Show?" checkbox group
  const showWhatToShowCheckboxes = useMemo(() => {
    return formData.requestMode === 'reference' &&
           formData.requestRefKind === 'InterfaceEndpoint';
  }, [formData.requestMode, formData.requestRefKind]);

  // Computed: is request referencing an InterfaceEndpoint?
  const requestRefsInterfaceEndpoint = useMemo(() => {
    return formData.requestMode === 'reference' &&
           formData.requestRefKind === 'InterfaceEndpoint';
  }, [formData.requestMode, formData.requestRefKind]);

  // Computed visibility for "Endpoint Response" radio option
  const showEndpointResponseOption = useMemo(() => {
    return requestRefsInterfaceEndpoint && formData.includeResponse;
  }, [requestRefsInterfaceEndpoint, formData.includeResponse]);

  // Computed visibility for response "What to Show?" checkbox group
  const showResponseWhatToShowCheckboxes = useMemo(() => {
    return formData.includeResponse &&
           formData.responseContentMode === 'endpoint_response';
  }, [formData.includeResponse, formData.responseContentMode]);

  // Reset form when drawer opens: populate from editData if present, otherwise use INITIAL_FORM_DATA
  useEffect(() => {
    if (isOpen) {
      if (editData) {
        // Edit mode: build form data from editData
        setFormData(buildFormDataFromEditData(editData));
      } else {
        // Add mode: reset to initial form data
        setFormData(INITIAL_FORM_DATA);
      }
      setErrors({});
      setIsSubmitting(false);
    }
  }, [isOpen, editData]);

  // Task 1.4: When self-message is detected, disable response
  useEffect(() => {
    if (isSelfMessage && formData.includeResponse) {
      setFormData(prev => ({ ...prev, includeResponse: false }));
    }
  }, [isSelfMessage]);

  // Handle field change with reset logic for collection flags
  const handleFieldChange = useCallback((field: keyof FormData, value: string | boolean) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };

      // Clear refId when refKind changes and reset isCollection if new refKind doesn't support it
      if (field === 'requestRefKind') {
        next.requestRefId = '';
        if (!supportsCollectionFlag(value as string)) {
          next.requestIsCollection = false;
        }
        // Reset endpoint show flags when changing away from InterfaceEndpoint
        if (value !== 'InterfaceEndpoint') {
          next.showEndpointName = false;
          next.showEndpointVerbPath = true;
          next.showEndpointReqResData = true;
          next.responseShowEndpointName = false;
          next.responseShowEndpointVerbPath = false;
          next.responseShowEndpointReqResData = true;
          // Reset response content mode if it was endpoint_response
          if (next.responseContentMode === 'endpoint_response') {
            next.responseContentMode = 'label';
          }
        }
      }
      if (field === 'responseRefKind') {
        next.responseRefId = '';
        if (!supportsCollectionFlag(value as string)) {
          next.responseIsCollection = false;
        }
      }
      // Reset isCollection when switching to label mode
      if (field === 'requestMode' && value === 'label') {
        next.requestIsCollection = false;
        // Reset endpoint response mode when switching request away from reference
        if (next.responseContentMode === 'endpoint_response') {
          next.responseContentMode = 'label';
        }
      }
      if (field === 'responseContentMode' && value === 'label') {
        next.responseIsCollection = false;
      }

      return next;
    });

    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[field];
      return newErrors;
    });
  }, []);

  // Validate form
  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    // Validate participants
    if (!formData.fromParticipantId) {
      newErrors.fromParticipantId = 'From participant is required';
    }
    if (!formData.toParticipantId) {
      newErrors.toParticipantId = 'To participant is required';
    }

    // Validate request content
    if (formData.requestMode === 'reference') {
      if (!formData.requestRefKind) {
        newErrors.requestRefKind = 'Reference type is required';
      }
      if (!formData.requestRefId) {
        newErrors.requestRefId = 'Reference is required';
      }
      // Validate "What to Show?" - at least one must be checked for InterfaceEndpoint
      if (formData.requestRefKind === 'InterfaceEndpoint') {
        if (!formData.showEndpointName && !formData.showEndpointVerbPath && !formData.showEndpointReqResData) {
          newErrors.whatToShow = 'Choose at least one thing to show';
        }
      }
    } else {
      if (!formData.requestLabelText.trim()) {
        newErrors.requestLabelText = 'Label text is required';
      }
    }

    // Validate response content (if included)
    if (formData.includeResponse && formData.responseContentMode !== 'endpoint_response') {
      if (formData.responseContentMode === 'reference') {
        if (!formData.responseRefKind) {
          newErrors.responseRefKind = 'Reference type is required';
        }
        if (!formData.responseRefId) {
          newErrors.responseRefId = 'Reference is required';
        }
      } else {
        if (!formData.responseLabelText.trim()) {
          newErrors.responseLabelText = 'Label text is required';
        }
      }
    }

    // Validate response "What to Show?" - at least one must be checked for endpoint_response mode
    if (formData.includeResponse && formData.responseContentMode === 'endpoint_response') {
      if (!formData.responseShowEndpointName && !formData.responseShowEndpointVerbPath && !formData.responseShowEndpointReqResData) {
        newErrors.responseWhatToShow = 'Choose at least one thing to show';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  // Handle form submission
  const handleSubmit = useCallback(async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      // Build endpoint show flags for InterfaceEndpoint references
      const isEndpointRef = formData.requestMode === 'reference' && formData.requestRefKind === 'InterfaceEndpoint';

      if (isEditMode && editData && onUpdate) {
        // ====================================================================
        // EDIT MODE: update existing messages and nodes, preserving IDs
        // ====================================================================
        const messages: SequenceMessage[] = [];
        const nodes: SequenceNode[] = [];
        let removedMessageIds: string[] | undefined;
        let removedNodeIds: string[] | undefined;

        // Build updated request message reusing existing IDs
        const requestMessage: SequenceMessage = {
          id: editData.requestMessage.id,
          exchange_id: editData.exchangeId,
          exchange_role: 'Request',
          from_participant_id: formData.fromParticipantId,
          to_participant_id: formData.toParticipantId,
          ...(formData.requestMode === 'reference' ? {
            ref_kind: formData.requestRefKind as MessageRefKind,
            ref_id: formData.requestRefId,
            ...(formData.requestIsCollection && supportsCollectionFlag(formData.requestRefKind) ? {
              is_collection: true,
            } : {}),
            ...(isEndpointRef ? {
              show_endpoint_name: formData.showEndpointName,
              show_endpoint_verb_path: formData.showEndpointVerbPath,
              show_endpoint_req_res_data: formData.showEndpointReqResData,
            } : {}),
          } : {
            label_text: formData.requestLabelText,
          }),
        };
        messages.push(requestMessage);

        // Build updated request node reusing existing ID and preserving structural fields
        const requestNode: SequenceNode = {
          id: editData.requestNode.id,
          node_kind: 'Message',
          message_id: editData.requestMessage.id,
          order_index: editData.requestNode.order_index,
          parent_node_id: editData.requestNode.parent_node_id,
          parent_operand_id: editData.requestNode.parent_operand_id,
        };
        nodes.push(requestNode);

        // Handle response
        if (formData.includeResponse) {
          if (editData.responseMessage && editData.responseNode) {
            // Response existed and still exists: update in place with existing IDs
            const responseMessage = buildResponseMessage(
              editData.responseMessage.id,
              editData.exchangeId,
              formData,
              isEndpointRef
            );
            messages.push(responseMessage);

            const responseNode: SequenceNode = {
              id: editData.responseNode.id,
              node_kind: 'Message',
              message_id: editData.responseMessage.id,
              order_index: editData.responseNode.order_index,
              parent_node_id: editData.responseNode.parent_node_id,
              parent_operand_id: editData.responseNode.parent_operand_id,
            };
            nodes.push(responseNode);
          } else {
            // Response did NOT exist before: create new response with generated IDs
            const newResponseMessageId = generateId('msg');
            const responseMessage = buildResponseMessage(
              newResponseMessageId,
              editData.exchangeId,
              formData,
              isEndpointRef
            );
            messages.push(responseMessage);

            const newResponseNodeId = generateId('node');
            const responseNode: SequenceNode = {
              id: newResponseNodeId,
              node_kind: 'Message',
              message_id: newResponseMessageId,
              order_index: editData.requestNode.order_index + 1,
              parent_node_id: editData.requestNode.parent_node_id,
              parent_operand_id: editData.requestNode.parent_operand_id,
            };
            nodes.push(responseNode);
          }
        } else {
          // includeResponse is false
          if (editData.responseMessage && editData.responseNode) {
            // Response existed but user toggled it off: mark for removal
            removedMessageIds = [editData.responseMessage.id];
            removedNodeIds = [editData.responseNode.id];
          }
        }

        onUpdate(messages, nodes, removedMessageIds, removedNodeIds);
      } else {
        // ====================================================================
        // ADD MODE: create new messages and nodes (original behavior)
        // ====================================================================
        const exchangeId = generateId('exchange');
        const messages: SequenceMessage[] = [];
        const nodes: SequenceNode[] = [];

        const baseOrderIndex = getNextOrderIndex(existingNodes, targetParentNodeId, targetOperandId);

        // Create request message
        const requestMessageId = generateId('msg');
        const requestMessage: SequenceMessage = {
          id: requestMessageId,
          exchange_id: exchangeId,
          exchange_role: 'Request',
          from_participant_id: formData.fromParticipantId,
          to_participant_id: formData.toParticipantId,
          ...(formData.requestMode === 'reference' ? {
            ref_kind: formData.requestRefKind as MessageRefKind,
            ref_id: formData.requestRefId,
            ...(formData.requestIsCollection && supportsCollectionFlag(formData.requestRefKind) ? {
              is_collection: true,
            } : {}),
            ...(isEndpointRef ? {
              show_endpoint_name: formData.showEndpointName,
              show_endpoint_verb_path: formData.showEndpointVerbPath,
              show_endpoint_req_res_data: formData.showEndpointReqResData,
            } : {}),
          } : {
            label_text: formData.requestLabelText,
          }),
        };
        messages.push(requestMessage);

        // Create request node
        const requestNodeId = generateId('node');
        const requestNode: SequenceNode = {
          id: requestNodeId,
          node_kind: 'Message',
          message_id: requestMessageId,
          order_index: baseOrderIndex,
          parent_node_id: targetParentNodeId,
          parent_operand_id: targetOperandId,
        };
        nodes.push(requestNode);

        // Create response if included
        if (formData.includeResponse) {
          const responseMessageId = generateId('msg');
          const responseMessage = buildResponseMessage(
            responseMessageId,
            exchangeId,
            formData,
            isEndpointRef
          );
          messages.push(responseMessage);

          // Create response node
          const responseNodeId = generateId('node');
          const responseNode: SequenceNode = {
            id: responseNodeId,
            node_kind: 'Message',
            message_id: responseMessageId,
            order_index: baseOrderIndex + 1,
            parent_node_id: targetParentNodeId,
            parent_operand_id: targetOperandId,
          };
          nodes.push(responseNode);
        }

        onSubmit(messages, nodes);
      }
    } catch (error) {
      console.error('Failed to save message exchange:', error);
      setErrors(prev => ({
        ...prev,
        _form: error instanceof Error ? error.message : 'Failed to save message exchange',
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
  const drawerTitle = isEditMode ? 'Edit Message Exchange' : 'Add Message Exchange';
  const submitButtonText = isEditMode
    ? (isSubmitting ? 'Updating...' : 'Update')
    : (isSubmitting ? 'Adding...' : 'Add Message Exchange');

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      data-testid="add-message-exchange-drawer"
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
            {/* From Participant */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                From Participant
                <span className={styles.required}>*</span>
              </label>
              <select
                className={`${styles.select} ${errors.fromParticipantId ? styles.inputError : ''}`}
                value={formData.fromParticipantId}
                onChange={(e) => handleFieldChange('fromParticipantId', e.target.value)}
                data-testid="field-fromParticipant"
              >
                <option value="">-- Select --</option>
                {participants.map(p => (
                  <option key={p.id} value={p.id}>
                    {getParticipantDisplayLabel(p, metaModel)}
                  </option>
                ))}
              </select>
              {errors.fromParticipantId && (
                <span className={styles.errorMessage}>{errors.fromParticipantId}</span>
              )}
            </div>

            {/* To Participant */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                To Participant
                <span className={styles.required}>*</span>
              </label>
              <select
                className={`${styles.select} ${errors.toParticipantId ? styles.inputError : ''}`}
                value={formData.toParticipantId}
                onChange={(e) => handleFieldChange('toParticipantId', e.target.value)}
                data-testid="field-toParticipant"
              >
                <option value="">-- Select --</option>
                {participants.map(p => (
                  <option key={p.id} value={p.id}>
                    {getParticipantDisplayLabel(p, metaModel)}
                  </option>
                ))}
              </select>
              {errors.toParticipantId && (
                <span className={styles.errorMessage}>{errors.toParticipantId}</span>
              )}
            </div>

            {/* Request Content Section */}
            <div className={styles.conditionalGroup}>
              <div className={styles.conditionalLabel}>Request Content</div>

              {/* Mode Toggle */}
              <div className={styles.fieldGroup} style={{ marginBottom: '12px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="radio"
                      name="requestMode"
                      checked={formData.requestMode === 'label'}
                      onChange={() => handleFieldChange('requestMode', 'label')}
                    />
                    Label Text
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="radio"
                      name="requestMode"
                      checked={formData.requestMode === 'reference'}
                      onChange={() => handleFieldChange('requestMode', 'reference')}
                    />
                    Reference
                  </span>
                </label>
              </div>

              {formData.requestMode === 'label' ? (
                <div className={styles.fieldGroup}>
                  <input
                    type="text"
                    className={`${styles.input} ${errors.requestLabelText ? styles.inputError : ''}`}
                    value={formData.requestLabelText}
                    onChange={(e) => handleFieldChange('requestLabelText', e.target.value)}
                    placeholder="e.g., getOrder(), processPayment"
                    data-testid="field-requestLabelText"
                  />
                  {errors.requestLabelText && (
                    <span className={styles.errorMessage}>{errors.requestLabelText}</span>
                  )}
                </div>
              ) : (
                <>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Reference Type</label>
                    <select
                      className={`${styles.select} ${errors.requestRefKind ? styles.inputError : ''}`}
                      value={formData.requestRefKind}
                      onChange={(e) => handleFieldChange('requestRefKind', e.target.value)}
                      data-testid="field-requestRefKind"
                    >
                      <option value="">-- Select --</option>
                      {MESSAGE_REF_KINDS.map(kind => (
                        <option key={kind} value={kind}>{kind}</option>
                      ))}
                    </select>
                    {errors.requestRefKind && (
                      <span className={styles.errorMessage}>{errors.requestRefKind}</span>
                    )}
                  </div>

                  {formData.requestRefKind && (
                    <div className={styles.fieldGroup}>
                      <label className={styles.label}>Reference</label>
                      <select
                        className={`${styles.select} ${errors.requestRefId ? styles.inputError : ''}`}
                        value={formData.requestRefId}
                        onChange={(e) => handleFieldChange('requestRefId', e.target.value)}
                        data-testid="field-requestRefId"
                      >
                        <option value="">-- Select --</option>
                        {requestRefOptions.map(opt => (
                          <option key={opt.id} value={opt.id}>{opt.name}</option>
                        ))}
                      </select>
                      {errors.requestRefId && (
                        <span className={styles.errorMessage}>{errors.requestRefId}</span>
                      )}
                    </div>
                  )}

                  {/* "What to Show?" checkbox group - only for InterfaceEndpoint */}
                  {showWhatToShowCheckboxes && (
                    <div className={styles.fieldGroup} data-testid="what-to-show-group">
                      <label className={styles.label}>What to Show?</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="checkbox"
                            checked={formData.showEndpointName}
                            onChange={(e) => handleFieldChange('showEndpointName', e.target.checked)}
                            data-testid="field-showEndpointName"
                          />
                          Name
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="checkbox"
                            checked={formData.showEndpointVerbPath}
                            onChange={(e) => handleFieldChange('showEndpointVerbPath', e.target.checked)}
                            data-testid="field-showEndpointVerbPath"
                          />
                          Verb and Path
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="checkbox"
                            checked={formData.showEndpointReqResData}
                            onChange={(e) => handleFieldChange('showEndpointReqResData', e.target.checked)}
                            data-testid="field-showEndpointReqResData"
                          />
                          Request Data
                        </label>
                      </div>
                      {errors.whatToShow && (
                        <span className={styles.errorMessage}>{errors.whatToShow}</span>
                      )}
                    </div>
                  )}

                  {/* Is Collection checkbox - only for PhysicalEntity/LogicalEntity */}
                  {showRequestIsCollectionCheckbox && (
                    <div className={styles.fieldGroup}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="checkbox"
                          checked={formData.requestIsCollection}
                          onChange={(e) => handleFieldChange('requestIsCollection', e.target.checked)}
                          data-testid="field-requestIsCollection"
                        />
                        Is Collection?
                      </label>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Task 1.6: Self-message warning text */}
            {isSelfMessage && (
              <span
                className={styles.selfMessageWarning}
                data-testid="self-message-warning"
              >
                Source Participant and To Participant are the same
              </span>
            )}

            {/* Task 1.5: Include Response Checkbox - disabled when self-message */}
            <div className={styles.fieldGroup}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={formData.includeResponse}
                  onChange={(e) => handleFieldChange('includeResponse', e.target.checked)}
                  disabled={isSelfMessage}
                  data-testid="field-includeResponse"
                />
                Include Response Message
              </label>
            </div>

            {/* Response Content Section (conditional) */}
            {formData.includeResponse && (
              <div className={styles.conditionalGroup}>
                <div className={styles.conditionalLabel}>Response Content</div>

                {/* Mode Toggle */}
                <div className={styles.fieldGroup} style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input
                        type="radio"
                        name="responseContentMode"
                        checked={formData.responseContentMode === 'label'}
                        onChange={() => handleFieldChange('responseContentMode', 'label')}
                        data-testid="radio-responseContentMode-label"
                      />
                      Label Text
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input
                        type="radio"
                        name="responseContentMode"
                        checked={formData.responseContentMode === 'reference'}
                        onChange={() => handleFieldChange('responseContentMode', 'reference')}
                        data-testid="radio-responseContentMode-reference"
                      />
                      Reference
                    </span>
                    {showEndpointResponseOption && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="radio"
                          name="responseContentMode"
                          checked={formData.responseContentMode === 'endpoint_response'}
                          onChange={() => handleFieldChange('responseContentMode', 'endpoint_response')}
                          data-testid="radio-responseContentMode-endpoint_response"
                        />
                        Endpoint Response
                      </span>
                    )}
                  </label>
                </div>

                {formData.responseContentMode === 'endpoint_response' ? (
                  /* Endpoint Response selected: show response "What to Show?" checkbox group */
                  showResponseWhatToShowCheckboxes ? (
                    <div className={styles.fieldGroup} data-testid="response-what-to-show-group">
                      <label className={styles.label}>What to Show?</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="checkbox"
                            checked={formData.responseShowEndpointName}
                            onChange={(e) => handleFieldChange('responseShowEndpointName', e.target.checked)}
                            data-testid="field-responseShowEndpointName"
                          />
                          Name
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="checkbox"
                            checked={formData.responseShowEndpointVerbPath}
                            onChange={(e) => handleFieldChange('responseShowEndpointVerbPath', e.target.checked)}
                            data-testid="field-responseShowEndpointVerbPath"
                          />
                          Verb and Path
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="checkbox"
                            checked={formData.responseShowEndpointReqResData}
                            onChange={(e) => handleFieldChange('responseShowEndpointReqResData', e.target.checked)}
                            data-testid="field-responseShowEndpointReqResData"
                          />
                          Response Data
                        </label>
                      </div>
                      {errors.responseWhatToShow && (
                        <span className={styles.errorMessage}>{errors.responseWhatToShow}</span>
                      )}
                    </div>
                  ) : null
                ) : formData.responseContentMode === 'label' ? (
                  <div className={styles.fieldGroup}>
                    <input
                      type="text"
                      className={`${styles.input} ${errors.responseLabelText ? styles.inputError : ''}`}
                      value={formData.responseLabelText}
                      onChange={(e) => handleFieldChange('responseLabelText', e.target.value)}
                      placeholder="e.g., Order data, Success"
                      data-testid="field-responseLabelText"
                    />
                    {errors.responseLabelText && (
                      <span className={styles.errorMessage}>{errors.responseLabelText}</span>
                    )}
                  </div>
                ) : (
                  <>
                    <div className={styles.fieldGroup}>
                      <label className={styles.label}>Reference Type</label>
                      <select
                        className={`${styles.select} ${errors.responseRefKind ? styles.inputError : ''}`}
                        value={formData.responseRefKind}
                        onChange={(e) => handleFieldChange('responseRefKind', e.target.value)}
                        data-testid="field-responseRefKind"
                      >
                        <option value="">-- Select --</option>
                        {MESSAGE_REF_KINDS.map(kind => (
                          <option key={kind} value={kind}>{kind}</option>
                        ))}
                      </select>
                      {errors.responseRefKind && (
                        <span className={styles.errorMessage}>{errors.responseRefKind}</span>
                      )}
                    </div>

                    {formData.responseRefKind && (
                      <div className={styles.fieldGroup}>
                        <label className={styles.label}>Reference</label>
                        <select
                          className={`${styles.select} ${errors.responseRefId ? styles.inputError : ''}`}
                          value={formData.responseRefId}
                          onChange={(e) => handleFieldChange('responseRefId', e.target.value)}
                          data-testid="field-responseRefId"
                        >
                          <option value="">-- Select --</option>
                          {responseRefOptions.map(opt => (
                            <option key={opt.id} value={opt.id}>{opt.name}</option>
                          ))}
                        </select>
                        {errors.responseRefId && (
                          <span className={styles.errorMessage}>{errors.responseRefId}</span>
                        )}
                      </div>
                    )}

                    {/* Is Collection checkbox - only for PhysicalEntity/LogicalEntity */}
                    {showResponseIsCollectionCheckbox && (
                      <div className={styles.fieldGroup}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="checkbox"
                            checked={formData.responseIsCollection}
                            onChange={(e) => handleFieldChange('responseIsCollection', e.target.checked)}
                            data-testid="field-responseIsCollection"
                          />
                          Is Collection?
                        </label>
                      </div>
                    )}
                  </>
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
            disabled={isSubmitting}
            data-testid="drawer-submit-button"
          >
            {submitButtonText}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helper: Build a response SequenceMessage from form data
// ============================================================================

function buildResponseMessage(
  messageId: string,
  exchangeId: string,
  formData: FormData,
  isEndpointRef: boolean
): SequenceMessage {
  if (formData.responseContentMode === 'endpoint_response') {
    // Endpoint Response mode: copy ref from request, set response_mode
    return {
      id: messageId,
      exchange_id: exchangeId,
      exchange_role: 'Response',
      from_participant_id: formData.toParticipantId,
      to_participant_id: formData.fromParticipantId,
      ref_kind: formData.requestRefKind as MessageRefKind,
      ref_id: formData.requestRefId,
      response_mode: 'endpoint_response',
      show_endpoint_name: formData.responseShowEndpointName,
      show_endpoint_verb_path: formData.responseShowEndpointVerbPath,
      show_endpoint_req_res_data: formData.responseShowEndpointReqResData,
    };
  } else {
    return {
      id: messageId,
      exchange_id: exchangeId,
      exchange_role: 'Response',
      from_participant_id: formData.toParticipantId, // Response goes back
      to_participant_id: formData.fromParticipantId,
      ...(formData.responseContentMode === 'reference' ? {
        ref_kind: formData.responseRefKind as MessageRefKind,
        ref_id: formData.responseRefId,
        // Include is_collection only if true and refKind supports it
        ...(formData.responseIsCollection && supportsCollectionFlag(formData.responseRefKind) ? {
          is_collection: true,
        } : {}),
      } : {
        label_text: formData.responseLabelText,
      }),
    };
  }
}

export default AddMessageExchangeDrawer;
