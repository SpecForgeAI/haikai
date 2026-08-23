/**
 * Oracle Nine item 9 — deterministic ConversionPattern -> recipe translation.
 */

import {
  renderDateFormatRegex,
  translateConversionPattern,
  recipeFromConversionPattern,
} from '../logPatternTranslation';
import { extractWithRecipeFromContent } from '../recipeAwareExtractor';
import type { SampleBlock } from '../logPreScanSampler';

function blockOf(text: string, index = 0): SampleBlock {
  return {
    hitLineIndex: index,
    byteOffset: 0,
    startLineIndex: index,
    endLineIndex: index + text.split('\n').length - 1,
    text,
    fromFallbackWindow: false,
  };
}

describe('renderDateFormatRegex', () => {
  it('renders the comma-separated day/time format mechanically', () => {
    const source = renderDateFormatRegex('dd,HH:mm:ss,SSS');
    expect(new RegExp('^' + source + '$').test('04,17:00:03,214')).toBe(true);
    expect(new RegExp('^' + source + '$').test('not a timestamp')).toBe(false);
  });

  it('renders ISO8601 (named) and yyyy-MM-dd walks identically in effect', () => {
    const named = new RegExp('^' + renderDateFormatRegex('ISO8601'));
    const walked = new RegExp('^' + renderDateFormatRegex('yyyy-MM-dd HH:mm:ss,SSS'));
    const line = '2026-08-04 17:00:03,214';
    expect(named.test(line)).toBe(true);
    expect(walked.test(line)).toBe(true);
  });
});

describe('translateConversionPattern', () => {
  it('translates the classic log4j pattern into a prefix regex ending at %m', () => {
    const result = translateConversionPattern('%d{dd,HH:mm:ss,SSS} %p [%t] [%c{1}] - %m%n');
    expect(result).not.toBeNull();
    expect(result!.reachedMessage).toBe(true);
    expect(result!.unsupported).toEqual([]);
    const re = new RegExp('^' + result!.prefixSource);
    expect(re.test('04,17:00:03,214 INFO [feed-worker-2] [LedgerDaoImpl] - POST /api/books 200')).toBe(true);
    expect(re.test('    at com.example.Something.run(Something.java:44)')).toBe(false);
  });

  it('tolerates padding modifiers and unknown converters without failing', () => {
    const result = translateConversionPattern('%d{ABSOLUTE} %-5p [%q] %m');
    expect(result).not.toBeNull();
    expect(result!.unsupported).toEqual(['%q']);
    expect(new RegExp('^' + result!.prefixSource).test('17:00:03,214 WARN  [zzz] hello')).toBe(true);
  });

  it('returns null for a blank pattern', () => {
    expect(translateConversionPattern('   ')).toBeNull();
  });
});

describe('recipeFromConversionPattern + engine round trip', () => {
  const pattern = '%d{dd,HH:mm:ss,SSS} %p [%t] [%c{1}] - %m%n';
  const logText = [
    '04,17:00:03,214 INFO [http-1] [RequestLog] - POST /api/deal-books/42/positions statusCode=201',
    'java.lang.IllegalStateException: boom',
    '\tat com.example.Worker.run(Worker.java:12)',
    '04,17:00:04,001 INFO [http-1] [RequestLog] - GET /api/deal-books/42 statusCode=200',
  ].join('\n');

  it('accepts when sampled lines match, and the recipe extracts multi-line records', () => {
    const result = recipeFromConversionPattern({
      pattern,
      blocks: [blockOf(logText)],
      sourceFilePath: '/logs/app.log',
    });
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') return;
    expect(result.recipe.origin).toBe('pattern_translation');
    expect(result.recipe.llmCallsUsed).toBe(0);

    const rich = extractWithRecipeFromContent(result.recipe, logText, {});
    expect(rich.map((o) => `${o.method} ${o.rawPath} ${o.status}`)).toEqual([
      'POST /api/deal-books/42/positions 201',
      'GET /api/deal-books/42 200',
    ]);
    // The stack trace folded into record 1: its range spans 3 lines.
    expect(rich[0].lineStart).toBe(1);
    expect(rich[0].lineEnd).toBe(3);
  });

  it('rejects honestly when the file does not follow the declared pattern', () => {
    const result = recipeFromConversionPattern({
      pattern,
      blocks: [blockOf('{"ts":"2026-08-04T17:00:03Z","msg":"GET /api/x 200"}')],
      sourceFilePath: '/logs/other.jsonl',
    });
    expect(result).toEqual({ status: 'rejected', reason: 'pattern_no_match' });
  });
});
