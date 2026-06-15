/**
 * SequenceDiagramRenderer.tsx
 * Task Group 2: Participant header rendering for Sequence Diagrams
 * Task Group 3: Message arrow rendering for Sequence Diagrams
 * Task Group 4: Fragment frame rendering for Sequence Diagrams
 * Task Group 5: Participant Classification Logic for styling
 * Task Group 6: Sequence Diagram Renderer UI Updates - Participant styling with colours and icons
 * Participant Redraw: Redrawn headers at computed Y positions with segmented lifelines
 * Endpoint Display Spec TG5: Multi-line labels for InterfaceEndpoint messages
 *
 * This component renders Sequence diagram elements on an SVG canvas:
 * - Participant headers (box or stickman) with classification-based styling
 * - Lifelines (vertical lines)
 * - Messages (horizontal arrows) - Task Group 3
 * - Self-messages (loopback arrows) - Self-Message Feature
 * - Fragments (frames) - Task Group 4
 * - Redrawn participant headers at intervals for tall diagrams
 *
 * The component uses the computeSequenceLayout function from sequenceLayout.ts
 * to calculate positions and dimensions for all elements.
 */

import React, { useMemo } from 'react';
import {
  ExternalLink,
  MonitorSmartphone,
  FileCode,
  Database,
} from 'lucide-react';
import {
  SequenceDiagram,
  SequenceMessage,
  ParticipantRefKind,
  MessageRefKind,
  ExchangeRole,
  FragmentKind,
} from '../../types/sequenceDiagram';
import { MetaModel, TechType } from '../../types/model';
import {
  computeSequenceLayout,
  LAYOUT_CONSTANTS,
  SELF_MESSAGE_LOOP_HEIGHT,
  ParticipantLayout,
  MessageLayout,
  FragmentLayout,
  SequenceLayoutResult,
} from '../../utils/sequenceLayout';
import {
  wrapText,
  measureTextWidth,
  StickManDimensions,
  calculateArrowhead,
} from '../../utils/rendering';
import { appConfig } from '../../config/defaults';
import { resolveDataEntityPointName } from '../../utils/resolveDataEntityPointName';

// ============================================================================
// Props Interface
// ============================================================================

export interface SequenceDiagramRendererProps {
  /** The sequence diagram data to render */
  sequenceDiagram: SequenceDiagram;
  /** Horizontal spacing between participants (default: 220) */
  participantSpacing: number;
  /** MetaModel for resolving entity names */
  metaModel: MetaModel;
}

// ============================================================================
// Constants
// ============================================================================

/** Font size for participant header text */
const HEADER_FONT_SIZE = 12;

/** Font weight for participant header text */
const HEADER_FONT_WEIGHT = 'normal';

/** Font style for participant header text */
const HEADER_FONT_STYLE = 'normal';

/** Stroke color for lifelines */
const LIFELINE_STROKE_COLOR = '#000000';

/** Stroke width for lifelines */
const LIFELINE_STROKE_WIDTH = 1;

/** Stroke color for stickman */
const STICKMAN_STROKE_COLOR = '#333333';

/** Fill color for header boxes */
const HEADER_BOX_FILL = '#FFFFFF';

/** Stroke color for header boxes */
const HEADER_BOX_STROKE = '#333333';

/** Padding inside header box for text */
const HEADER_TEXT_PADDING = 10;

/** Line spacing for multi-line text */
const LINE_SPACING = 4;

/** Max lines for text wrapping before ellipsis */
const MAX_HEADER_LINES = 3;

// ============================================================================
// Task Group 5: Participant Classification and Styling Constants
// Spec: Sequence Diagram Participant Colour and Icons for Services and Components
// ============================================================================

/**
 * ParticipantClassification - result of classifying a participant for styling.
 * Determines which fill colour and icon to use.
 */
export type ParticipantClassification =
  | 'EXTERNAL'
  | 'INTERNAL_UI'
  | 'INTERNAL_SERVICE'
  | 'INTERNAL_PERSISTENCE'
  | 'OTHER';

/** Fill colours for participant header boxes (subtle/pale tones) */
export const PARTICIPANT_FILL_COLOURS = {
  EXTERNAL: '#E3F2FD',           // Light blue
  INTERNAL_UI: '#E8F5E9',        // Light green
  INTERNAL_SERVICE: '#FFF9C4',   // Light yellow
  INTERNAL_PERSISTENCE: '#F3E5F5', // Light purple
  OTHER: '#FFFFFF',              // White (default)
} as const;

/** Icon size for participant headers */
export const PARTICIPANT_ICON_SIZE = 16;

/** Gap between icon and text in participant headers */
export const ICON_TEXT_GAP = 5;

/** Participant kinds that receive colour/icon treatment */
export const STYLED_PARTICIPANT_KINDS: ParticipantRefKind[] = ['Service', 'ApplicationComponent'];

/**
 * Lucide icon names mapped to classifications.
 * null means no icon.
 */
export const CLASSIFICATION_ICONS: Record<ParticipantClassification, string | null> = {
  EXTERNAL: 'external-link',
  INTERNAL_UI: 'monitor-smartphone',
  INTERNAL_SERVICE: 'file-code',
  INTERNAL_PERSISTENCE: 'database',
  OTHER: null,
};

// ============================================================================
// Task Group 6: Lucide Icon Components Mapping
// ============================================================================

/**
 * Maps icon names to Lucide React components.
 */
const ICON_COMPONENTS: Record<string, React.FC<{ size?: number }>> = {
  'external-link': ExternalLink,
  'monitor-smartphone': MonitorSmartphone,
  'file-code': FileCode,
  'database': Database,
};

// ============================================================================
// Task Group 5: Classification Helper Functions
// ============================================================================

/**
 * Maps tech_type to classification.
 *
 * @param techType - The tech_type value from ApplicationComponent
 * @returns ParticipantClassification based on tier
 */
export function classifyByTechType(techType: TechType | string | undefined): ParticipantClassification {
  switch (techType) {
    case 'UI Tier':
      return 'INTERNAL_UI';
    case 'Service Tier':
      return 'INTERNAL_SERVICE';
    case 'Persistence Tier':
      return 'INTERNAL_PERSISTENCE';
    default:
      return 'OTHER';
  }
}

