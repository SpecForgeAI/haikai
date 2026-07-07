/**
 * JPA internals scanner (Spec 2026-07-06-m — Spring Classic Internal
 * Functionality, Code-Tier Oracle Program).
 *
 * Two small, parity-relevant captures the estate audit found invisible:
 *
 *   1. ENTITY LIFECYCLE CALLBACKS — `@PrePersist` / `@PostPersist` /
 *      `@PreUpdate` / `@PostUpdate` / `@PreRemove` / `@PostLoad` methods (and
 *      `@EntityListeners` declarations) mutate data INVISIBLY during
 *      persistence operations. Each callback is surfaced as a
 *      `business_logics` candidate (so behaviour capture can pick it up) and
 *      an `entity_lifecycle_callback` Finding (parity concern: the target
 *      must reproduce the mutation).
 *
 *   2. persistence.xml NAMED QUERIES — `<named-query name>` declarations are
 *      SQL the annotation capture never reads. Each is surfaced as a Finding
 *      carrying the query text VERBATIM; queries never referenced from any
 *      scanned `createNamedQuery("...")` call site are flagged unmatched.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SourceFileIR } from '../../languageIR';
import { hasAnnotation, findAnnotation, annotationArg } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { FindingEmitInput } from '../../../findings/FindingEmitter';

const CALLBACK_ANNOTATIONS = [
  'PrePersist',
  'PostPersist',
  'PreUpdate',
  'PostUpdate',
  'PreRemove',
  'PostLoad',
];

export interface JpaInternalsScan {
  callbacks: Array<{
    entityClass: string;
    methodName: string;
    callback: string;
    viaListenerClass: string | null;
    sourceFilePath: string;
  }>;
  namedQueries: Array<{
    name: string;
    query: string;
    referenced: boolean;
    sourceFilePath: string;
  }>;
}

export function scanJpaInternals(files: SourceFileIR[]): JpaInternalsScan {
  const scan: JpaInternalsScan = { callbacks: [], namedQueries: [] };

  // Call-site index for named-query reference matching.
  const referencedNames = new Set<string>();
  for (const file of files) {
    if (file.language !== 'java') continue;
    for (const cls of file.classes) {
      for (const method of cls.methods) {
        for (const call of method.calls ?? []) {
          const name = call.methodName ?? '';
          if (name === 'createNamedQuery' && (call.args?.length ?? 0) > 0) {
            referencedNames.add(call.args[0].trim());
          }
        }
      }
    }
  }

  for (const file of files) {
    if (file.language === 'java') {
      for (const cls of file.classes) {
        const isEntity = hasAnnotation(cls.annotations, 'Entity');
        const listenerAnn = findAnnotation(cls.annotations, 'EntityListeners');
        for (const method of cls.methods) {
          for (const callback of CALLBACK_ANNOTATIONS) {
            if (!hasAnnotation(method.annotations, callback)) continue;
            scan.callbacks.push({
              entityClass: cls.name,
              methodName: method.name,
              callback,
              viaListenerClass: null,
              sourceFilePath: file.filePath,
            });
          }
        }
        if (isEntity && listenerAnn) {
          const listeners = annotationArg(listenerAnn, 'value') ?? '';
          scan.callbacks.push({
            entityClass: cls.name,
            methodName: '(listener)',
            callback: 'EntityListeners',
            viaListenerClass: listeners || null,
            sourceFilePath: file.filePath,
          });
        }
      }
    }

    if (file.language === 'persistence-xml' && typeof file.rawContent === 'string') {
      const xml = file.rawContent;
      const re =
        /<\s*named-query\b[^>]*\bname\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\s*\/\s*named-query\s*>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml)) !== null) {
        const queryText =
          /<\s*query\s*>([\s\S]*?)<\s*\/\s*query\s*>/i.exec(m[2])?.[1] ?? m[2];
        scan.namedQueries.push({
          name: m[1],
          query: queryText.replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
          referenced: referencedNames.has(m[1]),
          sourceFilePath: file.filePath,
        });
      }
    }
  }

  return scan;
}

/** Lifecycle callbacks become `business_logics` candidates (behaviour-capturable). */
export function mintJpaCallbackCandidates(
  scan: JpaInternalsScan,
  runId: string
): DiscoveryCandidate[] {
  return scan.callbacks
    .filter((c) => c.callback !== 'EntityListeners')
    .map((c) => ({
      id: uuidv4(),
      runId,
      candidateType: 'business_logics' as const,
      name: `${c.entityClass}.${c.methodName}`,
      confidence: 0.9,
      status: 'proposed' as const,
      sourceClusterIds: [c.sourceFilePath],
      data: {
        beanKind: 'entity-lifecycle-callback',
        entityClass: c.entityClass,
        methodName: c.methodName,
        callback: c.callback,
        _addedBy: 'spring-classic-adapter',
      },
      synthesizedAt: new Date().toISOString(),
    }));
}

export function buildJpaInternalsFindings(scan: JpaInternalsScan): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const c of scan.callbacks) {
    out.push({
      findingType: 'entity_lifecycle_callback',
      category: 'hidden_logic',
      severity: 'medium',
      title: `Entity lifecycle callback: ${c.entityClass}.${c.methodName} (@${c.callback})`,
      summary:
        `Entity '${c.entityClass}' mutates or reacts to persistence operations via ` +
        `@${c.callback}${c.viaListenerClass ? ` (listener ${c.viaListenerClass})` : ''} — ` +
        `invisible in endpoint code but parity-relevant: the target persistence layer must ` +
        `reproduce this behaviour.`,
      detailJson: {
        entityClass: c.entityClass,
        methodName: c.methodName,
        callback: c.callback,
        listenerClass: c.viaListenerClass,
        filePath: c.sourceFilePath,
      },
    });
  }
  for (const q of scan.namedQueries) {
    out.push({
      findingType: q.referenced ? 'persistence_named_query' : 'persistence_named_query_unmatched',
      category: 'hidden_logic',
      severity: q.referenced ? 'low' : 'medium',
      title: `persistence.xml named query: ${q.name}${q.referenced ? '' : ' (no call site found)'}`,
      summary:
        `Named query '${q.name}' is declared in persistence.xml` +
        (q.referenced
          ? ' and referenced from code.'
          : ' but NO createNamedQuery call site was found in the scanned code — verify whether it is dead or invoked dynamically.'),
      detailJson: {
        name: q.name,
        query: q.query,
        referenced: q.referenced,
        filePath: q.sourceFilePath,
      },
    });
  }
  return out;
}
