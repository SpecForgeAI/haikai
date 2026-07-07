/**
 * Internal-process XML scanner (Spec 2026-07-06-m — Spring Classic Internal
 * Functionality, Code-Tier Oracle Program).
 *
 * Classic estates wire their INTERNAL functionality (criterion B of the
 * oracle: batch jobs, schedulers, listeners) in bean XML the annotation
 * detectors never see. This module reads the spring-xml IR files' verbatim
 * source and extracts, deterministically and VERBATIM (cron expressions,
 * destinations, job graphs are facts to reproduce, never paraphrase):
 *
 *   1. QUARTZ: `MethodInvokingJobDetailFactoryBean` (targetObject ref +
 *      targetMethod), `JobDetailFactoryBean` (jobClass),
 *      `CronTriggerFactoryBean` (cronExpression + jobDetail ref),
 *      `SimpleTriggerFactoryBean` (repeatInterval/startDelay).
 *   2. task: namespace: `<task:scheduled-tasks>` `<task:scheduled ref=
 *      method= cron=|fixed-delay=|fixed-rate=>`, `<task:executor>` /
 *      `<task:scheduler>` pool facts.
 *   3. SPRING BATCH XML: `<batch:job id>` with its `<batch:step>` graph
 *      (`next=`), tasklet `ref`s, chunk reader/processor/writer refs +
 *      commit-interval — the graph is carried VERBATIM as `batch_graph`.
 *   4. XML JMS: `<jms:listener-container>` `<jms:listener destination= ref=
 *      method=>` + `DefaultMessageListenerContainer` beans (destinationName
 *      + messageListener ref).
 *
 * Outputs:
 *   - `mintInternalProcessCandidates` -> `endpoints` candidates (subtype
 *     `quartz-job` / `scheduled` / `batch-job` / `jms-listener`) with the
 *     verbatim metadata on `data` — the same architectural treatment the
 *     annotation-driven listeners already get.
 *   - `xmlEntryTargets` -> (className, methodName, entryName) triples the
 *     data-effect resolver uses as INTERNAL ENTRY POINTS (bean refs resolved
 *     through `springXmlBeans`), so XML-scheduled code gets data-effect
 *     edges + behaviour blocks exactly like HTTP endpoints.
 *   - `attachSelfApiCallLinks` -> v1 self-API-call linkage: an internal
 *     process whose owning class ALSO makes an outbound HTTP call targeting
 *     one of the app's OWN endpoints gets `calls_own_endpoint` stamped
 *     (endpoint parity evidence then partially covers the batch path).
 *
 * Pure + regex-based per the descriptor idiom; never throws on malformed XML.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';

const NS = '(?:[A-Za-z][A-Za-z0-9_-]*:)?';

/**
 * Element-name boundary: `\b` alone treats `-` as a boundary, so
 * `scheduled\b` would match `<task:scheduled-tasks>`. `(?![\w-])` requires
 * the name to end before whitespace / `>` / `/`.
 */
const NAME_END = '(?![\\w-])';

function blocks(xml: string, localName: string): string[] {
  // SELF-CLOSING branch FIRST: with the paired branch first, a self-closing
  // `<bean/>` matches the paired form's opening tag and its lazy body swallows
  // everything up to the NEXT `</bean>` — silently eating sibling elements.
  const re = new RegExp(
    `<\\s*${NS}${localName}${NAME_END}[^>]*/>|<\\s*${NS}${localName}${NAME_END}[^>]*>([\\s\\S]*?)<\\s*/\\s*${NS}${localName}\\s*>`,
    'gi'
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[0]);
  return out;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return m ? m[1] : null;
}

function openTag(block: string): string {
  return block.slice(0, block.indexOf('>') + 1);
}