/**
 * Resolves the classification for a Service participant.
 *
 * Rules:
 * 1. If service.is_internal === false -> EXTERNAL
 * 2. If service.is_internal === true (or missing, defaults to true):
 *    a. Resolve service.app_component_id to ApplicationComponent
 *    b. If found, use appComponent.tech_type:
 *       - "UI Tier" -> INTERNAL_UI
 *       - "Service Tier" -> INTERNAL_SERVICE
 *       - "Persistence Tier" -> INTERNAL_PERSISTENCE
 *       - "Other" or missing -> OTHER
 *    c. If appComponent not found/missing -> OTHER
 *
 * @param serviceId - ID of the Service entity
 * @param metaModel - MetaModel containing services and app_components
 * @returns ParticipantClassification
 */
export function classifyServiceParticipant(
  serviceId: string,
  metaModel: MetaModel
): ParticipantClassification {
  const service = metaModel.entities.services.find(s => s.id === serviceId);
  if (!service) {
    return 'OTHER';
  }

  // Check if external (is_internal defaults to true if missing)
  const isInternal = service.is_internal !== false;
  if (!isInternal) {
    return 'EXTERNAL';
  }

  // Resolve app component for tier classification
  if (service.app_component_id) {
    const appComponent = metaModel.entities.app_components.find(
      c => c.id === service.app_component_id
    );
    if (appComponent) {
      return classifyByTechType(appComponent.tech_type);
    }
  }

  return 'OTHER';
}

/**
 * Resolves the classification for an ApplicationComponent participant.
 *
 * Rules:
 * 1. If component.is_internal === false -> EXTERNAL
 * 2. If component.is_internal === true (or missing, defaults to true):
 *    Use component.tech_type:
 *    - "UI Tier" -> INTERNAL_UI
 *    - "Service Tier" -> INTERNAL_SERVICE
 *    - "Persistence Tier" -> INTERNAL_PERSISTENCE
 *    - "Other" or missing -> OTHER
 *
 * @param componentId - ID of the ApplicationComponent entity
 * @param metaModel - MetaModel containing app_components
 * @returns ParticipantClassification
 */
export function classifyAppComponentParticipant(
  componentId: string,
  metaModel: MetaModel
): ParticipantClassification {
  const component = metaModel.entities.app_components.find(c => c.id === componentId);
  if (!component) {
    return 'OTHER';
  }

  // Check if external (is_internal defaults to true if missing)
  const isInternal = component.is_internal !== false;
  if (!isInternal) {
    return 'EXTERNAL';
  }

  return classifyByTechType(component.tech_type);
}

/**
 * Determines if a participant kind should receive styled treatment.
 *
 * @param refKind - The participant's ref_kind
 * @returns true if the participant should have colour/icon styling
 */
export function shouldStyleParticipant(refKind: ParticipantRefKind | string): boolean {
  return STYLED_PARTICIPANT_KINDS.includes(refKind as ParticipantRefKind);
}

/**
 * Gets the classification for a participant based on its ref_kind and ref_id.
 *
 * @param refKind - The participant's ref_kind
 * @param refId - The participant's ref_id (entity ID)
 * @param metaModel - MetaModel for lookups
 * @returns ParticipantClassification
 */
export function classifyParticipant(
  refKind: ParticipantRefKind | string,
  refId: string,
  metaModel: MetaModel
): ParticipantClassification {
  if (refKind === 'Service') {
    return classifyServiceParticipant(refId, metaModel);
  }
  if (refKind === 'ApplicationComponent') {
    return classifyAppComponentParticipant(refId, metaModel);
  }
  return 'OTHER';
}

// ============================================================================
// Task Group 3: Message Arrow Constants
// ============================================================================

/** Stroke color for message arrows */
const MESSAGE_STROKE_COLOR = '#000000';

/** Stroke width for message arrows */
const MESSAGE_STROKE_WIDTH = 1.5;

/** Dashed pattern for Response messages (strokeDasharray) */
const RESPONSE_DASH_ARRAY = '6,4';

/** Size of the arrowhead */
const ARROWHEAD_SIZE = 8;

/** Font size for message labels */
const MESSAGE_LABEL_FONT_SIZE = 11;

/** Vertical offset for message label (above the arrow) */
const MESSAGE_LABEL_OFFSET_Y = 12;

/** Line spacing for multi-line message labels (tspan dy) */
export const MESSAGE_LABEL_LINE_SPACING = 14;

// ============================================================================
// Self-Message (Loopback Arrow) Constants
// ============================================================================

/** Horizontal extent of the loopback arrow from lifeline */
export const SELF_MESSAGE_LOOP_WIDTH = 40;

// SELF_MESSAGE_LOOP_HEIGHT is imported from sequenceLayout.ts (shared constant)

// ============================================================================
// Task Group 4: Fragment Frame Constants
// ============================================================================

/** Stroke color for fragment frames */
const FRAGMENT_STROKE_COLOR = '#333333';

/** Stroke width for fragment frames */
const FRAGMENT_STROKE_WIDTH = 1;

/** Fill color for fragment frames (transparent) */
const FRAGMENT_FILL_COLOR = 'rgba(245, 245, 245, 0.5)';

/** Font size for fragment label */
const FRAGMENT_LABEL_FONT_SIZE = 10;

/** Font weight for fragment label */
const FRAGMENT_LABEL_FONT_WEIGHT = 'bold';

/** Background color for fragment label box */
const FRAGMENT_LABEL_BG_COLOR = '#FFFFFF';

/** Padding for fragment label */
const FRAGMENT_LABEL_PADDING_X = 6;
const FRAGMENT_LABEL_PADDING_Y = 2;

/** Offset from frame corner for label */
const FRAGMENT_LABEL_OFFSET_X = 4;
const FRAGMENT_LABEL_OFFSET_Y = 4;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Mapping from ParticipantRefKind to MetaModel entity collection key
 */
const REF_KIND_TO_COLLECTION: Record<ParticipantRefKind, keyof MetaModel['entities']> = {
  BusinessUser: 'business_users',
  Application: 'applications',
  ApplicationComponent: 'app_components',
  Service: 'services',
  Interface: 'interfaces',
  InterfaceEndpoint: 'endpoints',
  Class: 'classes',
};

