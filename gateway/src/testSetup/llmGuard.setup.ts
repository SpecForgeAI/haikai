/**
 * Jest global setup (wired via `setupFiles` in jest.config.js).
 *
 * Runs once per test file, BEFORE the test framework and before any
 * application module is loaded. Overwrites every LLM credential with a
 * sentinel value so that:
 *
 *  - `dotenv.config()` in src/config.ts can never re-introduce the
 *    developer's real `OPENAI_API_KEY` (dotenv does not override env vars
 *    that are already set), and
 *  - the runtime guard in openaiClient.ts / azureOpenaiClient.ts
 *    (`assertNotLlmTestSentinel`) rejects loudly if an un-mocked code path
 *    reaches the real client.
 *
 * Suites that test config loading or the clients themselves set/delete these
 * env vars (or mock `../config`) in their own beforeEach blocks, which run
 * after this file -- so they are unaffected.
 *
 * See src/services/llmTestGuard.ts for the full rationale.
 */

import { LLM_TEST_SENTINEL } from '../services/llmTestGuard';

// OpenAI provider: the api key is the only secret.
process.env.OPENAI_API_KEY = LLM_TEST_SENTINEL;

// Azure OpenAI provider: the basic-auth password gates the bearer-token fetch.
process.env.AZURE_API_PASSWORD = LLM_TEST_SENTINEL;