/** `<property name="x" value="y"/>` or `<property name="x" ref="y"/>`. */
function propertyOf(block: string, name: string): { value: string | null; ref: string | null } {
  const re = new RegExp(`<\\s*${NS}property\\b[^>]*\\bname\\s*=\\s*"${name}"[^>]*/?>`, 'i');
  const m = re.exec(block);
  if (!m) {
    // value as nested <value> text
    const nested = new RegExp(
      `<\\s*${NS}property\\b[^>]*\\bname\\s*=\\s*"${name}"[^>]*>([\\s\\S]*?)<\\s*/\\s*${NS}property\\s*>`,
      'i'
    ).exec(block);
    if (nested) {
      const valueText = new RegExp(
        `<\\s*${NS}value\\s*>([\\s\\S]*?)<\\s*/\\s*${NS}value\\s*>`,
        'i'
      ).exec(nested[1]);
      if (valueText) return { value: valueText[1].trim(), ref: null };
      const refTag = new RegExp(`<\\s*${NS}ref\\b[^>]*\\bbean\\s*=\\s*"([^"]+)"`, 'i').exec(
        nested[1]
      );
      if (refTag) return { value: null, ref: refTag[1] };
    }
    return { value: null, ref: null };
  }
  return { value: attr(m[0], 'value'), ref: attr(m[0], 'ref') };
}

// ---------------------------------------------------------------------------
// Fact shapes
// ---------------------------------------------------------------------------

export interface InternalProcessFact {
  /** quartz-job | scheduled | batch-job | jms-listener */
  subtype: 'quartz-job' | 'scheduled' | 'batch-job' | 'jms-listener';
  /** Candidate name, `<SUBTYPE-UC> <identifier>` per the listener convention. */
  name: string;
  /** Verbatim trigger/schedule/graph metadata (never paraphrased). */
  metadata: Record<string, unknown>;
  /** The implementing class (resolved through bean refs) when known. */
  className: string | null;
  /** The entry method on that class when known. */
  methodName: string | null;
  sourceFilePath: string;
}

export interface ExecutorPoolFact {
  kind: 'executor' | 'scheduler';
  id: string | null;
  poolSize: string | null;
  sourceFilePath: string;
}