/**
 * Mapping from MessageRefKind to MetaModel entity collection key
 * Used for resolving message labels from referenced entities.
 */
const MESSAGE_REF_KIND_TO_COLLECTION: Record<MessageRefKind, keyof MetaModel['entities']> = {
  Method: 'methods',
  LogicalEntity: 'logical_data_entities',
  PhysicalEntity: 'physical_data_entities',
  Class: 'classes',
  Event: 'events',
  Interface: 'interfaces',
  InterfaceEndpoint: 'endpoints',
};

/**
 * Resolves the display name for a participant by looking up the entity in the metaModel.
 * Falls back to ref_id if the entity is not found.
 *
 * @param refKind - The type of entity being referenced
 * @param refId - The ID of the referenced entity
 * @param metaModel - The MetaModel containing all entities
 * @returns The resolved display name
 */
export function resolveParticipantName(
  refKind: ParticipantRefKind | string,
  refId: string,
  metaModel: MetaModel
): string {
  const collectionKey = REF_KIND_TO_COLLECTION[refKind as ParticipantRefKind];
  if (!collectionKey) {
    return refId;
  }

  const collection = metaModel.entities[collectionKey];
  if (!collection || !Array.isArray(collection)) {
    return refId;
  }

  const entity = collection.find((e: { id: string; name?: string }) => e.id === refId);
  if (entity && 'name' in entity && typeof entity.name === 'string') {
    return entity.name;
  }

  return refId;
}

// ============================================================================
// Task Group 3: Message Helper Functions
// ============================================================================

/**
 * Result type for shouldRenderMessage
 */
export interface RenderMessageResult {
  /** Whether the message should be rendered */
  shouldRender: boolean;
  /** Reason why message should not be rendered (for logging) */
  reason?: string;
}

/**
 * Checks if a message should be rendered based on participant availability.
 * Logs a warning if participant IDs are missing.
 *
 * @param message - The message to check
 * @param participantIds - Set of valid participant IDs
 * @returns Result indicating whether to render and reason if not
 */
export function shouldRenderMessage(
  message: SequenceMessage,
  participantIds: Set<string>
): RenderMessageResult {
  if (!participantIds.has(message.from_participant_id)) {
    return {
      shouldRender: false,
      reason: `from_participant_id '${message.from_participant_id}' not found`,
    };
  }

  if (!participantIds.has(message.to_participant_id)) {
    return {
      shouldRender: false,
      reason: `to_participant_id '${message.to_participant_id}' not found`,
    };
  }

  return { shouldRender: true };
}

/**
 * Checks if a message is a self-message (same source and target participant).
 *
 * @param message - The message to check
 * @returns true if from_participant_id === to_participant_id
 */
export function isSelfMessage(message: SequenceMessage): boolean {
  return message.from_participant_id === message.to_participant_id;
}

// ============================================================================
// Task Group 4 (Collection Support): Collection Label Formatting Constants & Helpers
// Spec: 2026-01-26 - Sequence Diagram Message Exchange Collection Entity Display
// ============================================================================

/**
 * MessageRefKind values that support the collection wrapper.
 * Only data entities (PhysicalEntity, LogicalEntity) can be collections.
 */
export const ENTITY_REF_KINDS_SUPPORTING_COLLECTION: MessageRefKind[] = [
  'PhysicalEntity',
  'LogicalEntity',
];

/**
 * Checks if a ref_kind supports the collection wrapper.
 *
 * @param refKind - The reference kind to check
 * @returns true if refKind is in ENTITY_REF_KINDS_SUPPORTING_COLLECTION
 */
export function supportsCollectionWrapper(refKind: MessageRefKind | string | undefined): boolean {
  return ENTITY_REF_KINDS_SUPPORTING_COLLECTION.includes(refKind as MessageRefKind);
}

/**
 * Formats an entity name as a collection if applicable.
 *
 * @param entityName - The resolved entity name
 * @param isCollection - Whether this represents a collection
 * @param refKind - The reference kind (must be PhysicalEntity or LogicalEntity for collection format)
 * @returns Formatted label: "Collection<EntityName>" or "EntityName"
 */
export function formatEntityLabel(
  entityName: string,
  isCollection: boolean | undefined,
  refKind: MessageRefKind | string | undefined
): string {
  if (isCollection && supportsCollectionWrapper(refKind)) {
    return `Collection<${entityName}>`;
  }
  return entityName;
}

/**
 * Resolves the label for a message by looking up the entity in the metaModel.
 * Falls back to label_text if ref_kind/ref_id are not set.
 * Falls back to ref_id if entity is not found.
 * Returns empty string if no label information is available.
 *
 * For InterfaceEndpoint references, returns a string[] with up to 3 lines:
 * 1. Endpoint name (if show_endpoint_name or legacy fallback)
 * 2. Verb + path (if show_endpoint_verb_path)
 * 3. Data entity name (if show_endpoint_req_res_data)
 *
 * For PhysicalEntity/LogicalEntity references with is_collection=true,
 * wraps the label as "Collection<EntityName>".
 *
 * @param message - The message to resolve label for
 * @param metaModel - The MetaModel containing all entities
 * @returns The resolved label string or string array (for multi-line InterfaceEndpoint labels)
 */
export function resolveMessageLabel(
  message: SequenceMessage,
  metaModel: MetaModel
): string | string[] {
  // If ref_kind and ref_id are set, try to look up the entity name
  if (message.ref_kind && message.ref_id) {
    // InterfaceEndpoint: build multi-line label
    if (message.ref_kind === 'InterfaceEndpoint') {
      return resolveInterfaceEndpointLabel(message, metaModel);
    }

    const collectionKey = MESSAGE_REF_KIND_TO_COLLECTION[message.ref_kind];
    if (collectionKey) {
      const collection = metaModel.entities[collectionKey];
      if (collection && Array.isArray(collection)) {
        const entity = collection.find((e: { id: string; name?: string }) => e.id === message.ref_id);
        if (entity && 'name' in entity && typeof entity.name === 'string') {
          // Apply collection formatting if applicable
          return formatEntityLabel(entity.name, message.is_collection, message.ref_kind);
        }
      }
    }
    // Fallback to ref_id if entity not found (also apply collection format)
    return formatEntityLabel(message.ref_id, message.is_collection, message.ref_kind);
  }

  // Use label_text if available (no collection formatting for label text mode)
  if (message.label_text) {
    return message.label_text;
  }

  // No label information available
  return '';
}

