/**
 * Dashboard Insight Generator
 *
 * Generates AI-powered insights for the dashboard summary using the LLM client.
 * Produces two insights:
 *   (a) Header insight (~70 words): overall project health beside the mode badge
 *   (b) Delivery insight: progress summary for the Detailed Definition & Delivery section
 *
 * Both functions gracefully return null on any LLM failure so the dashboard
 * can still render without AI insights.
 */

import { getLlmClient } from './llmClient';
import { getConfig } from '../config';
import { logger } from './logger';
import type { OpenAIMessage } from './openaiClient';

// ============================================================================
// Data Types for Insight Generation
// ============================================================================

/** Data points needed for the header insight (overall project health). */
export interface HeaderInsightData {
  missionExists: boolean;
  missionLastUpdated: string;
  orgTechStackStatus: string;
  productTechStackStatus: string;
  testStrategyExists: boolean;
  testStrategyLastUpdated: string;
  hlaServices: number;
  hlaInterfaces: number;
  hlaDataStores: number;
  businessUserCount: number;
  processActivityCount: number;
  uiScreenCount: number;
  initiativeCount: number;
  epicCount: number;
  epicsCompleted: number;
  epicsInProgress: number;
  featuresCount: number;
  storiesCount: number;
  storiesWithAC: number;
  storiesInProgress: number;
  storiesComplete: number;
}

/** Data points needed for the delivery insight (D&D progress). */
export interface DeliveryInsightData {
  epicsInScope: number;
  featuresCount: number;
  storiesCount: number;
  storiesWithAC: number;
  detailedArchOverall: number;
  interfaceEndpoints: number;
  logicalDataEntities: number;
  physicalDataEntities: number;
  e2eTests: number;
  functionalTests: number;
  featuresInProgress: number;
  storiesInProgress: number;
  storiesComplete: number;
  storiesVerified: number;
  pendingReview: number;
}

// ============================================================================
// Prompt Templates
// ============================================================================

const HEADER_SYSTEM_PROMPT = `You are a concise project health analyst. Given a set of project metrics, write a single paragraph of approximately 60-70 words summarising the overall project health and readiness. Use a neutral, professional tone. Do not use bullet points or headings. Do not start with "The project". Mention strengths and any gaps worth noting. Output only the paragraph text, nothing else.`;

const DELIVERY_SYSTEM_PROMPT = `You are a concise delivery progress analyst. Given a set of definition and delivery metrics for a software project, write a single paragraph of approximately 50-70 words summarising delivery progress, key achievements, and areas that need attention. Use a neutral, professional tone. Do not use bullet points or headings. Output only the paragraph text, nothing else.`;

// ============================================================================
// Generator Functions
// ============================================================================

/**
 * Generates the header insight (~70 words) about overall project health.
 * Returns null if the LLM call fails.
 */
export async function generateHeaderInsight(
  data: HeaderInsightData,
  requestId: string,
): Promise<string | null> {
  const userPrompt = `Project metrics:
- Mission statement: ${data.missionExists ? `exists (last updated ${data.missionLastUpdated})` : 'not defined'}
- Org tech stack: ${data.orgTechStackStatus}
- Product tech stack: ${data.productTechStackStatus}
- Test strategy: ${data.testStrategyExists ? `exists (last updated ${data.testStrategyLastUpdated})` : 'not defined'}
- High-level architecture: ${data.hlaServices} services, ${data.hlaInterfaces} interfaces, ${data.hlaDataStores} data stores
- Users & Interactions: ${data.businessUserCount} user roles, ${data.processActivityCount} business activities, ${data.uiScreenCount} UI screens
- Roadmap: ${data.initiativeCount} initiatives, ${data.epicCount} epics (${data.epicsCompleted} completed, ${data.epicsInProgress} in progress)
- Backlog: ${data.featuresCount} features, ${data.storiesCount} stories (${data.storiesWithAC} with acceptance criteria)
- Implementation: ${data.storiesInProgress} stories in progress, ${data.storiesComplete} stories complete`;

  return callLlmForInsight(HEADER_SYSTEM_PROMPT, userPrompt, requestId, 'header');
}

/**
 * Generates the delivery insight for the D&D Summary Insight card.
 * Returns null if the LLM call fails.
 */
export async function generateDeliveryInsight(
  data: DeliveryInsightData,
  requestId: string,
): Promise<string | null> {
  const acPct = data.storiesCount > 0
    ? Math.round((data.storiesWithAC / data.storiesCount) * 100)
    : 0;

  const userPrompt = `Delivery metrics:
- Backlog: ${data.epicsInScope} epics in scope, ${data.featuresCount} features, ${data.storiesCount} stories (${data.storiesWithAC} with AC, ${acPct}% coverage)
- Detailed architecture: ${data.detailedArchOverall} elements (${data.interfaceEndpoints} interface endpoints, ${data.logicalDataEntities} logical data entities, ${data.physicalDataEntities} physical data entities)
- Testing suite: ${data.e2eTests} E2E tests, ${data.functionalTests} functional tests
- Implementation: ${data.featuresInProgress} features in progress, ${data.storiesInProgress} stories in progress, ${data.storiesComplete} stories complete
- Verification: ${data.storiesVerified} stories verified, ${data.pendingReview} pending review`;

  return callLlmForInsight(DELIVERY_SYSTEM_PROMPT, userPrompt, requestId, 'delivery');
}

// ============================================================================
// Internal Helper
// ============================================================================

async function callLlmForInsight(
  systemPrompt: string,
  userPrompt: string,
  requestId: string,
  insightType: string,
): Promise<string | null> {
  try {
    const client = getLlmClient();

    const messages: OpenAIMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    logger.info(`Dashboard insight LLM call starting (${insightType})`, { requestId });

    // Reasoning models (o1, o3, gpt-5, etc.) include internal chain-of-thought
    // tokens within max_completion_tokens, so the budget must be larger to leave
    // room for visible output after reasoning.
    const isReasoningModel = /^(o[0-9]|gpt-5)/.test(getConfig().openaiModel);
    const maxTokens = isReasoningModel ? 8000 : 2000;

    const response = await client.sendChatRequest(
      messages,
      requestId,
      `dashboard-insight-${insightType}`,
      { temperature: 0.3, maxTokens, tools: [], toolChoice: 'none' },
    );

    const text = response.content?.trim() ?? null;

    if (text) {
      logger.info(`Dashboard insight generated (${insightType})`, {
        requestId,
        length: text.length,
      });
      return text;
    }

    const diagInfo = `empty content (id=${response.id}, isFinal=${response.isFinal}, toolCalls=${!!response.toolCalls?.length})`;
    logger.warn(`Dashboard insight LLM returned ${diagInfo} (${insightType})`, { requestId });
    return `[Insight unavailable: LLM returned ${diagInfo}]`;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logger.warn(`Dashboard insight LLM call failed (${insightType})`, {
      requestId,
      error: errorMessage,
    });
    return `[Insight unavailable: ${errorMessage}]`;
  }
}
