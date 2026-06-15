/**
 * Log Parsing Tests (Task Group 2)
 *
 * 8 focused tests covering:
 * 1. LogFormatDetector correctly identifies JSON lines format
 * 2. LogFormatDetector correctly identifies syslog format
 * 3. LogFormatDetector correctly identifies framework pattern (Log4j/Logback) format
 * 4. LogFormatDetector returns 'unknown' for unrecognized content
 * 5. jsonLinesParser extracts structured fields from JSON log lines
 * 6. syslogParser extracts timestamp, hostname, process, and message
 * 7. frameworkPatternParser extracts date, thread, level, logger, and message
 * 8. Fallback parser treats each line as plain text message when format is 'unknown'
 */

import { detectLogFormat } from '../services/logParsing/logFormatDetector';
import { parseJsonLines } from '../services/logParsing/jsonLinesParser';
import { parseSyslog } from '../services/logParsing/syslogParser';
import { parseFrameworkPattern } from '../services/logParsing/frameworkPatternParser';
import { parsePlaintext } from '../services/logParsing/plaintextParser';

describe('Log Parsing', () => {
  // Test 1: LogFormatDetector correctly identifies JSON lines format
  test('detectLogFormat identifies JSON lines format when majority of lines are JSON objects', () => {
    const lines = [
      '{"timestamp":"2024-01-15T10:30:45.123Z","level":"INFO","message":"Server started","port":8080}',
      '{"timestamp":"2024-01-15T10:30:46.456Z","level":"DEBUG","message":"Loading config","module":"config"}',
      '{"timestamp":"2024-01-15T10:30:47.789Z","level":"WARN","message":"Deprecated API called","endpoint":"/v1/old"}',
      '{"timestamp":"2024-01-15T10:30:48.012Z","level":"ERROR","message":"Connection timeout","host":"db-primary"}',
      '{"timestamp":"2024-01-15T10:30:49.345Z","level":"INFO","message":"Request handled","status":200}',
    ];

    const format = detectLogFormat(lines);
    expect(format).toBe('json_lines');
  });

  // Test 2: LogFormatDetector correctly identifies syslog format
  test('detectLogFormat identifies syslog format for BSD-style syslog messages', () => {
    const lines = [
      'Jan 15 10:30:45 myhost myapp[1234]: Starting application',
      'Jan 15 10:30:46 myhost myapp[1234]: Listening on port 8080',
      'Jan 15 10:30:47 myhost kernel[0]: Network interface up',
      'Jan 15 10:30:48 myhost sshd[5678]: Accepted publickey for user',
      'Jan 15 10:30:49 myhost myapp[1234]: Request processed successfully',
    ];

    const format = detectLogFormat(lines);
    expect(format).toBe('syslog');
  });

  // Test 3: LogFormatDetector correctly identifies framework pattern (Log4j/Logback) format
  test('detectLogFormat identifies framework pattern for Log4j/Logback-style log lines', () => {
    const lines = [
      '2024-01-15 10:30:45.123 [main] INFO com.example.App - Starting up',
      '2024-01-15 10:30:45.456 [main] DEBUG com.example.Config - Loading configuration',
      '2024-01-15 10:30:45.789 [http-nio-8080-exec-1] INFO c.e.controller.UserController - Handling GET /users',
      '2024-01-15 10:30:46.012 [scheduler-1] WARN com.example.Cache - Cache miss for key: user-123',
      '2024-01-15 10:30:46.345 [main] ERROR com.example.Database - Connection pool exhausted',
    ];

    const format = detectLogFormat(lines);
    expect(format).toBe('framework_pattern');
  });

  // Test 4: LogFormatDetector returns 'unknown' for unrecognized content
  test('detectLogFormat returns unknown for lines that do not match any recognized format', () => {
    const lines = [
      'This is just a random line of text',
      'Another unstructured line with no pattern',
      'ERROR happened somewhere but no standard format',
      '=== Application Log Start ===',
      'Processing items: 1, 2, 3, 4, 5',
    ];

    const format = detectLogFormat(lines);
    expect(format).toBe('unknown');

    // Also test empty input
    expect(detectLogFormat([])).toBe('unknown');
    expect(detectLogFormat(['', '  ', ''])).toBe('unknown');
  });

  // Test 5: jsonLinesParser extracts structured fields from JSON log lines
  test('jsonLinesParser extracts timestamp, level, logger, message, and puts remaining fields in metadata', () => {
    const lines = [
      '{"timestamp":"2024-01-15T10:30:45.123Z","level":"INFO","logger":"UserService","message":"User created","userId":"u-123","action":"create"}',
      '{"time":"2024-01-15T10:30:46.456Z","lvl":"ERROR","name":"DbClient","msg":"Query failed","query":"SELECT * FROM users","duration_ms":1500}',
      'this is not json and should be skipped',
      '',
      '{"timestamp":"2024-01-15T10:30:47.789Z","level":"DEBUG","message":"Cache hit","key":"session-abc"}',
    ];

    const entries = parseJsonLines(lines);

    // Should produce 3 entries (the non-JSON line and empty line are skipped)
    expect(entries).toHaveLength(3);

    // First entry: standard field names
    const first = entries[0];
    expect(first.timestamp).toBe('2024-01-15T10:30:45.123Z');
    expect(first.level).toBe('INFO');
    expect(first.logger).toBe('UserService');
    expect(first.message).toBe('User created');
    expect(first.lineNumber).toBe(1);
    expect(first.rawLine).toBe(lines[0]);
    // Remaining fields go to metadata
    expect(first.metadata).toEqual({ userId: 'u-123', action: 'create' });

    // Second entry: alternative field names (time, lvl, name, msg)
    const second = entries[1];
    expect(second.timestamp).toBe('2024-01-15T10:30:46.456Z');
    expect(second.level).toBe('ERROR');
    expect(second.logger).toBe('DbClient');
    expect(second.message).toBe('Query failed');
    expect(second.lineNumber).toBe(2);
    expect(second.metadata).toEqual({ query: 'SELECT * FROM users', duration_ms: 1500 });

    // Third entry
    const third = entries[2];
    expect(third.timestamp).toBe('2024-01-15T10:30:47.789Z');
    expect(third.level).toBe('DEBUG');
    expect(third.logger).toBeNull(); // No logger field in this line
    expect(third.message).toBe('Cache hit');
    expect(third.lineNumber).toBe(5);
    expect(third.metadata).toEqual({ key: 'session-abc' });
  });

  // Test 6: syslogParser extracts timestamp, hostname, process, and message
  test('syslogParser extracts timestamp, hostname, process (as logger), PID, and message', () => {
    const lines = [
      'Jan 15 10:30:45 webserver nginx[1234]: GET /api/users 200 15ms',
      'Jan 15 10:30:46 webserver nginx[1234]: POST /api/orders 201 42ms',
      'Jan 15 10:30:47 dbserver postgres[5678]: ERROR: duplicate key violates unique constraint',
      '',
      '2024-01-15T10:30:48.000Z apphost myservice[9012]: Processing batch job #42',
    ];

    const entries = parseSyslog(lines);

    // Should produce 4 entries (empty line skipped)
    expect(entries).toHaveLength(4);

    // First entry: BSD-style syslog
    const first = entries[0];
    expect(first.timestamp).toBe('Jan 15 10:30:45');
    expect(first.logger).toBe('nginx');
    expect(first.message).toBe('GET /api/users 200 15ms');
    expect(first.lineNumber).toBe(1);
    expect(first.metadata).toEqual({ hostname: 'webserver', pid: 1234 });
    expect(first.level).toBeNull(); // No standard level keyword in message

    // Third entry: contains ERROR keyword in message
    const third = entries[2];
    expect(third.timestamp).toBe('Jan 15 10:30:47');
    expect(third.logger).toBe('postgres');
    expect(third.message).toBe('ERROR: duplicate key violates unique constraint');
    expect(third.level).toBe('ERROR');
    expect(third.metadata).toEqual({ hostname: 'dbserver', pid: 5678 });

    // Fourth entry: ISO-8601 timestamp variant
    const fourth = entries[3];
    expect(fourth.timestamp).toBe('2024-01-15T10:30:48.000Z');
    expect(fourth.logger).toBe('myservice');
    expect(fourth.message).toBe('Processing batch job #42');
    expect(fourth.metadata).toEqual({ hostname: 'apphost', pid: 9012 });
  });

  // Test 7: frameworkPatternParser extracts date, thread, level, logger, and message
  test('frameworkPatternParser extracts date, thread, level, logger class, message, and handles multiline stack traces', () => {
    const lines = [
      '2024-01-15 10:30:45.123 [main] INFO com.example.App - Starting up',
      '2024-01-15 10:30:45.456 [http-nio-8080-exec-1] ERROR com.example.UserService - Failed to process request',
      '  at com.example.UserService.handleRequest(UserService.java:42)',
      '  at com.example.Controller.dispatch(Controller.java:15)',
      'Caused by: java.lang.NullPointerException',
      '2024-01-15 10:30:46.789 [main] WARN com.example.Cache - Cache eviction triggered',
    ];

    const entries = parseFrameworkPattern(lines);

    // Should produce 3 entries (stack trace lines appended to second entry)
    expect(entries).toHaveLength(3);

    // First entry
    const first = entries[0];
    expect(first.timestamp).toBe('2024-01-15 10:30:45.123');
    expect(first.level).toBe('INFO');
    expect(first.logger).toBe('com.example.App');
    expect(first.message).toBe('Starting up');
    expect(first.lineNumber).toBe(1);
    expect(first.metadata).toEqual({ thread: 'main' });

    // Second entry: ERROR with stack trace appended
    const second = entries[1];
    expect(second.timestamp).toBe('2024-01-15 10:30:45.456');
    expect(second.level).toBe('ERROR');
    expect(second.logger).toBe('com.example.UserService');
    expect(second.message).toContain('Failed to process request');
    expect(second.message).toContain('at com.example.UserService.handleRequest');
    expect(second.message).toContain('Caused by: java.lang.NullPointerException');
    expect(second.metadata).toEqual({ thread: 'http-nio-8080-exec-1' });

    // Third entry
    const third = entries[2];
    expect(third.timestamp).toBe('2024-01-15 10:30:46.789');
    expect(third.level).toBe('WARN');
    expect(third.logger).toBe('com.example.Cache');
    expect(third.message).toBe('Cache eviction triggered');
    expect(third.metadata).toEqual({ thread: 'main' });
  });

  // Test 8: Fallback parser treats each line as plain text message when format is 'unknown'
  test('plaintextParser treats each non-empty line as a plain text message with only message, rawLine, and lineNumber populated', () => {
    const lines = [
      'Application started on port 3000',
      '',
      'Processing request from 192.168.1.1',
      '  ',
      'Completed batch job in 1234ms',
    ];

    const entries = parsePlaintext(lines);

    // Should produce 3 entries (empty and whitespace-only lines skipped)
    expect(entries).toHaveLength(3);

    // First entry
    const first = entries[0];
    expect(first.message).toBe('Application started on port 3000');
    expect(first.rawLine).toBe('Application started on port 3000');
    expect(first.lineNumber).toBe(1);
    expect(first.timestamp).toBeNull();
    expect(first.level).toBeNull();
    expect(first.logger).toBeNull();
    expect(first.metadata).toEqual({});

    // Second entry (line 3 in the original, since line 2 is empty)
    const second = entries[1];
    expect(second.message).toBe('Processing request from 192.168.1.1');
    expect(second.rawLine).toBe('Processing request from 192.168.1.1');
    expect(second.lineNumber).toBe(3);
    expect(second.timestamp).toBeNull();
    expect(second.level).toBeNull();
    expect(second.logger).toBeNull();
    expect(second.metadata).toEqual({});

    // Third entry (line 5 in the original)
    const third = entries[2];
    expect(third.message).toBe('Completed batch job in 1234ms');
    expect(third.lineNumber).toBe(5);
  });
});
