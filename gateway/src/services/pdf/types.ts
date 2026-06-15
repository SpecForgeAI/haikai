/**
 * PDF Generation Types
 *
 * Request/response types for the server-side PDF generation endpoint,
 * plus layout types used by the drawing engine.
 */

// ============================================================================
// Request / Response Types
// ============================================================================

export interface PdfGenerationRequest {
  projectId: string;
  projectName: string;
  groups: PdfDiagramGroup[];
}

export interface PdfDiagramGroup {
  businessUserName: string;
  diagrams: PdfDiagramEntry[];
}

export interface PdfDiagramEntry {
  id: string;
  name: string;
  type: 'USER_JOURNEY' | 'USER_JOURNEY_OVERVIEW';
  content: any;
  navLinks?: {
    parentOverview?: { id: string; name: string } | null;
    linkedJourneys?: { id: string; name: string }[];
    coWorkerDiagramMap?: Record<string, string>;
  };
}

export interface PdfGenerationResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

// ============================================================================
// Layout Types
// ============================================================================

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaneRect extends Rect {
  name: string;
  headerRect: Rect;
}

export interface StepPosition extends Rect {
  stepId: string;
}

export interface NodePosition extends Rect {
  nodeId: string;
}

export interface EdgeWaypoint {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TocEntry {
  text: string;
  pageNumber: number;
  isSection: boolean;
  targetDiagramId?: string;
  targetBusinessUserName?: string;
}
