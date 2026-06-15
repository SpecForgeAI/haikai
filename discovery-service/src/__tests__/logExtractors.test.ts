/**
 * Log Evidence Extractor Tests (Task Group 3)
 *
 * 6 focused tests covering:
 * 1. endpointUsageExtractor finds URL/route patterns and returns string_pattern atoms with source: "log"
 * 2. serviceInteractionExtractor detects HTTP/gRPC calls and service name references
 * 3. errorTraceExtractor identifies stack traces, exception classes, and error codes
 * 4. databaseQueryExtractor finds SQL patterns and table name references
 * 5. userFlowHintExtractor detects sequential request patterns suggesting user journeys
 * 6. All extractors produce atoms with correct logOrigin metadata
 */

import { ParsedLogEntry } from '../types/logParsing';
import { extractEndpointUsage } from '../services/logExtractors/endpointUsageExtractor';
import { extractServiceInteractions } from '../services/logExtractors/serviceInteractionExtractor';
import { extractErrorTraces } from '../services/logExtractors/errorTraceExtractor';
import { extractDatabaseQueries } from '../services/logExtractors/databaseQueryExtractor';
import { extractUserFlowHints } from '../services/logExtractors/userFlowHintExtractor';
import { runAllLogExtractors } from '../services/logExtractors';

const RUN_ID = 'test-run-001';
const REPO_URL = 'https://github.com/example/repo';
const LOG_FILE_PATH = '/var/log/app/application.log';

/**
 * Helper to create a minimal ParsedLogEntry for testing.
 */
function makeEntry(
  lineNumber: number,
  message: string,
  overrides?: Partial<ParsedLogEntry>
): ParsedLogEntry {
  return {
    timestamp: overrides?.timestamp ?? '2024-01-15T10:30:45.123Z',
    level: overrides?.level ?? 'INFO',
    logger: overrides?.logger ?? 'TestLogger',
    message,
    rawLine: overrides?.rawLine ?? message,
    lineNumber,
    metadata: overrides?.metadata ?? {},
  };
}

