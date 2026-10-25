import { type Server } from 'node:http';
import { type INestApplication } from '@nestjs/common';
import { errorResponseSchema, healthResponseSchema } from '@ultimate-erp/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/platform/config/config.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Port 1 refuses connections, so the database is reliably "down" without Docker.
const UNREACHABLE_DB = 'postgres://erp:test@127.0.0.1:1/erp';

describe('HTTP platform behaviour (database unreachable)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    app = await createApp(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: UNREACHABLE_DB,
        LOG_LEVEL: 'silent',
        HTTP_BODY_LIMIT: '1kb',
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports 503 with the database down, without leaking connection details', async () => {
    const res = await request(server).get('/api/v1/health');
    expect(res.status).toBe(503);
    expect(healthResponseSchema.parse(res.body)).toMatchObject({
      status: 'error',
      checks: { database: { status: 'down' } },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|erp:test/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('liveness answers 200 even when the database is down', async () => {
    const res = await request(server).get('/api/v1/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('answers tenant routes with 503 in the standard error shape while the database is down', async () => {
    const res = await request(server).get('/api/v1/tenant').set('Host', 'acme.localhost');
    expect(res.status).toBe(503);
    const body = errorResponseSchema.parse(res.body);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('gives each request a different correlation ID', async () => {
    const a = await request(server).get('/api/v1/health/live');
    const b = await request(server).get('/api/v1/health/live');
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });

  it('ignores a caller-supplied X-Request-Id unless a trusted proxy is configured', async () => {
    const res = await request(server)
      .get('/api/v1/health/live')
      .set('X-Request-Id', 'attacker-chosen-id');
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('rejects malformed JSON with MALFORMED_JSON', async () => {
    const res = await request(server)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(errorResponseSchema.parse(res.body).error.code).toBe('MALFORMED_JSON');
  });

  it('rejects bodies over the size limit with PAYLOAD_TOO_LARGE', async () => {
    const res = await request(server)
      .post('/api/v1/health')
      .send({ data: 'x'.repeat(2048) });
    expect(res.status).toBe(413);
    const body = errorResponseSchema.parse(res.body);
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('sends security headers and hides the server technology', async () => {
    const res = await request(server).get('/api/v1/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('does not send CORS headers when no origins are configured', async () => {
    const res = await request(server)
      .get('/api/v1/health/live')
      .set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('trusted proxy request IDs', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    app = await createApp(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: UNREACHABLE_DB,
        LOG_LEVEL: 'silent',
        TRUST_INCOMING_REQUEST_ID: 'true',
        CORS_ORIGINS: 'http://localhost:5173',
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('reuses a well-formed incoming X-Request-Id', async () => {
    const res = await request(server)
      .get('/api/v1/health/live')
      .set('X-Request-Id', 'proxy-req-0001');
    expect(res.headers['x-request-id']).toBe('proxy-req-0001');
  });

  it('replaces an incoming X-Request-Id containing unsafe characters', async () => {
    const res = await request(server)
      .get('/api/v1/health/live')
      .set('X-Request-Id', 'bad id with spaces {"inject":1}');
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('allows only configured browser origins', async () => {
    const allowed = await request(server)
      .get('/api/v1/health/live')
      .set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const denied = await request(server)
      .get('/api/v1/health/live')
      .set('Origin', 'https://evil.example.com');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