/**
 * Resolves a multi-line label for an InterfaceEndpoint message.
 * Builds lines in order: name, verb+path, data entity.
 * Legacy fallback: if all show_* flags are false/missing, shows endpoint name.
 *
 * @param message - The message referencing an InterfaceEndpoint
 * @param metaModel - The MetaModel containing all entities
 * @returns string[] with 1-3 label lines
 */
function resolveInterfaceEndpointLabel(
  message: SequenceMessage,
  metaModel: MetaModel
): string[] {
  const endpoint = metaModel.entities.endpoints.find(e => e.id === message.ref_id);
  if (!endpoint) {
    return [message.ref_id || ''];
  }

  const showName = message.show_endpoint_name;
  const showVerbPath = message.show_endpoint_verb_path;
  const showData = message.show_endpoint_req_res_data;

  // Legacy fallback: if all flags false/missing, show endpoint name
  const isLegacy = !showName && !showVerbPath && !showData;
  if (isLegacy) {
    return [endpoint.name];
  }

  const lines: string[] = [];

  // Line 1: Endpoint name
  if (showName) {
    lines.push(endpoint.name);
  }

  // Line 2: Verb + path
  if (showVerbPath) {
    const verb = endpoint.operation_verb || '';
    const path = endpoint.path_or_address || '';
    const verbPath = `${verb} ${path}`.trim();
    if (verbPath) {
      lines.push(verbPath);
    }
  }

  // Line 3: Data entity name (request or response based on exchange_role / response_mode)
  if (showData) {
    const isResponse = message.exchange_role === 'Response' || message.response_mode === 'endpoint_response';
    const depId = isResponse
      ? endpoint.response_data_entity_point_id
      : endpoint.request_data_entity_point_id;
    const dataName = resolveDataEntityPointName(depId, metaModel);
    if (dataName) {
      lines.push(dataName);
    }
  }

  // If somehow no lines produced, fallback to name
  if (lines.length === 0) {
    return [endpoint.name];
  }

  return lines;
}

/**
 * Returns the number of label lines for a resolved label.
 * Used by the layout engine for dynamic row height.
 */
export function getLabelLineCount(label: string | string[]): number {
  if (Array.isArray(label)) {
    return label.length;
  }
  return label ? 1 : 0;
}

/**
 * Returns the stroke style for a message based on its exchange role.
 * Request messages use solid stroke, Response messages use dashed stroke.
 *
 * @param exchangeRole - The exchange role (Request or Response)
 * @returns Object with strokeWidth and strokeDasharray
 */
export function getMessageStrokeStyle(exchangeRole: ExchangeRole | string): {
  strokeWidth: number;
  strokeDasharray: string;
} {
  return {
    strokeWidth: MESSAGE_STROKE_WIDTH,
    strokeDasharray: exchangeRole === 'Response' ? RESPONSE_DASH_ARRAY : '',
  };
}

/**
 * Result type for wrapTextWithEllipsis
 */
export interface WrapTextResult {
  /** Wrapped lines of text */
  lines: string[];
  /** Whether text was truncated (ellipsis needed) */
  truncated: boolean;
}

/**
 * Wraps text into multiple lines with a maximum line count.
 * If text exceeds maxLines, adds ellipsis to the last line.
 *
 * @param text - Text to wrap
 * @param maxWidth - Maximum width in pixels
 * @param fontSize - Font size for measurement
 * @param maxLines - Maximum number of lines (default: 3)
 * @returns Object with wrapped lines and truncation flag
 */
export function wrapTextWithEllipsis(
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number = MAX_HEADER_LINES
): WrapTextResult {
  if (!text) {
    return { lines: [], truncated: false };
  }

  const allLines = wrapText(text, maxWidth, fontSize, HEADER_FONT_WEIGHT, HEADER_FONT_STYLE);

  if (allLines.length <= maxLines) {
    return { lines: allLines, truncated: false };
  }

  // Truncate to maxLines and add ellipsis to last line
  const truncatedLines = allLines.slice(0, maxLines);
  const lastLine = truncatedLines[maxLines - 1];

  // Add ellipsis if the last line doesn't already end with one
  if (!lastLine.endsWith('...')) {
    // Trim the last line to fit ellipsis
    let trimmedLine = lastLine;
    while (measureTextWidth(trimmedLine + '...', fontSize, HEADER_FONT_WEIGHT, HEADER_FONT_STYLE) > maxWidth && trimmedLine.length > 0) {
      trimmedLine = trimmedLine.slice(0, -1);
    }
    truncatedLines[maxLines - 1] = trimmedLine + '...';
  }

  return { lines: truncatedLines, truncated: true };
}

/**
 * Calculates stickman dimensions for a participant header.
 * Adapted from calculateStickManDimensions in rendering.ts but for sequence diagram context.
 *
 * @param x - X position of the participant area
 * @param y - Y position (top of header)
 * @param width - Width of the participant area
 * @param height - Height of the stickman figure (excluding text)
 * @returns StickManDimensions for rendering
 */
function calculateStickManDimensionsForSequence(
  x: number,
  y: number,
  width: number,
  height: number
): StickManDimensions {
  const centerX = x + width / 2;
  const topY = y;
  const figureHeight = height;

  // Head is 20% of total height (radius is 10%)
  const headRadius = figureHeight * 0.1;
  const headCenterY = topY + headRadius;

  // Body starts after head and is 40% of height
  const bodyStartY = headCenterY + headRadius;
  const bodyEndY = topY + figureHeight * 0.6;

  // Arms positioned at 20% down the body
  const armY = bodyStartY + (bodyEndY - bodyStartY) * 0.2;
  const armSpan = width * 0.1;

  // Legs are 40% of height
  const legEndY = topY + figureHeight;
  const legSpan = width * 0.1;

  return {
    centerX,
    headRadius,
    headCenterY,
    bodyStartY,
    bodyEndY,
    armY,
    armSpan,
    legEndY,
    legSpan,
  };
}

// ============================================================================
// Task Group 4: Fragment Helper Functions
// ============================================================================

