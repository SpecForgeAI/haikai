/**
 * PDF Export API
 *
 * Client functions for the server-side PDF generation endpoint.
 * Sends pre-enriched diagram data to the gateway, receives a PDF binary
 * download, and triggers a browser save dialog.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export interface PdfDiagramGroup {
  businessUserName: string;
  diagrams: Array<{
    id: string;
    name: string;
    type: 'USER_JOURNEY' | 'USER_JOURNEY_OVERVIEW';
    content: any;
    navLinks?: {
      parentOverview?: { id: string; name: string } | null;
      linkedJourneys?: { id: string; name: string }[];
      coWorkerDiagramMap?: Record<string, string>;
    };
  }>;
}

export interface PdfGenerationRequest {
  projectId: string;
  projectName: string;
  groups: PdfDiagramGroup[];
}

/**
 * Generate a User Journey PDF on the server side.
 * Sends diagram data to the gateway, receives the PDF as a binary blob,
 * triggers a browser download, and returns the server-side file path.
 */
export async function generatePdfOnServer(
  request: PdfGenerationRequest,
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  const url = `${API_BASE}/api/pdf/generate`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    return { success: false, error: errorBody.error || `Server returned ${response.status}` };
  }

  // Get the file path from response header
  const filePath = response.headers.get('X-Pdf-File-Path') || undefined;

  // Trigger browser download from the binary response
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;

  // Extract filename from Content-Disposition header or use default
  const disposition = response.headers.get('Content-Disposition');
  let filename = 'User Journey Diagrams.pdf';
  if (disposition) {
    const match = disposition.match(/filename="?([^"]+)"?/);
    if (match) filename = match[1];
  }
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);

  return { success: true, filePath };
}
