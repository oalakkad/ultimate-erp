import { type Server } from 'node:http';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { OpenApiService } from '../src/platform/openapi/openapi.service.js';
import { productionTestConfig, testConfig } from './support/config.js';

// API documentation (brief §14): generated from route contracts, complete, dev-only.

describe('OpenAPI document', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    app = await createApp(testConfig());
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('every route declares an @ApiContract', () => {
    const undocumented = app
      .get(OpenApiService)
      .routes()
      .filter((r) => !r.contract)
      .map((r) => `${r.method.toUpperCase()} ${r.path}`);
    expect(undocumented).toEqual([]);
  });

  it('documents every route, with request and response schemas', async () => {
    const routes = app.get(OpenApiService).routes();
    const res = await request(server).get('/api/v1/docs/openapi.json');
    expect(res.status).toBe(200);
    const doc = res.body as { openapi: string; paths: Record<string, Record<string, unknown>> };
    expect(doc.openapi).toBe('3.1.0');
    const documented = Object.entries(doc.paths).flatMap(([path, ops]) =>
      Object.keys(ops).map((method) => `${method} ${path}`),
    );
    expect(documented.sort()).toEqual(routes.map((r) => `${r.method} ${r.path}`).sort());
    const signUp = doc.paths['/api/v1/auth/sign-up']?.post as {
      requestBody: { content: { 'application/json': { schema: { properties: object } } } };
    };
    expect(Object.keys(signUp.requestBody.content['application/json'].schema.properties)).toEqual(
      expect.arrayContaining(['email', 'password', 'name']),
    );
  });

  it('is not served in production', async () => {
    const prod = await createApp(productionTestConfig());
    await prod.init();
    try {
      const res = await request(prod.getHttpServer()).get('/api/v1/docs/openapi.json');
      expect(res.status).toBe(404);
    } finally {
      await prod.close();
    }
  });
});