/**
 * Converts a FragmentKind to its display label, optionally appending user label.
 * Loop -> "loop" or "loop - [label]"
 * Optional -> "opt" or "opt - [label]"
 * Alternative -> "alt" or "alt - [label]"
 *
 * @param fragmentKind - The kind of fragment
 * @param labelText - Optional user-provided label text
 * @returns The display label string
 */
export function getFragmentLabel(
  fragmentKind: FragmentKind | string,
  labelText?: string | null
): string {
  // Determine fragment kind abbreviation
  let kindLabel: string;
  if (fragmentKind === 'Optional') {
    kindLabel = 'opt';
  } else if (fragmentKind === 'Alternative') {
    kindLabel = 'alt';
  } else {
    kindLabel = fragmentKind.toLowerCase();
  }

  // Append user label if present and non-empty
  const trimmedLabel = labelText?.trim();
  if (trimmedLabel) {
    return `${kindLabel} - ${trimmedLabel}`;
  }

  return kindLabel;
}

// ============================================================================
// Task Group 6: ParticipantIcon Component
// ============================================================================

interface ParticipantIconProps {
  iconName: string;
  x: number;
  y: number;
  size: number;
}

/**
 * Renders a Lucide icon at the specified position within SVG.
 * Uses foreignObject to embed the React component.
 */
const ParticipantIcon: React.FC<ParticipantIconProps> = ({
  iconName,
  x,
  y,
  size,
}) => {
  const IconComponent = ICON_COMPONENTS[iconName];
  if (!IconComponent) {
    return null;
  }

  return (
    <foreignObject x={x} y={y} width={size} height={size}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
        <IconComponent size={size} />
      </div>
    </foreignObject>
  );
};

// ============================================================================
// Lifeline Segment Computation
// ============================================================================

/**
 * Computes lifeline segments, splitting the lifeline at redraw header positions.
 * Each redraw header occupies vertical space equal to headerAreaHeight + 20,
 * so the lifeline is interrupted during that region.
 *
 * @param lifelineTopY - Top Y of the lifeline (below original header)
 * @param lifelineBottomY - Bottom Y of the lifeline
 * @param participantRedrawYPositions - Y positions where headers are redrawn
 * @returns Array of {topY, bottomY} segments
 */
export function computeLifelineSegments(
  lifelineTopY: number,
  lifelineBottomY: number,
  participantRedrawYPositions: number[]
): Array<{ topY: number; bottomY: number }> {
  if (participantRedrawYPositions.length === 0) {
    return [{ topY: lifelineTopY, bottomY: lifelineBottomY }];
  }

  const headerAreaHeight = Math.max(LAYOUT_CONSTANTS.headerBoxHeight, LAYOUT_CONSTANTS.userHeaderHeight);
  const redrawBlockHeight = headerAreaHeight + 20;

  const segments: Array<{ topY: number; bottomY: number }> = [];
  let currentTop = lifelineTopY;

  for (const redrawY of participantRedrawYPositions) {
    // Segment from current top to the redraw Y position
    if (redrawY > currentTop) {
      segments.push({ topY: currentTop, bottomY: redrawY });
    }
    // Next segment starts after the redrawn header block
    currentTop = redrawY + redrawBlockHeight;
  }

  // Final segment from after last redraw to bottom
  if (lifelineBottomY > currentTop) {
    segments.push({ topY: currentTop, bottomY: lifelineBottomY });
  }

  return segments;
}

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Updated ParticipantHeaderProps interface
 * Added classification, refKind, and participantRedrawYPositions props
 */
interface ParticipantHeaderProps {
  layout: ParticipantLayout;
  displayName: string;
  isBusinessUser: boolean;
  lifelineTopY: number;
  lifelineBottomY: number;
  classification: ParticipantClassification;
  refKind: ParticipantRefKind | string;
  /** Y positions where participant headers are redrawn (for lifeline segmentation) */
  participantRedrawYPositions: number[];
}

/**
 * Renders a single participant header (box or stickman) with its lifeline.
 * Task Group 6: For Service and ApplicationComponent participants, applies
 * classification-based fill colour and optional icon.
 * Participant Redraw: Lifelines are segmented at redraw positions.
 */
