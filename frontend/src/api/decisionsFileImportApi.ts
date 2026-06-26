/**
 * Target-state decisions-file import API client.
 *
 * Spec: 2026-06-26-target-state-decisions-file-import (Spec 3 of 3). Thin client
 * around the single gateway route:
 *
 *   POST /api/projects/{p}/target-architectures/{t}/decisions-file-import  (multipart)
 *
 * Upload a text file of FINAL target-state decisions (the round-trip of the
 * "Preview prompt-ready output") to pre-complete the conversation. The gateway
 * parses + validates (partial-accept; no silent drop), writes each valid answer
 * via the existing captured-decision path (createdByTask='decisions-file-import',
 * import-wins supersession), and returns the override summary, tier-skips, skipped
 * sections, per-line errors, and whether the project is now fully answered. The
 * wire is camelCase (the gateway assembles the response itself).
 */

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Wire types — mirror gateway/src/routes/decisionsFileImport.ts field-for-field.
// ============================================================================

export type DecisionsFileBadLineReason =
  | 'unknown_code'
  | 'value_not_in_choices'
  | 'malformed'
  | 'duplicate_code';

export interface DecisionsFileBadLine {
  lineNumber: number;
  raw: string;
  reason: DecisionsFileBadLineReason;
  decisionCode?: string;
  detail: string;
}

export interface DecisionOverride {
  decisionCode: string;
  prior: string | null;
  next: string;
}

export interface DecisionsFileImportResult {
  written: string[];
  overrides: DecisionOverride[];
  skippedTierCodes: string[];
  skippedSections: string[];
  badLines: DecisionsFileBadLine[];
  failedCodes: string[];
  allAnswered: boolean;
  parsedCount: number;
}

export class DecisionsFileImportApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'DecisionsFileImportApiError';
  }
}

/**
 * Upload one decisions text file. Returns the import result (written / overrides /
 * skipped / bad lines / allAnswered). Throws {@link DecisionsFileImportApiError}
 * on a non-2xx response so the panel can surface it.
 */
export async function uploadDecisionsFile(
  projectId: string,
  targetArchitectureId: string,
  file: File,
  options: { conversationThreadId?: string | null } = {},
): Promise<DecisionsFileImportResult> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/decisions-file-import`;

  const fd = new FormData();
  fd.append('file', file, file.name);
  if (options.conversationThreadId) {
    fd.append('conversationThreadId', options.conversationThreadId);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: fd,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      message = res.statusText || message;
    }
    throw new DecisionsFileImportApiError(res.status, message);
  }
  return (await res.json()) as DecisionsFileImportResult;
}
