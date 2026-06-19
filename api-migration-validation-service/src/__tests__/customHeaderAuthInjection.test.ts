import http from 'http';
import { createSessionHttpExecutor } from '../services/httpExecutor';

/**
 * End-to-end proof that the `custom_header` auth variant (e.g. the wizard's
 * "Custom header" option with name `ssoToken`) actually lands on the wire of
 * every outgoing capture request. Spins up a real loopback server that echoes
 * the headers it received, points the real executor at it, and asserts the
 * configured header is present with the exact value.
 */
describe('custom_header auth injection lands on the wire', () => {
  it('adds ssoToken: <value> to outgoing requests (custom_header)', async () => {
    let received: http.IncomingHttpHeaders = {};
    const server = http.createServer((req, res) => {
      received = req.headers;
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const exec = createSessionHttpExecutor({
      auth: { type: 'custom_header', headerName: 'ssoToken', headerValue: 'SECRET-SSO-123' },
      baseURL: `http://127.0.0.1:${port}`,
      timeoutMs: 5000,
    });

    try {
      const resp = await exec.request({
        method: 'GET',
        url: '/anything',
        headers: { Connection: 'close' },
      });
      expect(resp.status).toBe(200);
    } finally {
      exec.dispose();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // Node lower-cases incoming header names.
    expect(received['ssotoken']).toBe('SECRET-SSO-123');
  });

  it('still injects custom_header even when the caller passes ad-hoc headers + a body', async () => {
    let received: http.IncomingHttpHeaders = {};
    const server = http.createServer((req, res) => {
      received = req.headers;
      // drain the body
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(201, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify({ id: 1 }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const exec = createSessionHttpExecutor({
      auth: { type: 'custom_header', headerName: 'ssoToken', headerValue: 'SECRET-SSO-456' },
      baseURL: `http://127.0.0.1:${port}`,
      timeoutMs: 5000,
    });

    try {
      await exec.request({
        method: 'POST',
        url: '/things',
        headers: { 'X-Trace': 'abc', Connection: 'close' },
        data: { name: 'x' },
      });
    } finally {
      exec.dispose();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    expect(received['ssotoken']).toBe('SECRET-SSO-456');
    expect(received['x-trace']).toBe('abc');
  });
});