const ParticipantHeader: React.FC<ParticipantHeaderProps> = ({
  layout,
  displayName,
  isBusinessUser,
  lifelineTopY,
  lifelineBottomY,
  classification,
  refKind,
  participantRedrawYPositions,
}) => {
  const { headerBoxWidth, headerBoxHeight, userHeaderHeight } = LAYOUT_CONSTANTS;

  // Compute lifeline segments (segmented at redraw positions)
  const lifelineSegments = computeLifelineSegments(
    lifelineTopY,
    lifelineBottomY,
    participantRedrawYPositions
  );

  // Determine if this participant should have styled treatment
  const isStyledParticipant = shouldStyleParticipant(refKind);

  // Get fill colour based on classification
  const fillColour = isStyledParticipant
    ? PARTICIPANT_FILL_COLOURS[classification]
    : HEADER_BOX_FILL;

  // Get icon name (null means no icon)
  const iconName = isStyledParticipant ? CLASSIFICATION_ICONS[classification] : null;

  // Calculate text width accounting for icon
  const textMaxWidth = iconName
    ? headerBoxWidth - HEADER_TEXT_PADDING * 2 - PARTICIPANT_ICON_SIZE - ICON_TEXT_GAP
    : headerBoxWidth - HEADER_TEXT_PADDING * 2;

  // Render segmented lifeline lines
  const renderLifelineSegments = () =>
    lifelineSegments.map((segment, segIndex) => (
      <line
        key={`lifeline-seg-${segIndex}`}
        x1={layout.lifelineX}
        y1={segment.topY}
        x2={layout.lifelineX}
        y2={segment.bottomY}
        stroke={LIFELINE_STROKE_COLOR}
        strokeWidth={LIFELINE_STROKE_WIDTH}
        strokeDasharray="5,5"
      />
    ));

  if (isBusinessUser) {
    // Render stickman for BusinessUser (unchanged from original)
    const stickmanHeight = userHeaderHeight * 0.7; // Leave room for text below
    const dims = calculateStickManDimensionsForSequence(
      layout.x,
      layout.y,
      layout.width,
      stickmanHeight
    );

    // Wrap text for display below stickman
    const { lines } = wrapTextWithEllipsis(displayName, headerBoxWidth - HEADER_TEXT_PADDING * 2, HEADER_FONT_SIZE, MAX_HEADER_LINES);
    const textStartY = dims.legEndY + 15; // Gap below feet

    return (
      <g className="sequence-participant" data-participant-id={layout.participantId}>
        {/* Stickman head (circle) */}
        <circle
          cx={dims.centerX}
          cy={dims.headCenterY}
          r={dims.headRadius}
          fill="none"
          stroke={STICKMAN_STROKE_COLOR}
          strokeWidth={appConfig.node.borderWidth}
        />
        {/* Stickman body (vertical line) */}
        <line
          x1={dims.centerX}
          y1={dims.bodyStartY}
          x2={dims.centerX}
          y2={dims.bodyEndY}
          stroke={STICKMAN_STROKE_COLOR}
          strokeWidth={appConfig.node.borderWidth}
        />
        {/* Stickman arms (horizontal line) */}
        <line
          x1={dims.centerX - dims.armSpan}
          y1={dims.armY}
          x2={dims.centerX + dims.armSpan}
          y2={dims.armY}
          stroke={STICKMAN_STROKE_COLOR}
          strokeWidth={appConfig.node.borderWidth}
        />
        {/* Stickman left leg */}
        <line
          x1={dims.centerX}
          y1={dims.bodyEndY}
          x2={dims.centerX - dims.legSpan}
          y2={dims.legEndY}
          stroke={STICKMAN_STROKE_COLOR}
          strokeWidth={appConfig.node.borderWidth}
        />
        {/* Stickman right leg */}
        <line
          x1={dims.centerX}
          y1={dims.bodyEndY}
          x2={dims.centerX + dims.legSpan}
          y2={dims.legEndY}
          stroke={STICKMAN_STROKE_COLOR}
          strokeWidth={appConfig.node.borderWidth}
        />
        {/* Name text below stickman */}
        {lines.map((line, index) => (
          <text
            key={index}
            x={layout.lifelineX}
            y={textStartY + index * (HEADER_FONT_SIZE + LINE_SPACING)}
            textAnchor="middle"
            fontSize={HEADER_FONT_SIZE}
            fontWeight={HEADER_FONT_WEIGHT}
            fontStyle={HEADER_FONT_STYLE}
            fill="#333"
          >
            {line}
          </text>
        ))}
        {/* Segmented Lifeline */}
        {renderLifelineSegments()}
      </g>
    );
  }

  // Render box header for non-BusinessUser participants
  const { lines } = wrapTextWithEllipsis(displayName, textMaxWidth, HEADER_FONT_SIZE, MAX_HEADER_LINES);

  // Calculate vertical centering for text
  const totalTextHeight = lines.length * HEADER_FONT_SIZE + (lines.length - 1) * LINE_SPACING;
  const textStartY = layout.y + (headerBoxHeight - totalTextHeight) / 2 + HEADER_FONT_SIZE;

  // Calculate icon position (left side, aligned with first line of text baseline)
  const iconX = layout.x + HEADER_TEXT_PADDING;
  const iconY = textStartY - HEADER_FONT_SIZE + (HEADER_FONT_SIZE - PARTICIPANT_ICON_SIZE) / 2;

  // Text X position shifts right when icon present
  const textX = iconName
    ? layout.lifelineX + (PARTICIPANT_ICON_SIZE + ICON_TEXT_GAP) / 2
    : layout.lifelineX;

  return (
    <g className="sequence-participant" data-participant-id={layout.participantId}>
      {/* Header box */}
      <rect
        x={layout.x}
        y={layout.y}
        width={headerBoxWidth}
        height={headerBoxHeight}
        fill={fillColour}
        stroke={HEADER_BOX_STROKE}
        strokeWidth={appConfig.node.borderWidth}
        rx={4}
      />

      {/* Icon (if applicable) */}
      {iconName && (
        <ParticipantIcon
          iconName={iconName}
          x={iconX}
          y={iconY}
          size={PARTICIPANT_ICON_SIZE}
        />
      )}

      {/* Name text inside box */}
      {lines.map((line, index) => (
        <text
          key={index}
          x={textX}
          y={textStartY + index * (HEADER_FONT_SIZE + LINE_SPACING)}
          textAnchor="middle"
          fontSize={HEADER_FONT_SIZE}
          fontWeight={HEADER_FONT_WEIGHT}
          fontStyle={HEADER_FONT_STYLE}
          fill="#333"
        >
          {line}
        </text>
      ))}

      {/* Segmented Lifeline */}
      {renderLifelineSegments()}
    </g>
  );
};

// ============================================================================
// Task Group 3: Message Arrow Component
// Endpoint Display Spec TG5: Multi-line label support via tspan
// ============================================================================

interface MessageArrowProps {
  layout: MessageLayout;
  label: string | string[];
}

/**
 * Renders a multi-line label block using tspan elements.
 * Centers the label block vertically around the baseY position.
 * For 3-line labels, shifts up by an additional 10px to avoid arrow overlap.
 */
export function renderMultiLineLabel(
  labelLines: string[],
  labelX: number,
  baseY: number
): React.ReactElement | null {
  if (labelLines.length === 0) return null;

  // Shift the starting Y upward to center the block
  const totalHeight = (labelLines.length - 1) * MESSAGE_LABEL_LINE_SPACING;
  let startY = baseY - totalHeight / 2;

  // 3-line label y-offset fix: shift up by additional 10px to prevent arrow overlap
  if (labelLines.length === 3) {
    startY -= 10;
  }

  return (
    <text
      x={labelX}
      y={startY}
      textAnchor="middle"
      dominantBaseline="auto"
      fontSize={MESSAGE_LABEL_FONT_SIZE}
      fill="#333"
    >
      {labelLines.map((line, index) => (
        <tspan
          key={index}
          x={labelX}
          dy={index === 0 ? 0 : MESSAGE_LABEL_LINE_SPACING}
        >
          {line}
        </tspan>
      ))}
    </text>
  );
}

/**
 * Renders a single message arrow with arrowhead and label.
 * Supports both single-line string and multi-line string[] labels.
 */
