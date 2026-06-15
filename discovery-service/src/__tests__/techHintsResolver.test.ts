/**
 * Tests for techHintsResolver + POST /discovery/tech-hints/resolve route.
 *
 * Spec 2026-04-20: Tech Hints LLM Resolution — Task Group 2
 *
 * Covered:
 *  1. Happy path tech-only (no repo fields): confidence 'tech-only',
 *     repoCrossCheck null, packs drawn from registry.
 *  2. Happy path tech + repo: shallow clone invoked, snapshot included in
 *     prompt, repoCrossCheck.status: 'confirmed'.
 *  3. Clone non-timeout failure: 200 response with confidence 'tech-only'
 *     + repoCrossCheck.status: 'partial' + structured log reason: 'network_error'.
 *  4. LLM malformed response (pack name not in registry): 502 with reason 'llm_malformed'.
 *  5. LLM timeout: 502 with reason 'llm_timeout'.
 *  6. Snapshot cap test: >30 files + >100-line manifest truncated with marker.
 *  7. Validation: missing freeText returns 400.
 */

jest.mock('dotenv', () => ({ config: jest.fn() }));

import express from 'express';
import request from 'supertest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Mock the extensionPackRegistry to return a deterministic closed set.
jest.mock('../services/extensionPackRegistry', () => {
  return {
    getRegisteredPacks: jest.fn(() => [
      { id: 'java-lang', kind: 'language', when: { language: 'Java' } },
      { id: 'python-lang', kind: 'language', when: { language: 'Python' } },
      { id: 'java-spring-boot', kind: 'framework', when: { language: 'Java', technology: 'Spring Boot' } },
      { id: 'spring-classic', kind: 'framework', when: { language: 'Java', technology: 'Spring' } },
      { id: 'flask', kind: 'framework', when: { language: 'Python', technology: 'Flask' } },
    ]),
  };
});

// Mock repoAccess so we control clone outcome without touching git.
const mockCloneRepo = jest.fn();
const mockCleanup = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/repoAccess', () => {
  const actual = jest.requireActual('../services/repoAccess');
  return {
    ...actual,
    gitCloneRepoAccess: {
      cloneRepo: (...args: unknown[]) => mockCloneRepo(...args),
      cleanup: (...args: unknown[]) => mockCleanup(...args),
    },
    GitCloneRepoAccess: class {
      cloneRepo(...args: unknown[]) { return mockCloneRepo(...args); }
      cleanup(...args: unknown[]) { return mockCleanup(...args); }
    },
  };
});

// Mock the gateway client (LLM transport). We also re-export the
// TechHintsLlmError class so `instanceof` checks inside the resolver
// remain reference-identical to the import under test.
class MockTechHintsLlmError extends Error {
  reason: 'llm_timeout' | 'network_error' | 'llm_malformed';
  status: number | null;
  constructor(
    message: string,
    reason: 'llm_timeout' | 'network_error' | 'llm_malformed',
    status: number | null,
  ) {
    super(message);
    this.name = 'TechHintsLlmError';
    this.reason = reason;
    this.status = status;
  }
}
const mockCallLlm = jest.fn();
jest.mock('../services/gatewayClient', () => ({
  gatewayClient: {
    callTechHintsLlm: (...args: unknown[]) => mockCallLlm(...args),
  },
  TechHintsLlmError: MockTechHintsLlmError,
}));

// Import under test AFTER mocks.
import { techHintsResolveRouter } from '../routes/techHintsResolve';

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/discovery/tech-hints', techHintsResolveRouter);
  return app;
}

// Shared helpers
async function makeTempRepo(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tech-hints-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
  }
  return dir;
}

