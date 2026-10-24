import { type Server } from 'node:http';
import { type INestApplication } from '@nestjs/common';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { healthResponseSchema } from '@ultimate-erp/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/platform/config/config.js';

// Runs against a real, throwaway Postgres in Docker (same image as local dev).
describe('GET /api/v1/health with a real database', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let server: Server;
  let containerStopped = false;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18.6-alpine').start();
    app = await createApp(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: container.getConnectionUri(),
        LOG_LEVEL: 'silent',
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
    if (!containerStopped) await container.stop();
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
    await container.stop();
    containerStopped = true;
    const res = await request(server).get('/api/v1/health');
    expect(res.status).toBe(503);
    expect(healthResponseSchema.parse(res.body).checks.database.status).toBe('down');
  });
});
