import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on mode
  const env = loadEnv(mode, process.cwd(), '')

  // API proxy targets with fallback defaults
  const modelApiTarget = env.VITE_MODEL_API_TARGET || 'http://localhost:8080'
  const chatApiTarget = env.VITE_CHAT_API_TARGET || 'http://localhost:8081'

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@components': path.resolve(__dirname, './src/components'),
        '@contexts': path.resolve(__dirname, './src/contexts'),
        '@types': path.resolve(__dirname, './src/types'),
        '@utils': path.resolve(__dirname, './src/utils'),
        '@config': path.resolve(__dirname, './src/config'),
      },
    },
    server: {
      proxy: {
        // Chat routes - MUST come before /api to match first
        '/api/chat/stream': {
          target: chatApiTarget,
          changeOrigin: true,
          secure: false,
        },
        '/api/chat': {
          target: chatApiTarget,
          changeOrigin: true,
          secure: false,
        },
        // Implement conversation and state routes - MUST come before /api to match first
        '/api/implement-conversations': {
          target: chatApiTarget,
          changeOrigin: true,
          secure: false,
        },
        '/api/implement-state': {
          target: chatApiTarget,
          changeOrigin: true,
          secure: false,
        },
        // Dashboard routes - proxied to gateway
        '/api/dashboard': {
          target: chatApiTarget,
          changeOrigin: true,
          secure: false,
        },
        // Architecture explainer route - proxied to gateway
        '/api/architecture-explainer': {
          target: chatApiTarget,
          changeOrigin: true,
          secure: false,
        },
        // PDF export route - proxied to gateway
        '/api/pdf': {
          target: chatApiTarget,
          changeOrigin: true,
          secure: false,
        },
        // Gateway v1 API routes - MUST come before /api to match first
        '/api/v1': {
          target: chatApiTarget,
          changeOrigin: true,
          secure: false,
        },
        // Gateway v2 API routes (shape-spec, jobs) - MUST come before /api to match first
        '/api/v2': {
          target: chatApiTarget,
          changeOrigin: true,
          secure: false,
        },
        // Jira sync routes (Phase B/C/D) - proxied to gateway
        '/api/jira/sync': {
          target: chatApiTarget,
          changeOrigin: true,
          secure: false,
        },
        // Jira roadmap import - proxied to gateway
        '/api/roadmap/jira': {
          target: chatApiTarget,
          changeOrigin: true,
          secure: false,
        },
        // Architect Conversation routes are gateway-ORCHESTRATED (file-based
        // conversation thread + captured-decisions aggregation + LLM loop), NOT
        // AMS pass-throughs. AMS has no controller for them, so they must reach
        // the gateway, not the model service. These live under a dynamic
        // target-architectures path, so a RegExp key is required (Vite treats a
        // proxy key starting with `^` as a RegExp). MUST come before `/api`.
        '^/api/projects/[^/]+/target-architectures/[^/]+/architect-conversation': {
          target: chatApiTarget,
          changeOrigin: true,
          secure: false,
        },
        // Architect Conversation question-library scope projection -- gateway-
        // owned (derived from the gateway question library); AMS has no such
        // route. MUST come before `/api`.
        '/api/architect-conversation': {
          target: chatApiTarget,
          changeOrigin: true,
          secure: false,
        },
        // Implementation-Service project init + repo CRUD + build-results
        // routes are gateway-owned (proxied to the implement-verify-service via
        // the gateway, with AMS persistence). AMS has no controller for them,
        // so they must reach the gateway, not the model service -- otherwise
        // Spring answers "No static resource api/implementation/...". MUST come
        // before `/api`.
        '/api/implementation': {
          target: chatApiTarget,
          changeOrigin: true,
          secure: false,
        },
        // All other /api routes
        '/api': {
          target: modelApiTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/setupTests.ts'],
    },
  }
})