describe('POST /discovery/tech-hints/resolve', () => {
  const app = buildApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('tech-only (no repo fields): returns tech-only confidence and draws packs from registry', async () => {
    mockCallLlm.mockResolvedValueOnce({
      content: JSON.stringify({
        language: { name: 'Java', version: '21' },
        frameworks: [{ name: 'Spring Boot', version: '3' }],
        languagePack: 'java-lang',
        frameworkPacks: ['java-spring-boot'],
        confirmationSentence: 'Detected Java service using Spring Boot.',
        repoCrossCheck: null,
        confidence: 'tech-only',
      }),
    });

    const res = await request(app)
      .post('/discovery/tech-hints/resolve')
      .send({ freeText: 'Java 21 (Spring Boot 3)' });

    expect(res.status).toBe(200);
    expect(res.body.languagePack).toBe('java-lang');
    expect(res.body.frameworkPacks).toEqual(['java-spring-boot']);
    expect(res.body.repoCrossCheck).toBeNull();
    expect(res.body.confidence).toBe('tech-only');
    // Did NOT attempt a clone
    expect(mockCloneRepo).not.toHaveBeenCalled();
  });

  it('tech + repo: clones repo, includes snapshot in prompt, returns confirmed status', async () => {
    const tmpRepo = await makeTempRepo({
      'pom.xml': '<project>\n  <dependency><groupId>org.springframework.boot</groupId></dependency>\n</project>',
      'README.md': '# Orders Service',
      'src/main/java/Main.java': 'public class Main {}',
    });
    mockCloneRepo.mockResolvedValueOnce(tmpRepo);

    mockCallLlm.mockImplementationOnce(async (prompt: string) => {
      // Assert the snapshot text and filename listing appear in the prompt.
      expect(prompt).toContain('pom.xml');
      expect(prompt).toContain('springframework.boot');
      expect(prompt).toContain('README.md');
      return {
        content: JSON.stringify({
          language: { name: 'Java', version: '21' },
          frameworks: [{ name: 'Spring Boot', version: '3' }],
          languagePack: 'java-lang',
          frameworkPacks: ['java-spring-boot'],
          confirmationSentence: 'pom.xml confirms Spring Boot.',
          repoCrossCheck: { status: 'confirmed', note: 'pom.xml confirms Spring Boot 3.' },
          confidence: 'high',
        }),
      };
    });

    const res = await request(app)
      .post('/discovery/tech-hints/resolve')
      .send({
        freeText: 'Java 21 (Spring Boot 3)',
        repoLocation: 'https://github.com/acme/orders.git',
        repoSubfolder: '',
      });

    expect(res.status).toBe(200);
    expect(res.body.repoCrossCheck).toEqual({
      status: 'confirmed',
      note: 'pom.xml confirms Spring Boot 3.',
    });
    expect(res.body.confidence).toBe('high');
    expect(mockCloneRepo).toHaveBeenCalledTimes(1);
    expect(mockCleanup).toHaveBeenCalledTimes(1);
  });

  it('clone non-timeout failure falls back to tech-only, 200 with partial status, logs reason network_error', async () => {
    // All three branch candidates ('main', 'master', 'develop') fail with
    // the same non-timeout error.
    mockCloneRepo.mockRejectedValueOnce(new Error('authentication failed'));
    mockCloneRepo.mockRejectedValueOnce(new Error('authentication failed'));
    mockCloneRepo.mockRejectedValueOnce(new Error('authentication failed'));
    const errorLogs: unknown[][] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => { errorLogs.push(args); };

    try {
      mockCallLlm.mockResolvedValueOnce({
        content: JSON.stringify({
          language: { name: 'Java', version: '21' },
          frameworks: [],
          languagePack: 'java-lang',
          frameworkPacks: [],
          confirmationSentence: 'Java 21 — no framework deduced.',
          repoCrossCheck: null,
          confidence: 'tech-only',
        }),
      });

      const res = await request(app)
        .post('/discovery/tech-hints/resolve')
        .send({
          freeText: 'Java 21',
          repoLocation: 'https://github.com/private/repo.git',
        });

      expect(res.status).toBe(200);
      expect(res.body.confidence).toBe('tech-only');
      expect(res.body.repoCrossCheck).toEqual({
        status: 'partial',
        note: expect.stringContaining('authentication failed'),
      });

      // Verify the structured log reason was emitted.
      const joined = errorLogs.map(args => args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')).join('\n');
      expect(joined).toContain('"reason":"network_error"');
    } finally {
      console.error = origError;
    }
  });

  it('falls back to master branch when main branch is not found', async () => {
    const tmpRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'tech-hints-test-'));
    await fs.writeFile(
      path.join(tmpRepo, 'pom.xml'),
      '<project><groupId>com.example</groupId></project>',
    );

    // 'main' rejects with branch-not-found, 'master' succeeds.
    mockCloneRepo.mockRejectedValueOnce(
      new Error("fatal: Remote branch main not found in upstream origin"),
    );
    mockCloneRepo.mockResolvedValueOnce(tmpRepo);

    mockCallLlm.mockResolvedValueOnce({
      content: JSON.stringify({
        language: { name: 'Java', version: '21' },
        frameworks: [{ name: 'Spring Boot', version: '3' }],
        languagePack: 'java-lang',
        frameworkPacks: ['java-spring-boot'],
        confirmationSentence: 'Java 21 with Spring Boot 3 (from master branch).',
        repoCrossCheck: { status: 'confirmed', note: 'pom.xml confirms Spring Boot.' },
        confidence: 'high',
      }),
    });

    const res = await request(app)
      .post('/discovery/tech-hints/resolve')
      .send({
        freeText: 'Java 21 (Spring Boot 3)',
        repoLocation: 'https://github.com/example/legacy-repo.git',
      });

    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe('high');
    expect(res.body.repoCrossCheck?.status).toBe('confirmed');
    expect(mockCloneRepo).toHaveBeenCalledTimes(2);
    expect(mockCloneRepo).toHaveBeenNthCalledWith(1, expect.any(String), 'main', expect.any(String));
    expect(mockCloneRepo).toHaveBeenNthCalledWith(2, expect.any(String), 'master', expect.any(String));
    expect(mockCleanup).toHaveBeenCalledTimes(1);
  });

  it('falls back to develop branch when both main and master are missing (gitflow repos)', async () => {
    const tmpRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'tech-hints-test-'));
    await fs.writeFile(
      path.join(tmpRepo, 'pom.xml'),
      '<project><groupId>com.example</groupId></project>',
    );

    // 'main' rejects, 'master' rejects, 'develop' succeeds.
    mockCloneRepo.mockRejectedValueOnce(
      new Error('fatal: Remote branch main not found in upstream origin'),
    );
    mockCloneRepo.mockRejectedValueOnce(
      new Error('fatal: Remote branch master not found in upstream origin'),
    );
    mockCloneRepo.mockResolvedValueOnce(tmpRepo);

    mockCallLlm.mockResolvedValueOnce({
      content: JSON.stringify({
        language: { name: 'Java', version: '21' },
        frameworks: [{ name: 'Spring Boot', version: '3' }],
        languagePack: 'java-lang',
        frameworkPacks: ['java-spring-boot'],
        confirmationSentence: 'Java 21 with Spring Boot 3 (from develop branch).',
        repoCrossCheck: { status: 'confirmed', note: 'pom.xml confirms Spring Boot.' },
        confidence: 'high',
      }),
    });

    const res = await request(app)
      .post('/discovery/tech-hints/resolve')
      .send({
        freeText: 'Java 21 (Spring Boot 3)',
        repoLocation: 'https://github.com/example/gitflow-repo.git',
      });

    expect(res.status).toBe(200);
    expect(mockCloneRepo).toHaveBeenCalledTimes(3);
    expect(mockCloneRepo).toHaveBeenNthCalledWith(1, expect.any(String), 'main', expect.any(String));
    expect(mockCloneRepo).toHaveBeenNthCalledWith(2, expect.any(String), 'master', expect.any(String));
    expect(mockCloneRepo).toHaveBeenNthCalledWith(3, expect.any(String), 'develop', expect.any(String));
    expect(mockCleanup).toHaveBeenCalledTimes(1);
  });

  it('LLM returns a pack name not in registry → 502 with reason llm_malformed', async () => {
    mockCallLlm.mockResolvedValueOnce({
      content: JSON.stringify({
        language: { name: 'Java', version: '21' },
        frameworks: [{ name: 'Bogus', version: '1' }],
        languagePack: 'java-lang',
        frameworkPacks: ['bogus-pack-id'], // not in registry
        confirmationSentence: 'X',
        repoCrossCheck: null,
        confidence: 'high',
      }),
    });

    const res = await request(app)
      .post('/discovery/tech-hints/resolve')
      .send({ freeText: 'Java with something weird' });

    expect(res.status).toBe(502);
    expect(res.body.reason).toBe('llm_malformed');
  });

  it('LLM timeout → 502 with reason llm_timeout', async () => {
    // Emulate the gateway client's error shape so the resolver's
    // `instanceof TechHintsLlmError` branch fires.
    mockCallLlm.mockRejectedValueOnce(
      new MockTechHintsLlmError('timeout of 10000ms exceeded', 'llm_timeout', null),
    );

    const res = await request(app)
      .post('/discovery/tech-hints/resolve')
      .send({ freeText: 'Java 21 (Spring Boot 3)' });

    expect(res.status).toBe(502);
    expect(res.body.reason).toBe('llm_timeout');
  });

  it('snapshot cap: repo with >30 files + >100-line manifest is truncated with marker', async () => {
    const files: Record<string, string> = {};
    // 40 sibling files at root
    for (let i = 0; i < 40; i++) {
      files[`file_${String(i).padStart(3, '0')}.txt`] = `content-${i}`;
    }
    // A long pom.xml — 150 lines
    const longManifestLines: string[] = [];
    for (let i = 0; i < 150; i++) longManifestLines.push(`<line-${i}>value</line-${i}>`);
    files['pom.xml'] = longManifestLines.join('\n');

    const tmpRepo = await makeTempRepo(files);
    mockCloneRepo.mockResolvedValueOnce(tmpRepo);

    let capturedPrompt = '';
    mockCallLlm.mockImplementationOnce(async (prompt: string) => {
      capturedPrompt = prompt;
      return {
        content: JSON.stringify({
          language: { name: 'Java', version: '21' },
          frameworks: [],
          languagePack: 'java-lang',
          frameworkPacks: [],
          confirmationSentence: 'Java, no framework.',
          repoCrossCheck: { status: 'partial', note: 'No framework deduced from manifests.' },
          confidence: 'low',
        }),
      };
    });

    const res = await request(app)
      .post('/discovery/tech-hints/resolve')
      .send({
        freeText: 'Java',
        repoLocation: 'https://github.com/acme/bigrepo.git',
      });

    expect(res.status).toBe(200);

    // Count filename entries in the prompt: exactly 30
    const filenameMatches = capturedPrompt.match(/file_\d{3}\.txt/g) || [];
    // We allow exactly 30 filenames from the 40 present (plus pom.xml could be extra)
    expect(filenameMatches.length).toBeLessThanOrEqual(30);
    expect(filenameMatches.length).toBe(30);

    // pom.xml manifest truncation marker
    expect(capturedPrompt).toContain('... [truncated]');
    // No more than 100 lines of pom.xml captured — check line-100 through line-149 are absent
    expect(capturedPrompt).not.toMatch(/<line-100>/);
    expect(capturedPrompt).not.toMatch(/<line-149>/);
    // line-99 should appear
    expect(capturedPrompt).toMatch(/<line-99>/);
  });

  it('local repo path (no git:// prefix) skips clone and snapshots from disk directly', async () => {
    // Create an actual on-disk folder with a pom.xml — no .git directory.
    const localDir = await makeTempRepo({
      'pom.xml': '<project><groupId>com.example</groupId><artifactId>local-app</artifactId></project>',
      'README.md': '# Local folder, not a git repo',
    });

    mockCallLlm.mockResolvedValueOnce({
      content: JSON.stringify({
        language: { name: 'Java', version: '21' },
        frameworks: [{ name: 'Spring Boot', version: '3' }],
        languagePack: 'java-lang',
        frameworkPacks: ['java-spring-boot'],
        confirmationSentence: 'Java 21 with Spring Boot 3 (from local folder).',
        repoCrossCheck: { status: 'confirmed', note: 'pom.xml confirms Spring Boot.' },
        confidence: 'high',
      }),
    });

    const res = await request(app)
      .post('/discovery/tech-hints/resolve')
      .send({
        freeText: 'Java 21 (Spring Boot 3)',
        repoLocation: localDir, // OS path, not a URL
      });

    expect(res.status).toBe(200);
    expect(mockCloneRepo).not.toHaveBeenCalled();
    expect(mockCleanup).not.toHaveBeenCalled();
    expect(res.body.repoCrossCheck?.status).toBe('confirmed');
    expect(res.body.confidence).toBe('high');
  });

  it('local repo path with repo_subfolder joins before snapshot', async () => {
    const localDir = await makeTempRepo({
      'services/orders/pom.xml': '<project><artifactId>orders</artifactId></project>',
    });

    mockCallLlm.mockResolvedValueOnce({
      content: JSON.stringify({
        language: { name: 'Java' },
        frameworks: [],
        languagePack: 'java-lang',
        frameworkPacks: [],
        confirmationSentence: 'Java.',
        repoCrossCheck: { status: 'partial', note: 'No framework deduced.' },
        confidence: 'low',
      }),
    });

    const res = await request(app)
      .post('/discovery/tech-hints/resolve')
      .send({
        freeText: 'Java',
        repoLocation: localDir,
        repoSubfolder: 'services/orders',
      });

    expect(res.status).toBe(200);
    expect(mockCloneRepo).not.toHaveBeenCalled();
  });

  it('local repo path that does not exist → 200 tech-only with partial cross-check', async () => {
    mockCallLlm.mockResolvedValueOnce({
      content: JSON.stringify({
        language: { name: 'Java' },
        frameworks: [],
        languagePack: 'java-lang',
        frameworkPacks: [],
        confirmationSentence: 'Java (no repo).',
        repoCrossCheck: null,
        confidence: 'high',
      }),
    });

    const res = await request(app)
      .post('/discovery/tech-hints/resolve')
      .send({
        freeText: 'Java',
        repoLocation: path.join(os.tmpdir(), 'definitely-does-not-exist-' + Date.now()),
      });

    expect(res.status).toBe(200);
    expect(mockCloneRepo).not.toHaveBeenCalled();
    expect(res.body.confidence).toBe('tech-only');
    expect(res.body.repoCrossCheck?.status).toBe('partial');
  });

  it('missing freeText returns 400', async () => {
    const res = await request(app)
      .post('/discovery/tech-hints/resolve')
      .send({});
    expect(res.status).toBe(400);
  });
});
