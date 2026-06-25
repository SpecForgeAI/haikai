/**
 * Task Group 1 tests — Manifest upload + resolver-backed parsing.
 *
 * Spec: 2026-06-24-target-dependency-manifest-auto-answer (Spec 3), task 1.1.
 *
 * Scope (2-8 focused tests): exercises the upload→parse seam through the route
 * handler `buildTargetManifestUploadResponse` (no Express server needed — the
 * handler operates on the in-memory multer file buffers directly):
 *   (a) a pom.xml tagged to a module produces DeclaredDependency[] via the
 *       (gateway-local) resolver port;
 *   (b) a package.json across dependencies/devDependencies produces rows;
 *   (c) a dropped/unparseable file is LOGGED (no silent drop) AND surfaced in
 *       the response;
 *   (d) multiple manifests each retain their per-module/service tag.
 *
 * Lockfile pinning + property/BOM resolution are Group 2; auto-answer is Group 3.
 */

import { logger } from '../../logger';
import {
  buildTargetManifestUploadResponse,
  detectManifestKind,
  isPackageLock,
} from '../../../routes/targetManifestUpload';

function file(originalname: string, content: string): Express.Multer.File {
  return {
    fieldname: 'files',
    originalname,
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    size: Buffer.byteLength(content),
    buffer: Buffer.from(content, 'utf-8'),
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
  };
}

const POM = `<?xml version="1.0"?>
<project>
  <groupId>com.example</groupId>
  <artifactId>svc</artifactId>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
      <version>3.4.1</version>
    </dependency>
    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId>
      <version>\${jackson.version}</version>
    </dependency>
  </dependencies>
</project>`;

const PKG = JSON.stringify({
  name: 'web',
  dependencies: { react: '^18.2.0', axios: '1.6.2' },
  devDependencies: { vitest: '^1.0.0' },
});

describe('target-manifest upload + resolver-backed parsing (Group 1)', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('(a) parses a tagged pom.xml into DeclaredDependency[] (versions verbatim, incl. ${...})', () => {
    const res = buildTargetManifestUploadResponse(
      [file('pom.xml', POM)],
      { tags: 'orders-service' },
      { projectId: 'p1', targetArchitectureId: 't1' },
    );
    expect(res.parsedManifests).toHaveLength(1);
    const m = res.parsedManifests[0];
    expect(m.ecosystem).toBe('MAVEN');
    expect(m.tag).toBe('orders-service');
    expect(m.manifestPath).toBe('pom.xml');
    expect(m.rawPomContent).toContain('<artifactId>svc</artifactId>');

    const byName = Object.fromEntries(m.declaredDependencies.map((d) => [d.name, d]));
    expect(byName['org.springframework.boot:spring-boot-starter-web'].version).toBe('3.4.1');
    // Verbatim ${...} placeholder preserved (NO resolution in Group 1).
    expect(byName['com.fasterxml.jackson.core:jackson-databind'].version).toBe('${jackson.version}');
    expect(res.summary.totalDeclaredDependencies).toBe(2);
  });

  it('(b) parses a package.json across dependencies + devDependencies', () => {
    const res = buildTargetManifestUploadResponse(
      [file('package.json', PKG)],
      { tags: 'web-ui' },
      { projectId: 'p1', targetArchitectureId: 't1' },
    );
    expect(res.parsedManifests).toHaveLength(1);
    const m = res.parsedManifests[0];
    expect(m.ecosystem).toBe('NPM');
    expect(m.tag).toBe('web-ui');
    const scopes = m.declaredDependencies.reduce<Record<string, string>>((acc, d) => {
      acc[d.name] = d.scope;
      return acc;
    }, {});
    expect(scopes['react']).toBe('dependencies');
    expect(scopes['axios']).toBe('dependencies');
    expect(scopes['vitest']).toBe('devDependencies');
    // Verbatim version ranges preserved.
    const react = m.declaredDependencies.find((d) => d.name === 'react')!;
    expect(react.version).toBe('^18.2.0');
    expect(react.versionRange).toBe('^18.2.0');
  });

  it('(c) drops + LOGS an unparseable package.json and an unsupported file (no silent drop)', () => {
    const res = buildTargetManifestUploadResponse(
      [
        file('package.json', '{ this is : not json'),
        file('build.gradle', 'plugins { id "java" }'),
      ],
      { tags: ['svc-a', 'svc-b'] },
      { projectId: 'p1', targetArchitectureId: 't1' },
    );
    expect(res.parsedManifests).toHaveLength(0);
    expect(res.droppedManifests).toHaveLength(2);
    const reasons = res.droppedManifests.map((d) => d.reason).join(' | ');
    expect(reasons).toMatch(/not valid JSON|did not parse/);
    expect(reasons).toMatch(/Unsupported file/);
    // No silent drop: each drop was logged.
    expect(warnSpy).toHaveBeenCalled();
    const loggedPaths = warnSpy.mock.calls.map((c) => (c[1] as { manifestPath?: string })?.manifestPath);
    expect(loggedPaths).toContain('package.json');
    expect(loggedPaths).toContain('build.gradle');
  });

  it('(d) keeps each manifest tagged to its own module/service across multiple uploads', () => {
    const res = buildTargetManifestUploadResponse(
      [file('pom.xml', POM), file('package.json', PKG)],
      { tagsByFilename: JSON.stringify({ 'pom.xml': 'orders-service', 'package.json': 'web-ui' }) },
      { projectId: 'p1', targetArchitectureId: 't1' },
    );
    expect(res.parsedManifests).toHaveLength(2);
    const tagByEco = Object.fromEntries(res.parsedManifests.map((m) => [m.ecosystem, m.tag]));
    expect(tagByEco['MAVEN']).toBe('orders-service');
    expect(tagByEco['NPM']).toBe('web-ui');
  });

  it('(e) rejects an untagged manifest with a clear reason (does not silently accept)', () => {
    const res = buildTargetManifestUploadResponse(
      [file('pom.xml', POM)],
      {}, // no tags supplied at all
      { projectId: 'p1', targetArchitectureId: 't1' },
    );
    expect(res.parsedManifests).toHaveLength(0);
    expect(res.droppedManifests).toHaveLength(1);
    expect(res.droppedManifests[0].reason).toMatch(/Missing required target module\/service tag/);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('(f) detectManifestKind / isPackageLock helpers classify filenames correctly', () => {
    expect(detectManifestKind('pom.xml')).toBe('pom.xml');
    expect(detectManifestKind('services/orders/pom.xml')).toBe('pom.xml');
    expect(detectManifestKind('package.json')).toBe('package.json');
    expect(detectManifestKind('build.gradle')).toBeNull();
    expect(isPackageLock('package-lock.json')).toBe(true);
    expect(isPackageLock('package.json')).toBe(false);
  });
});