const MessageArrow: React.FC<MessageArrowProps> = ({ layout, label }) => {
  const { strokeWidth, strokeDasharray } = getMessageStrokeStyle(layout.exchangeRole);

  const arrowheadPath = calculateArrowhead(
    layout.fromX,
    layout.y,
    layout.toX,
    layout.y,
    ARROWHEAD_SIZE
  );

  const labelX = (layout.fromX + layout.toX) / 2;
  const labelY = layout.y - MESSAGE_LABEL_OFFSET_Y;

  const labelLines = Array.isArray(label) ? label : (label ? [label] : []);

  return (
    <g className="sequence-message" data-message-id={layout.messageId}>
      <line
        x1={layout.fromX}
        y1={layout.y}
        x2={layout.toX}
        y2={layout.y}
        stroke={MESSAGE_STROKE_COLOR}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray || undefined}
      />
      <path
        d={arrowheadPath}
        fill={MESSAGE_STROKE_COLOR}
        stroke={MESSAGE_STROKE_COLOR}
        strokeWidth={1}
      />
      {labelLines.length > 0 && renderMultiLineLabel(labelLines, labelX, labelY)}
    </g>
  );
};

// ============================================================================
// Self-Message Loopback Arrow Component
// Endpoint Display Spec TG5: Multi-line label support via tspan
// ============================================================================

interface SelfMessageArrowProps {
  layout: MessageLayout;
  label: string | string[];
}

/**
 * Renders a self-message as a loopback arrow.
 * The loopback consists of:
 * - Horizontal segment leaving the lifeline to the right
 * - Vertical segment going downward
 * - Horizontal segment returning back to the lifeline
 * - Arrowhead pointing back to the lifeline
 *
 * Label is positioned above the initial (top) horizontal segment.
 * Supports multi-line labels via tspan elements.
 */
const SelfMessageArrow: React.FC<SelfMessageArrowProps> = ({ layout, label }) => {
  const { strokeWidth, strokeDasharray } = getMessageStrokeStyle(layout.exchangeRole);

  // The lifeline X position (fromX and toX are the same for self-messages)
  const lifelineX = layout.fromX;
  const baseY = layout.y;

  // Calculate loopback path points
  const rightX = lifelineX + SELF_MESSAGE_LOOP_WIDTH;
  const bottomY = baseY + SELF_MESSAGE_LOOP_HEIGHT;

  // Path: start at lifeline, go right, go down, return left to lifeline
  // M = move to start
  // L = line to point
  const pathD = `
    M ${lifelineX} ${baseY}
    L ${rightX} ${baseY}
    L ${rightX} ${bottomY}
    L ${lifelineX} ${bottomY}
  `;

  // Arrowhead pointing left (back to lifeline) on the bottom segment
  const arrowheadPath = calculateArrowhead(
    rightX,
    bottomY,
    lifelineX,
    bottomY,
    ARROWHEAD_SIZE
  );

  // Label positioned above the top horizontal segment
  const labelX = lifelineX + SELF_MESSAGE_LOOP_WIDTH / 2;
  const labelY = baseY - MESSAGE_LABEL_OFFSET_Y;

  const labelLines = Array.isArray(label) ? label : (label ? [label] : []);

  return (
    <g className="sequence-message sequence-self-message" data-message-id={layout.messageId}>
      {/* Loopback path (without fill, stroke only) */}
      <path
        d={pathD}
        fill="none"
        stroke={MESSAGE_STROKE_COLOR}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray || undefined}
      />
      {/* Arrowhead on the returning segment */}
      <path
        d={arrowheadPath}
        fill={MESSAGE_STROKE_COLOR}
        stroke={MESSAGE_STROKE_COLOR}
        strokeWidth={1}
      />
      {/* Label above the initial outgoing segment */}
      {labelLines.length > 0 && renderMultiLineLabel(labelLines, labelX, labelY)}
    </g>
  );
};

// ============================================================================
// Task Group 4: Fragment Frame Component
// ============================================================================

interface FragmentFrameProps {
  layout: FragmentLayout;
}

/**
 * Renders a single fragment frame with label.
 * Fragment frames are drawn behind messages to properly contain them.
 */
const FragmentFrame: React.FC<FragmentFrameProps> = ({ layout }) => {
  const displayLabel = getFragmentLabel(layout.fragmentKind, layout.labelText);

  const labelWidth = measureTextWidth(
    displayLabel,
    FRAGMENT_LABEL_FONT_SIZE,
    FRAGMENT_LABEL_FONT_WEIGHT,
    'normal'
  );

  const labelX = layout.leftX + FRAGMENT_LABEL_OFFSET_X;
  const labelY = layout.topY + FRAGMENT_LABEL_OFFSET_Y;

  const labelBgWidth = labelWidth + FRAGMENT_LABEL_PADDING_X * 2;
  const labelBgHeight = FRAGMENT_LABEL_FONT_SIZE + FRAGMENT_LABEL_PADDING_Y * 2;

  const frameWidth = layout.rightX - layout.leftX;
  const frameHeight = layout.bottomY - layout.topY;

  return (
    <g className="sequence-fragment" data-fragment-id={layout.fragmentId}>
      <rect
        x={layout.leftX}
        y={layout.topY}
        width={frameWidth}
        height={frameHeight}
        fill={FRAGMENT_FILL_COLOR}
        stroke={FRAGMENT_STROKE_COLOR}
        strokeWidth={FRAGMENT_STROKE_WIDTH}
      />
      <rect
        x={labelX}
        y={labelY}
        width={labelBgWidth}
        height={labelBgHeight}
        fill={FRAGMENT_LABEL_BG_COLOR}
        stroke={FRAGMENT_STROKE_COLOR}
        strokeWidth={FRAGMENT_STROKE_WIDTH}
      />
      <text
        x={labelX + FRAGMENT_LABEL_PADDING_X}
        y={labelY + FRAGMENT_LABEL_PADDING_Y + FRAGMENT_LABEL_FONT_SIZE * 0.85}
        fontSize={FRAGMENT_LABEL_FONT_SIZE}
        fontWeight={FRAGMENT_LABEL_FONT_WEIGHT}
        fill="#333"
      >
        {displayLabel}
      </text>
    </g>
  );
};

// ============================================================================
// Main Component
// ============================================================================

