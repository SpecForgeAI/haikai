/**
 * Task Group 2 Tests: Vite Proxy Configuration
 *
 * Tests to verify that vite.config.ts is properly configured for proxy routing:
 * - Chat routes (/api/chat, /api/chat/stream) -> Gateway (8081)
 * - All other /api routes -> Model Service (8080)
 *
 * Created as part of spec: 2025-12-16-chat-panel-layout-fix
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Task Group 2: Vite Proxy Configuration', () => {
  // Read the vite.config.ts file content once for all tests
  // __dirname is frontend/src/__tests__, so go up 2 levels to frontend/
  const viteConfigPath = path.resolve(__dirname, '../..', 'vite.config.ts');
  const viteConfigContent = fs.readFileSync(viteConfigPath, 'utf-8');

  describe('2.1.1 vite.config.ts exports valid configuration', () => {
    it('should export a function using defineConfig', () => {
      // The config should use function syntax for loadEnv support
      expect(viteConfigContent).toMatch(/export\s+default\s+defineConfig\s*\(\s*\(\s*\{\s*mode\s*\}\s*\)/);
    });

    it('should import loadEnv from vite', () => {
      expect(viteConfigContent).toMatch(/import\s*\{[^}]*loadEnv[^}]*\}\s*from\s*['"]vite['"]/);
    });

    it('should call loadEnv with mode parameter', () => {
      expect(viteConfigContent).toMatch(/loadEnv\s*\(\s*mode\s*,/);
    });
  });

  describe('2.1.2 proxy routes are defined in correct order (specific before general)', () => {
    it('should have /api/chat/stream proxy route defined', () => {
      expect(viteConfigContent).toMatch(/['"]\/api\/chat\/stream['"]\s*:/);
    });

    it('should have /api/chat proxy route defined', () => {
      // Match /api/chat but not /api/chat/stream
      expect(viteConfigContent).toMatch(/['"]\/api\/chat['"]\s*:/);
    });

    it('should have /api proxy route defined', () => {
      expect(viteConfigContent).toMatch(/['"]\/api['"]\s*:/);
    });

    it('should define /api/chat/stream BEFORE /api in the config file', () => {
      const chatStreamIndex = viteConfigContent.indexOf("'/api/chat/stream'");
      const apiIndex = viteConfigContent.indexOf("'/api'");

      // If single quotes not found, try double quotes
      const chatStreamIndexDbl = viteConfigContent.indexOf('"/api/chat/stream"');
      const apiIndexDbl = viteConfigContent.indexOf('"/api"');

      const finalChatStreamIndex = chatStreamIndex !== -1 ? chatStreamIndex : chatStreamIndexDbl;
      const finalApiIndex = apiIndex !== -1 ? apiIndex : apiIndexDbl;

      expect(finalChatStreamIndex).toBeGreaterThan(-1);
      expect(finalApiIndex).toBeGreaterThan(-1);
      expect(finalChatStreamIndex).toBeLessThan(finalApiIndex);
    });

    it('should define /api/chat BEFORE /api in the config file', () => {
      // Find /api/chat that is NOT /api/chat/stream
      const configLines = viteConfigContent.split('\n');
      let chatLineIndex = -1;
      let apiLineIndex = -1;

      configLines.forEach((line, index) => {
        // Match /api/chat but not /api/chat/stream
        if (line.match(/['"]\/api\/chat['"]/) && chatLineIndex === -1) {
          chatLineIndex = index;
        }
        // Match /api but not /api/chat
        if (line.match(/['"]\/api['"]/) && apiLineIndex === -1) {
          apiLineIndex = index;
        }
      });

      expect(chatLineIndex).toBeGreaterThan(-1);
      expect(apiLineIndex).toBeGreaterThan(-1);
      expect(chatLineIndex).toBeLessThan(apiLineIndex);
    });
  });

  describe('2.1.3 environment variable defaults are applied correctly', () => {
    it('should define modelApiTarget with default http://localhost:8080', () => {
      expect(viteConfigContent).toMatch(/modelApiTarget\s*=.*['"]http:\/\/localhost:8080['"]/);
    });

    it('should define chatApiTarget with default http://localhost:8081', () => {
      expect(viteConfigContent).toMatch(/chatApiTarget\s*=.*['"]http:\/\/localhost:8081['"]/);
    });

    it('should use VITE_MODEL_API_TARGET environment variable', () => {
      expect(viteConfigContent).toMatch(/VITE_MODEL_API_TARGET/);
    });

    it('should use VITE_CHAT_API_TARGET environment variable', () => {
      expect(viteConfigContent).toMatch(/VITE_CHAT_API_TARGET/);
    });

    it('should use chatApiTarget for /api/chat routes', () => {
      // The chat routes should reference chatApiTarget
      expect(viteConfigContent).toMatch(/['"]\/api\/chat['"][\s\S]*?target:\s*chatApiTarget/);
    });

    it('should use modelApiTarget for /api route', () => {
      // The general /api route should reference modelApiTarget
      expect(viteConfigContent).toMatch(/['"]\/api['"][\s\S]*?target:\s*modelApiTarget/);
    });
  });
});
