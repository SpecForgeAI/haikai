/**
 * Transcript Export Utility
 *
 * Formats a task segment's messages as a downloadable markdown file
 * and triggers a browser file download.
 *
 * Spec 2026-02-28: Hub Bootstrap 1 -- Product Definition (PM) End-to-End
 * Task Group 6, Task 6.2
 *
 * Spec 2026-03-01: Hub Bootstrap 2 -- Roadmap (PM) End-to-End
 * Task Group 7, Task 7.5: Parameterize buildTranscriptMarkdown
 * - Added artifactDescription parameter to replace hardcoded MISSION.MD marker
 * - Default value maintains backward compatibility for existing callers
 *
 * - buildTranscriptMarkdown: filters messages by taskId, formats as markdown
 *   with persona-attributed sections, appends artifact content as appendix
 * - downloadMarkdownFile: triggers a browser download via Blob + URL.createObjectURL
 */

import type { ThreadMessage } from '../api/chatV2Api';
import { getPersonaConfig } from '../config/personaConfig';

/**
 * Builds a markdown-formatted transcript from thread messages for a specific task.
 *
 * Filters messages to those matching the given taskId (including system messages
 * for context), formats each as a persona-attributed markdown section, and appends
 * the generated artifact content as an appendix.
 *
 * @param messages - All thread messages to filter from
 * @param taskId - The task ID to filter messages by
 * @param artifactContent - The generated artifact content to include as appendix
 * @param artifactDescription - Description of the saved artifact (e.g., 'agent-os/product/MISSION.MD' or 'ROADMAP (initiative/epic structure)')
 * @returns Complete markdown string for the transcript
 */
export function buildTranscriptMarkdown(
  messages: ThreadMessage[],
  taskId: string,
  artifactContent: string,
  artifactDescription: string = 'agent-os/product/MISSION.MD'
): string {
  // Filter messages to those belonging to the specified task
  const taskMessages = messages.filter((msg) => msg.taskId === taskId);

  // Format each message as a markdown section
  const sections = taskMessages.map((msg) => {
    if (msg.role === 'user') {
      return `### You\n\n${msg.content}\n\n`;
    }

    if (msg.role === 'assistant') {
      const persona = getPersonaConfig(msg.personaId || 'unknown');
      return `### ${persona.displayName}\n\n${msg.content}\n\n`;
    }

    // System messages: italic blockquote
    return `> *${msg.content}*\n\n`;
  });

  // Build the complete transcript
  let transcript = sections.join('');

  // Append the artifact appendix
  transcript += `---\n\n## Appendix: Generated Artifact\n\n> Saved artifact: ${artifactDescription}\n\n${artifactContent}`;

  return transcript;
}

/**
 * Triggers a browser file download for a markdown string.
 *
 * Creates a Blob with text/markdown MIME type, generates an object URL,
 * creates a temporary anchor element, triggers a click to initiate the
 * download, and revokes the object URL to free memory.
 *
 * @param content - The markdown content to download
 * @param filename - The filename for the downloaded file (e.g., 'transcript.md')
 */
export function downloadMarkdownFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  URL.revokeObjectURL(url);
}