export interface InternalProcessXmlScan {
  processes: InternalProcessFact[];
  executorPools: ExecutorPoolFact[];
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

export function scanInternalProcessXml(files: SourceFileIR[]): InternalProcessXmlScan {
  const scan: InternalProcessXmlScan = { processes: [], executorPools: [] };

  const xmlFiles = files.filter(
    (f) => f.language === 'spring-xml' && typeof f.rawContent === 'string'
  );

  for (const file of xmlFiles) {
    const xml = file.rawContent as string;

    // Bean index for ref resolution: beanKey -> {fqn, simple}. The IR types
    // `springXmlBeans` as `unknown`; the parser's shape is stable
    // (SpringBeansXmlResult) — read it defensively.
    const beanClassByKey = new Map<string, { fqn: string | null; simple: string | null }>();
    const parsedBeans =
      (file.springXmlBeans as
        | { beans?: Array<{ beanKey: string; fullyQualifiedClass: string | null; simpleClassName: string | null }> }
        | undefined)?.beans ?? [];
    for (const bean of parsedBeans) {
      beanClassByKey.set(bean.beanKey, {
        fqn: bean.fullyQualifiedClass,
        simple: bean.simpleClassName,
      });
    }
    const classOfRef = (ref: string | null): string | null =>
      ref ? (beanClassByKey.get(ref)?.simple ?? null) : null;

    // Job-detail beans indexed for trigger joins: beanKey -> {className, methodName}.
    const jobDetailByKey = new Map<string, { className: string | null; methodName: string | null; kind: string }>();

    for (const bean of blocks(xml, 'bean')) {
      const tag = openTag(bean);
      const klass = attr(tag, 'class') ?? '';
      const key = attr(tag, 'id') ?? attr(tag, 'name') ?? '';

      if (/MethodInvokingJobDetailFactoryBean$/.test(klass)) {
        const target = propertyOf(bean, 'targetObject');
        const targetMethod = propertyOf(bean, 'targetMethod').value;
        jobDetailByKey.set(key, {
          className: classOfRef(target.ref),
          methodName: targetMethod,
          kind: 'method-invoking',
        });
      } else if (/JobDetailFactoryBean$|\bJobDetailBean$/.test(klass)) {
        const jobClass = propertyOf(bean, 'jobClass').value;
        jobDetailByKey.set(key, {
          className: jobClass ? jobClass.split('.').pop() ?? null : null,
          methodName: 'execute',
          kind: 'job-class',
        });
      } else if (/DefaultMessageListenerContainer$/.test(klass)) {
        const destination =
          propertyOf(bean, 'destinationName').value ?? propertyOf(bean, 'destination').ref;
        const listenerRef = propertyOf(bean, 'messageListener').ref;
        scan.processes.push({
          subtype: 'jms-listener',
          name: `JMS-LISTENER ${destination ?? key ?? 'unknown-destination'}`,
          metadata: {
            destination: destination ?? null,
            container: 'DefaultMessageListenerContainer',
            listener_bean: listenerRef,
            source: 'bean-xml',
          },
          className: classOfRef(listenerRef),
          methodName: 'onMessage',
          sourceFilePath: file.filePath,
        });
      }
    }

    // Triggers join their job detail.
    for (const bean of blocks(xml, 'bean')) {
      const tag = openTag(bean);
      const klass = attr(tag, 'class') ?? '';
      if (/CronTriggerFactoryBean$|\bCronTriggerBean$/.test(klass)) {
        const cron = propertyOf(bean, 'cronExpression').value;
        const jobRef = propertyOf(bean, 'jobDetail').ref;
        const job = jobRef ? jobDetailByKey.get(jobRef) : undefined;
        scan.processes.push({
          subtype: 'quartz-job',
          name: `QUARTZ-JOB ${job?.className ?? jobRef ?? 'unknown-job'}`,
          metadata: {
            trigger: 'cron',
            cron_expression: cron,
            job_detail_bean: jobRef,
            job_detail_kind: job?.kind ?? null,
            source: 'quartz-xml',
          },
          className: job?.className ?? null,
          methodName: job?.methodName ?? null,
          sourceFilePath: file.filePath,
        });
      } else if (/SimpleTriggerFactoryBean$|\bSimpleTriggerBean$/.test(klass)) {
        const jobRef = propertyOf(bean, 'jobDetail').ref;
        const job = jobRef ? jobDetailByKey.get(jobRef) : undefined;
        scan.processes.push({
          subtype: 'quartz-job',
          name: `QUARTZ-JOB ${job?.className ?? jobRef ?? 'unknown-job'}`,
          metadata: {
            trigger: 'simple',
            repeat_interval: propertyOf(bean, 'repeatInterval').value,
            start_delay: propertyOf(bean, 'startDelay').value,
            job_detail_bean: jobRef,
            source: 'quartz-xml',
          },
          className: job?.className ?? null,
          methodName: job?.methodName ?? null,
          sourceFilePath: file.filePath,
        });
      }
    }

    // task: namespace.
    for (const group of blocks(xml, 'scheduled-tasks')) {
      const taskRe = new RegExp(`<\\s*${NS}scheduled${NAME_END}[^>]*/?>`, 'gi');
      let t: RegExpExecArray | null;
      while ((t = taskRe.exec(group)) !== null) {
        const ref = attr(t[0], 'ref');
        const method = attr(t[0], 'method');
        const cron = attr(t[0], 'cron');
        const fixedDelay = attr(t[0], 'fixed-delay');
        const fixedRate = attr(t[0], 'fixed-rate');
        const identifier = cron ?? fixedDelay ?? fixedRate ?? `${ref}#${method}`;
        scan.processes.push({
          subtype: 'scheduled',
          name: `SCHEDULED ${identifier}`,
          metadata: {
            cron: cron,
            fixed_delay: fixedDelay,
            fixed_rate: fixedRate,
            target_bean: ref,
            target_method: method,
            source: 'task-xml',
          },
          className: classOfRef(ref),
          methodName: method,
          sourceFilePath: file.filePath,
        });
      }
    }
    for (const kind of ['executor', 'scheduler'] as const) {
      const re = new RegExp(`<\\s*task:${kind}\\b[^>]*/?>`, 'gi');
      let e: RegExpExecArray | null;
      while ((e = re.exec(xml)) !== null) {
        scan.executorPools.push({
          kind,
          id: attr(e[0], 'id'),
          poolSize: attr(e[0], 'pool-size') ?? attr(e[0], 'size'),
          sourceFilePath: file.filePath,
        });
      }
    }

    // Spring Batch XML: <batch:job> (or <job> under the batch namespace).
    for (const jobBlock of blocks(xml, 'job')) {
      const jobTag = openTag(jobBlock);
      const jobId = attr(jobTag, 'id');
      if (!jobId) continue;
      // Heuristic gate: a Spring-Batch job block contains <step> children.
      const stepRe = new RegExp(
        `<\\s*${NS}step\\b[^>]*>[\\s\\S]*?<\\s*/\\s*${NS}step\\s*>|<\\s*${NS}step\\b[^>]*/>`,
        'gi'
      );
      const steps: Array<Record<string, unknown>> = [];
      let s: RegExpExecArray | null;
      while ((s = stepRe.exec(jobBlock)) !== null) {
        const stepBlock = s[0];
        const stepTag = openTag(stepBlock);
        const taskletRef =
          new RegExp(`<\\s*${NS}tasklet\\b[^>]*\\bref\\s*=\\s*"([^"]+)"`, 'i').exec(stepBlock)?.[1] ??
          null;
        const chunkTag = new RegExp(`<\\s*${NS}chunk\\b[^>]*/?>`, 'i').exec(stepBlock)?.[0] ?? null;
        steps.push({
          id: attr(stepTag, 'id'),
          next: attr(stepTag, 'next'),
          tasklet_ref: taskletRef,
          reader_ref: chunkTag ? attr(chunkTag, 'reader') : null,
          processor_ref: chunkTag ? attr(chunkTag, 'processor') : null,
          writer_ref: chunkTag ? attr(chunkTag, 'writer') : null,
          commit_interval: chunkTag ? attr(chunkTag, 'commit-interval') : null,
        });
      }
      if (steps.length === 0) continue;
      scan.processes.push({
        subtype: 'batch-job',
        name: `BATCH-JOB ${jobId}`,
        metadata: { job_id: jobId, batch_graph: { steps }, source: 'batch-xml' },
        className: null,
        methodName: null,
        sourceFilePath: file.filePath,
      });
    }

    // XML JMS namespace listeners.
    for (const container of blocks(xml, 'listener-container')) {
      const listenerRe = new RegExp(`<\\s*${NS}listener${NAME_END}[^>]*/?>`, 'gi');
      let l: RegExpExecArray | null;
      while ((l = listenerRe.exec(container)) !== null) {
        const destination = attr(l[0], 'destination');
        const ref = attr(l[0], 'ref');
        const method = attr(l[0], 'method') ?? 'onMessage';
        scan.processes.push({
          subtype: 'jms-listener',
          name: `JMS-LISTENER ${destination ?? ref ?? 'unknown-destination'}`,
          metadata: {
            destination,
            listener_bean: ref,
            listener_method: method,
            source: 'jms-xml',
          },
          className: classOfRef(ref),
          methodName: method,
          sourceFilePath: file.filePath,
        });
      }
    }
  }

  return scan;
}

// ---------------------------------------------------------------------------
// Candidate minting + resolver entry targets
// ---------------------------------------------------------------------------

export function mintInternalProcessCandidates(
  scan: InternalProcessXmlScan,
  runId: string
): DiscoveryCandidate[] {
  const out: DiscoveryCandidate[] = [];
  const seen = new Set<string>();
  for (const process of scan.processes) {
    if (seen.has(process.name)) continue;
    seen.add(process.name);
    out.push({
      id: uuidv4(),
      runId,
      candidateType: 'endpoints',
      name: process.name,
      confidence: 0.9,
      status: 'proposed',
      sourceClusterIds: [process.sourceFilePath],
      data: {
        endpoint_subtype: process.subtype,
        className: process.className,
        methodName: process.methodName,
        // Mirrors the annotation-listener emission (index.ts): the identifier
        // rides `fullPath` (structured-metadata gate) and the subtype rides
        // `httpMethod` in its underscore form.
        fullPath: process.name.substring(process.name.indexOf(' ') + 1),
        httpMethod: process.subtype.toUpperCase().replace(/-/g, '_'),
        // Verbatim internal-process metadata (cron / destination / graph):
        // criterion-B facts the plan + spec carriage reproduce exactly.
        internal_process: process.metadata,
        _addedBy: 'spring-classic-adapter',
      },
      synthesizedAt: new Date().toISOString(),
    });
  }
  return out;
}

export interface XmlEntryTarget {
  className: string;
  methodName: string;
  entryName: string;
}

/** Entry-point triples for the data-effect resolver (class+method known only). */
export function xmlEntryTargets(scan: InternalProcessXmlScan): XmlEntryTarget[] {
  const out: XmlEntryTarget[] = [];
  for (const process of scan.processes) {
    if (process.className && process.methodName) {
      out.push({
        className: process.className,
        methodName: process.methodName,
        entryName: process.name,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-API-call linkage (v1)
// ---------------------------------------------------------------------------

const INTERNAL_SUBTYPES = new Set([
  'quartz-job',
  'scheduled',
  'batch-job',
  'jms-listener',
  'kafka-listener',
  'rabbit-listener',
  'sqs-listener',
  'event-listener',
]);

function pathOfTarget(target: string): string | null {
  const m = /https?:\/\/[^/]+(\/\S*)/.exec(target);
  if (m) return m[1].split('?')[0];
  if (target.startsWith('/')) return target.split('?')[0];
  return null;
}

function templateMatches(concrete: string, template: string): boolean {
  if (concrete === template) return true;
  const pattern = template
    .split('/')
    .map((seg) => (/^\{.+\}$/.test(seg) ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${pattern}$`).test(concrete);
}

/**
 * v1 self-call linkage (user estate fact: a batch job may call one of the
 * app's OWN API endpoints): for each INTERNAL endpoint candidate whose
 * `className` also owns an outbound HTTP `data_movements` candidate whose
 * target path matches an OWN HTTP endpoint, stamp
 * `data.calls_own_endpoint: [endpoint names]`. Returns the stamped count.
 */
export function attachSelfApiCallLinks(candidates: DiscoveryCandidate[]): number {
  const httpEndpoints = candidates.filter(
    (c) =>
      c.candidateType === 'endpoints' &&
      typeof (c.data as { fullPath?: unknown }).fullPath === 'string' &&
      !INTERNAL_SUBTYPES.has(String((c.data as { endpoint_subtype?: unknown }).endpoint_subtype ?? ''))
  );
  if (httpEndpoints.length === 0) return 0;

  const outboundByOwner = new Map<string, Array<{ target: string; name: string }>>();
  for (const c of candidates) {
    if (c.candidateType !== 'data_movements') continue;
    const data = c.data as { ownerClassName?: string; target?: string; movementType?: string };
    if (!data.ownerClassName || !data.target) continue;
    if (!/http/i.test(String(data.movementType ?? '')) && !/^https?:|^\//.test(data.target)) continue;
    const list = outboundByOwner.get(data.ownerClassName) ?? [];
    list.push({ target: data.target, name: c.name ?? '' });
    outboundByOwner.set(data.ownerClassName, list);
  }
  if (outboundByOwner.size === 0) return 0;

  let stamped = 0;
  for (const c of candidates) {
    if (c.candidateType !== 'endpoints') continue;
    const data = c.data as {
      endpoint_subtype?: string;
      className?: string;
      calls_own_endpoint?: string[];
    };
    if (!INTERNAL_SUBTYPES.has(String(data.endpoint_subtype ?? ''))) continue;
    if (!data.className) continue;
    const outbound = outboundByOwner.get(data.className) ?? [];
    if (outbound.length === 0) continue;
    const hits: string[] = [];
    for (const call of outbound) {
      const path = pathOfTarget(call.target);
      if (!path) continue;
      for (const ep of httpEndpoints) {
        const epPath = (ep.data as { fullPath: string }).fullPath.split('?')[0];
        if (templateMatches(path, epPath)) hits.push(ep.name ?? epPath);
      }
    }
    if (hits.length > 0) {
      data.calls_own_endpoint = [...new Set(hits)];
      stamped++;
    }
  }
  return stamped;
}