/**
 * SequenceDiagramRenderer - Renders a complete sequence diagram on SVG canvas.
 *
 * This component:
 * - Computes layout using computeSequenceLayout
 * - Renders participants as headers (box or stickman) with lifelines
 * - Task Group 6: Applies classification-based fill colours and icons
 * - Renders messages as horizontal arrows (Task Group 3)
 * - Renders self-messages as loopback arrows (Self-Message Feature)
 * - Renders fragments as frames (Task Group 4)
 * - Renders redrawn participant headers at computed Y positions for tall diagrams
 */
export const SequenceDiagramRenderer: React.FC<SequenceDiagramRendererProps> = ({
  sequenceDiagram,
  participantSpacing,
  metaModel,
}) => {
  // Resolve labels for all messages (needed before layout for line counts)
  const messageLabels = useMemo(() => {
    const labels = new Map<string, string | string[]>();
    for (const message of sequenceDiagram.messages) {
      const label = resolveMessageLabel(message, metaModel);
      labels.set(message.id, label);
    }
    return labels;
  }, [sequenceDiagram.messages, metaModel]);

  // Build label line counts map for dynamic row height
  const messageLabelLineCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [msgId, label] of messageLabels) {
      counts.set(msgId, getLabelLineCount(label));
    }
    return counts;
  }, [messageLabels]);

  // Compute layout using the pure layout function (with label line counts for dynamic row height)
  const layout: SequenceLayoutResult = useMemo(() => {
    return computeSequenceLayout(sequenceDiagram, participantSpacing, messageLabelLineCounts);
  }, [sequenceDiagram, participantSpacing, messageLabelLineCounts]);

  // Resolve display names for all participants
  const participantNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const participant of sequenceDiagram.participants) {
      const name = resolveParticipantName(
        participant.ref_kind,
        participant.ref_id,
        metaModel
      );
      names.set(participant.id, name);
    }
    return names;
  }, [sequenceDiagram.participants, metaModel]);

  // Task Group 6: Compute classifications for all participants
  const participantClassifications = useMemo(() => {
    const classifications = new Map<string, ParticipantClassification>();
    for (const participant of sequenceDiagram.participants) {
      const classification = classifyParticipant(
        participant.ref_kind,
        participant.ref_id,
        metaModel
      );
      classifications.set(participant.id, classification);
    }
    return classifications;
  }, [sequenceDiagram.participants, metaModel]);

  // Build participant ID set for message validation
  const participantIdSet = useMemo(() => {
    return new Set(sequenceDiagram.participants.map(p => p.id));
  }, [sequenceDiagram.participants]);

  // Build message lookup map
  const messageMap = useMemo(() => {
    const map = new Map<string, SequenceMessage>();
    for (const message of sequenceDiagram.messages) {
      map.set(message.id, message);
    }
    return map;
  }, [sequenceDiagram.messages]);

  // Early return for empty diagram
  if (sequenceDiagram.participants.length === 0) {
    return (
      <g className="sequence-diagram-renderer">
        <text
          x={200}
          y={100}
          textAnchor="middle"
          fontSize={14}
          fill="#666"
        >
          Add participants to begin
        </text>
      </g>
    );
  }

  return (
    <g className="sequence-diagram-renderer">
      {/* Task Group 4: Render fragment frames FIRST (behind messages) */}
      {layout.fragmentLayouts.map((fragmentLayout) => (
        <FragmentFrame
          key={fragmentLayout.fragmentId}
          layout={fragmentLayout}
        />
      ))}

      {/* Render participant headers and lifelines */}
      {layout.participantLayouts.map((participantLayout) => {
        const displayName = participantNames.get(participantLayout.participantId) || participantLayout.refId;
        const isBusinessUser = participantLayout.refKind === 'BusinessUser';
        const classification = participantClassifications.get(participantLayout.participantId) || 'OTHER';

        return (
          <ParticipantHeader
            key={participantLayout.participantId}
            layout={participantLayout}
            displayName={displayName}
            isBusinessUser={isBusinessUser}
            lifelineTopY={layout.lifelineTopY}
            lifelineBottomY={layout.lifelineBottomY}
            classification={classification}
            refKind={participantLayout.refKind}
            participantRedrawYPositions={layout.participantRedrawYPositions}
          />
        );
      })}

      {/* Render redrawn participant headers at each redraw Y position */}
      {layout.participantRedrawYPositions.map((redrawY, redrawIndex) =>
        layout.participantLayouts.map((participantLayout) => {
          const displayName = participantNames.get(participantLayout.participantId) || participantLayout.refId;
          const isBusinessUser = participantLayout.refKind === 'BusinessUser';
          const classification = participantClassifications.get(participantLayout.participantId) || 'OTHER';

          // Create a layout override with the redraw Y position
          const redrawLayout: ParticipantLayout = {
            ...participantLayout,
            y: redrawY,
          };

          return (
            <ParticipantHeader
              key={`participant-redraw-${redrawIndex}-${participantLayout.participantId}`}
              layout={redrawLayout}
              displayName={displayName}
              isBusinessUser={isBusinessUser}
              lifelineTopY={0}
              lifelineBottomY={0}
              classification={classification}
              refKind={participantLayout.refKind}
              participantRedrawYPositions={[]}
            />
          );
        })
      )}

      {/* Task Group 3: Render message arrows */}
      {layout.messageLayouts.map((messageLayout) => {
        const message = messageMap.get(messageLayout.messageId);
        if (!message) {
          return null;
        }

        // Check if message should be rendered (participants exist)
        const renderCheck = shouldRenderMessage(message, participantIdSet);
        if (!renderCheck.shouldRender) {
          // Log warning and skip rendering
          console.warn(
            `[SequenceDiagramRenderer] Skipping message '${message.id}': ${renderCheck.reason}`
          );
          return null;
        }

        const label = messageLabels.get(messageLayout.messageId) || '';

        // Check if this is a self-message
        if (isSelfMessage(message)) {
          return (
            <SelfMessageArrow
              key={messageLayout.messageId}
              layout={messageLayout}
              label={label}
            />
          );
        }

        return (
          <MessageArrow
            key={messageLayout.messageId}
            layout={messageLayout}
            label={label}
          />
        );
      })}
    </g>
  );
};

export default SequenceDiagramRenderer;
