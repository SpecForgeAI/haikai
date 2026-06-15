/**
 * Test-only guard against real LLM calls escaping the jest suite.
 *
 * Problem: `config.ts` runs `dotenv.config()`, so jest workers inherit the
 * developer's REAL `OPENAI_API_KEY` from `.env`. Any suite that exercises a
 * code path reaching `getLlmClient()` / `sendChatRequest` without mocking the
 * LLM layer (e.g. dashboardSummary -> dashboardInsightGenerator) used to make
 * live OpenAI calls on every test run -- burning money and timing out tests.
 *
 * Mechanism (two halves):
 *  1. The jest setup file (`src/testSetup/llmGuard.setup.ts`, wired via
 *     `setupFiles` in jest.config.js) overwrites the LLM secrets in
 *     `process.env` with `LLM_TEST_SENTINEL` BEFORE any module (including
 *     dotenv) loads. dotenv never overrides already-set env vars, so the
 *     sentinel always wins inside jest.
 *  2. The real clients (`openaiClient.ts`, `azureOpenaiClient.ts`) call
 *     `assertNotLlmTestSentinel` at the point where a live network client
 *     would be constructed / a live request sent. If the credential is the
 *     sentinel, the request is from an un-mocked test -- reject loudly.
 *
 * Suites that legitimately test the client mapping logic keep working: they
 * mock `../config` (or pass an explicit Config object) with their own fake
 * credentials ('test-key', 'pass', ...) which are NOT the sentinel, and they
 * mock the transport (the `openai` SDK module or `global.fetch`), so no
 * network is touched and the guard stays silent.
 */

/**
 * Sentinel credential value injected into process.env by the jest setup file.
 * Deliberately not a plausible API key so a leak into any real request would
 * fail authentication immediately even if the guard were bypassed.
 */
export const LLM_TEST_SENTINEL = 'jest-llm-guard-sentinel-do-not-call-real-llm';

/**
 * Throw loudly if the given credential is the jest sentinel, i.e. an
 * un-mocked test is about to make a real LLM call.
 *
 * @param credential - The API key / password the client is about to use
 * @param provider - Human-readable provider name for the error message
 */
export function assertNotLlmTestSentinel(credential: string, provider: string): void {
  if (credential === LLM_TEST_SENTINEL) {
    throw new Error(
      `Test attempted a real ${provider} LLM call -- mock llmClient/openaiClient/` +
      `dashboardInsightGenerator (or the relevant LLM-calling service) in this suite. ` +
      `Real LLM calls are blocked during jest runs by src/testSetup/llmGuard.setup.ts.`
    );
  }
}
