/// <reference types="vite/client" />

/**
 * Type declarations for Vite environment variables.
 *
 * These declarations provide TypeScript IntelliSense and type checking
 * for environment variables accessed via import.meta.env.
 *
 * All custom environment variables must be prefixed with VITE_ to be
 * exposed to the client-side code.
 */
interface ImportMetaEnv {
  /**
   * Base URL for the Architecture Model Service API.
   * Used by API modules for model-related endpoints.
   */
  readonly VITE_API_BASE_URL?: string;

  /**
   * Base URL for the Gateway service.
   * Used for orchestration, chat, and Shape-Spec streaming endpoints.
   *
   * Spec 2026-01-30: Centralize Bearer Authentication
   * Shape-Spec streaming now routes through Gateway (uses this variable).
   */
  readonly VITE_GATEWAY_BASE_URL?: string;

  /**
   * Base URL for the Model Service.
   * Used for implement workspace operations.
   */
  readonly VITE_MODEL_SERVICE_BASE_URL?: string;

  /**
   * Target URL for the Model API proxy in development.
   * Configured in vite.config.ts for the dev server proxy.
   */
  readonly VITE_MODEL_API_TARGET?: string;

  /**
   * Target URL for the Chat API proxy in development.
   * Configured in vite.config.ts for the dev server proxy.
   */
  readonly VITE_CHAT_API_TARGET?: string;

  /**
   * @deprecated Since Spec 2026-01-30: Centralize Bearer Authentication
   * Shape-Spec streaming now routes through the Gateway service.
   * Use VITE_GATEWAY_BASE_URL instead (defaults to same-origin).
   *
   * This variable is no longer used by shapeSpecApi.ts.
   */
  readonly VITE_SHAPE_SPEC_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
