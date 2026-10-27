import { type Server } from 'node:http';
import { type INestApplication } from '@nestjs/common';
import { healthResponseSchema } from '@ultimate-erp/contracts';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { testConfig } from './support/config.js';

// Runs against a real, throwaway Postgres in Docker, set up exactly like an installation.
describe('GET /api/v1/health with a real database', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let server: Server;
  let containerStopped = false;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createApp(
      testConfig({
        NODE_ENV: 'test',
        DATABASE_URL: database.appUrl,
        LOG_LEVEL: 'silent',
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
    if (!containerStopped) await database.stop();
  });

  it('reports 200 with the database up', async () => {
    const res = await request(server).get('/api/v1/health');
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.checks.database.status).toBe('up');
    expect(body.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports 503 once the database becomes unavailable', async () => {
    await database.stop();
    containerStopped = true;
    const res = await request(server).get('/api/v1/health');
    expect(res.status).toBe(503);
    expect(healthResponseSchema.parse(res.body).checks.database.status).toBe('down');
  });
});
