# Raw Idea

Add AzureOpenAI LLM provider support alongside existing OpenAI provider. The gateway currently only supports OpenAI via the official SDK. This spec adds a configurable `llmProvider` switch and a new AzureOpenAI provider that uses hand-crafted HTTP requests with two-step auth (token fetch + chat request). Both providers sit behind a common LlmClient interface with a factory pattern.