describe('Log Evidence Extractors', () => {
  // Test 1: endpointUsageExtractor finds URL/route patterns
  test('endpointUsageExtractor finds URL/route patterns in log messages and returns string_pattern atoms with source: "log"', () => {
    const entries: ParsedLogEntry[] = [
      makeEntry(1, 'Handling GET /api/users/123 in 45ms'),
      makeEntry(2, 'POST /api/orders completed successfully'),
      makeEntry(5, 'Handling GET /api/users/456 in 30ms'),
      makeEntry(10, 'Request to /v1/products returned 200'),
      makeEntry(15, 'Static content served from /images/logo.png'),
    ];

    const atoms = extractEndpointUsage(entries, RUN_ID, REPO_URL, LOG_FILE_PATH);

    // Should find endpoint patterns
    expect(atoms.length).toBeGreaterThanOrEqual(2);

    // All atoms should be string_pattern type with source "log"
    for (const atom of atoms) {
      expect(atom.type).toBe('string_pattern');
      expect(atom.source).toBe('log');
      expect(atom.data).toHaveProperty('patternName', 'endpoint_usage_log');
      expect(atom.runId).toBe(RUN_ID);
      expect(atom.repoUrl).toBe(REPO_URL);
      expect(atom.filePath).toBe(LOG_FILE_PATH);
    }

    // Check that GET /api/users pattern was found (aggregated from lines 1 and 5)
    const usersAtom = atoms.find(a => {
      const data = a.data as { matchedText: string };
      return data.matchedText.includes('/api/users');
    });
    expect(usersAtom).toBeDefined();
    // The aggregated atom should span from line 1 to line 5
    expect(usersAtom!.logOrigin).toBeDefined();
    expect(usersAtom!.logOrigin!.lineStart).toBe(1);
    expect(usersAtom!.logOrigin!.lineEnd).toBe(5);
    expect(usersAtom!.logOrigin!.occurrenceCount).toBe(2);

    // Check that POST /api/orders was found
    const ordersAtom = atoms.find(a => {
      const data = a.data as { matchedText: string };
      return data.matchedText.includes('/api/orders');
    });
    expect(ordersAtom).toBeDefined();
  });

  // Test 2: serviceInteractionExtractor detects HTTP/gRPC calls and service name references
  test('serviceInteractionExtractor detects HTTP/gRPC calls and service name references', () => {
    const entries: ParsedLogEntry[] = [
      makeEntry(1, 'Calling https://auth-service.internal:8443/validate'),
      makeEntry(2, 'Connecting to grpc://order-service:9090/OrderService/GetOrder'),
      makeEntry(3, 'Forwarding to service payment-service for processing'),
      makeEntry(4, 'Response from https://auth-service.internal:8443/token in 120ms'),
      makeEntry(5, 'Database connection to db-primary:5432 established'),
    ];

    const atoms = extractServiceInteractions(entries, RUN_ID, REPO_URL, LOG_FILE_PATH);

    // Should detect multiple service interactions
    expect(atoms.length).toBeGreaterThanOrEqual(3);

    // All atoms should have correct type and source
    for (const atom of atoms) {
      expect(atom.type).toBe('string_pattern');
      expect(atom.source).toBe('log');
      expect(atom.data).toHaveProperty('patternName', 'service_interaction_log');
    }

    // Check that HTTPS service was detected
    const authAtom = atoms.find(a => {
      const data = a.data as { matchedText: string };
      return data.matchedText.includes('auth-service');
    });
    expect(authAtom).toBeDefined();
    // Auth service appears on lines 1 and 4, should be aggregated
    expect(authAtom!.logOrigin!.occurrenceCount).toBe(2);

    // Check that gRPC service was detected
    const grpcAtom = atoms.find(a => {
      const data = a.data as { matchedText: string };
      return data.matchedText.includes('order-service');
    });
    expect(grpcAtom).toBeDefined();

    // Check that named service reference was detected
    const paymentAtom = atoms.find(a => {
      const data = a.data as { matchedText: string };
      return data.matchedText.includes('payment-service');
    });
    expect(paymentAtom).toBeDefined();
  });

  // Test 3: errorTraceExtractor identifies stack traces, exception classes, and error codes
  test('errorTraceExtractor identifies stack traces, exception classes, and error codes', () => {
    const entries: ParsedLogEntry[] = [
      makeEntry(1, 'java.lang.NullPointerException: Cannot invoke method on null'),
      makeEntry(2, '  at com.example.UserService.getUser(UserService.java:42)'),
      makeEntry(3, '  at com.example.Controller.handle(Controller.java:15)'),
      makeEntry(4, 'Caused by: java.io.IOException: Connection refused'),
      makeEntry(5, 'Error code ERR-5001 occurred during payment processing'),
      makeEntry(10, 'java.lang.NullPointerException: Another null reference'),
      makeEntry(15, 'HTTP 500 internal server error'),
    ];

    const atoms = extractErrorTraces(entries, RUN_ID, REPO_URL, LOG_FILE_PATH);

    // Should detect multiple error traces
    expect(atoms.length).toBeGreaterThanOrEqual(3);

    // All atoms should have correct type and source
    for (const atom of atoms) {
      expect(atom.type).toBe('string_pattern');
      expect(atom.source).toBe('log');
      expect(atom.data).toHaveProperty('patternName', 'error_trace_log');
    }

    // Check that NullPointerException was found (aggregated from lines 1 and 10)
    const npeAtom = atoms.find(a => {
      const data = a.data as { matchedText: string };
      return data.matchedText.includes('NullPointerException');
    });
    expect(npeAtom).toBeDefined();
    expect(npeAtom!.logOrigin!.occurrenceCount).toBe(2);

    // Check that error code was found
    const errCodeAtom = atoms.find(a => {
      const data = a.data as { matchedText: string };
      return data.matchedText.includes('ERR-5001');
    });
    expect(errCodeAtom).toBeDefined();

    // Check that stack trace line was detected
    const stackAtom = atoms.find(a => {
      const data = a.data as { matchedText: string };
      return data.matchedText.includes('stack_trace');
    });
    expect(stackAtom).toBeDefined();
  });

  // Test 4: databaseQueryExtractor finds SQL patterns and table name references
  test('databaseQueryExtractor finds SQL patterns and table name references', () => {
    const entries: ParsedLogEntry[] = [
      makeEntry(1, 'Executing: SELECT id, name FROM users WHERE active = true'),
      makeEntry(2, 'INSERT INTO orders (user_id, total) VALUES (1, 99.99)'),
      makeEntry(3, 'UPDATE products SET stock = stock - 1 WHERE id = 42'),
      makeEntry(4, 'DELETE FROM sessions WHERE expired_at < NOW()'),
      makeEntry(5, 'Connected to jdbc:postgresql://db-host:5432/mydb'),
      makeEntry(8, 'Executing: SELECT email FROM users WHERE id = 5'),
    ];

    const atoms = extractDatabaseQueries(entries, RUN_ID, REPO_URL, LOG_FILE_PATH);

    // Should detect multiple database patterns
    expect(atoms.length).toBeGreaterThanOrEqual(4);

    // All atoms should have correct type and source
    for (const atom of atoms) {
      expect(atom.type).toBe('string_pattern');
      expect(atom.source).toBe('log');
      expect(atom.data).toHaveProperty('patternName', 'database_query_log');
    }

    // Check that SELECT FROM users was found (aggregated from lines 1 and 8)
    const selectUsersAtom = atoms.find(a => {
      const data = a.data as { matchedText: string };
      return data.matchedText.toLowerCase().includes('select') && data.matchedText.toLowerCase().includes('users');
    });
    expect(selectUsersAtom).toBeDefined();
    expect(selectUsersAtom!.logOrigin!.occurrenceCount).toBe(2);

    // Check that INSERT INTO orders was found
    const insertAtom = atoms.find(a => {
      const data = a.data as { matchedText: string };
      return data.matchedText.toLowerCase().includes('insert') && data.matchedText.toLowerCase().includes('orders');
    });
    expect(insertAtom).toBeDefined();

    // Check that connection string was found
    const connAtom = atoms.find(a => {
      const data = a.data as { matchedText: string };
      return data.matchedText.includes('connection_string');
    });
    expect(connAtom).toBeDefined();
  });

  // Test 5: userFlowHintExtractor detects sequential request patterns suggesting user journeys
  test('userFlowHintExtractor detects sequential request patterns suggesting user journeys', () => {
    const entries: ParsedLogEntry[] = [
      makeEntry(1, 'request_id=abc12345 User login initiated', {
        metadata: { requestId: 'abc12345' },
      }),
      makeEntry(2, 'request_id=abc12345 Authentication successful', {
        metadata: { requestId: 'abc12345' },
      }),
      makeEntry(3, 'request_id=abc12345 Loading user profile', {
        metadata: { requestId: 'abc12345' },
      }),
      makeEntry(5, 'User checkout started for order #1234'),
      makeEntry(6, 'Payment processing initiated'),
      makeEntry(7, 'request_id=def67890 New session created', {
        metadata: { requestId: 'def67890' },
      }),
    ];

    const atoms = extractUserFlowHints(entries, RUN_ID, REPO_URL, LOG_FILE_PATH);

    // Should detect flow hints
    expect(atoms.length).toBeGreaterThanOrEqual(2);

    // All atoms should have correct type and source
    for (const atom of atoms) {
      expect(atom.type).toBe('string_pattern');
      expect(atom.source).toBe('log');
      expect(atom.data).toHaveProperty('patternName', 'user_flow_hint_log');
    }

    // Check that the session sequence for abc12345 was detected (3 entries)
    const sessionAtom = atoms.find(a => {
      const data = a.data as { matchedText: string };
      return data.matchedText.includes('abc12345');
    });
    expect(sessionAtom).toBeDefined();
    expect(sessionAtom!.logOrigin!.occurrenceCount).toBe(3);
    expect(sessionAtom!.logOrigin!.lineStart).toBe(1);
    expect(sessionAtom!.logOrigin!.lineEnd).toBe(3);

    // Check that flow keywords (login, checkout, payment) were detected
    const loginAtom = atoms.find(a => {
      const data = a.data as { matchedText: string };
      return data.matchedText.includes('login');
    });
    expect(loginAtom).toBeDefined();

    const checkoutAtom = atoms.find(a => {
      const data = a.data as { matchedText: string };
      return data.matchedText.includes('checkout');
    });
    expect(checkoutAtom).toBeDefined();
  });

  // Test 6: All extractors produce atoms with correct logOrigin metadata
  test('all extractors produce atoms with correct logOrigin metadata (filePath, lineStart, lineEnd, occurrenceCount)', () => {
    const entries: ParsedLogEntry[] = [
      makeEntry(1, 'GET /api/users/1 responded 200', { timestamp: '2024-01-15T10:00:00Z' }),
      makeEntry(2, 'Calling https://cache-service:6379/get', { timestamp: '2024-01-15T10:00:01Z' }),
      makeEntry(3, 'java.lang.RuntimeException: Something failed', { timestamp: '2024-01-15T10:00:02Z' }),
      makeEntry(4, 'Executing SELECT * FROM audit_log WHERE event_type = "login"', { timestamp: '2024-01-15T10:00:03Z' }),
      makeEntry(5, 'User login completed successfully', { timestamp: '2024-01-15T10:00:04Z' }),
    ];

    const allAtoms = runAllLogExtractors(entries, RUN_ID, REPO_URL, LOG_FILE_PATH);

    // Should produce atoms from multiple extractors
    expect(allAtoms.length).toBeGreaterThanOrEqual(5);

    // Verify every atom has correct logOrigin structure
    for (const atom of allAtoms) {
      // Every atom must have source: "log"
      expect(atom.source).toBe('log');

      // Every atom must have logOrigin
      expect(atom.logOrigin).toBeDefined();
      expect(atom.logOrigin!.filePath).toBe(LOG_FILE_PATH);
      expect(typeof atom.logOrigin!.lineStart).toBe('number');
      expect(typeof atom.logOrigin!.lineEnd).toBe('number');
      expect(atom.logOrigin!.lineStart).toBeGreaterThanOrEqual(1);
      expect(atom.logOrigin!.lineEnd).toBeGreaterThanOrEqual(atom.logOrigin!.lineStart);
      expect(typeof atom.logOrigin!.occurrenceCount).toBe('number');
      expect(atom.logOrigin!.occurrenceCount).toBeGreaterThanOrEqual(1);

      // Every atom must have a deterministic ID (non-empty string)
      expect(typeof atom.id).toBe('string');
      expect(atom.id.length).toBeGreaterThan(0);

      // Every atom must have valid basic fields
      expect(atom.runId).toBe(RUN_ID);
      expect(atom.repoUrl).toBe(REPO_URL);
      expect(atom.filePath).toBe(LOG_FILE_PATH);
      expect(atom.type).toBe('string_pattern');
      expect(atom.extractedAt).toBeDefined();
    }

    // Verify we have atoms from different extractors by checking patternName diversity
    const patternNames = new Set(allAtoms.map(a => (a.data as { patternName: string }).patternName));
    expect(patternNames.size).toBeGreaterThanOrEqual(3);

    // Verify at least some atoms have timestamp in logOrigin
    const atomsWithTimestamp = allAtoms.filter(a => a.logOrigin!.timestamp !== undefined);
    expect(atomsWithTimestamp.length).toBeGreaterThan(0);
  });
});
