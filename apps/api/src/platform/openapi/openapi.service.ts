import { Injectable } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { API_PREFIX, ERROR_CODES, errorResponseSchema } from '@ultimate-erp/contracts';
import { z } from 'zod';
import { API_CONTRACT, type RouteContract } from './api-contract.js';

export interface DiscoveredRoute {
  method: string;
  path: string;
  contract: RouteContract | undefined;
}

const toJsonSchema = (schema: z.ZodType, io: 'input' | 'output') =>
  z.toJSONSchema(schema, { io, unrepresentable: 'any' });

const joinPath = (...parts: string[]) =>
  `/${parts
    .flatMap((p) => p.split('/'))
    .filter((p) => p.length > 0)
    .map((p) => (p.startsWith(':') ? `{${p.slice(1)}}` : p))
    .join('/')}`;

/** Builds an OpenAPI 3.1 document from the routes' `@ApiContract` declarations. */
@Injectable()
export class OpenApiService {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
  ) {}

  /** Every HTTP route registered in the application, with its contract if declared. */
  routes(): DiscoveredRoute[] {
    const routes: DiscoveredRoute[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const controller = wrapper.metatype as (new (...args: never[]) => unknown) | null;
      if (!controller) continue;
      const base = (Reflect.getMetadata(PATH_METADATA, controller) as string | undefined) ?? '';
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of this.scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name];
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (method === undefined) continue;
        const path = (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? '';
        routes.push({
          method: RequestMethod[method].toLowerCase(),
          path: joinPath(API_PREFIX, base, path),
          contract: Reflect.getMetadata(API_CONTRACT, handler) as RouteContract | undefined,
        });
      }
    }
    return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  }

  document(): Record<string, unknown> {
    const paths: Record<string, Record<string, unknown>> = {};
    for (const route of this.routes()) {
      const c = route.contract;
      if (!c) continue;
      const parameters = [
        ...this.parameters(c.params, 'path'),
        ...this.parameters(c.query, 'query'),
      ];
      const auth =
        c.auth === 'public'
          ? 'Public.'
          : c.auth === 'session'
            ? 'Requires a session cookie.'
            : `Requires membership of the company on this host${c.permission ? ` and permission \`${c.permission}\`` : ''}.`;
      (paths[route.path] ??= {})[route.method] = {
        summary: c.summary,
        description: `${auth}${c.companyHost ? ' Called on the company address (<slug>.<domain>).' : ''}`,
        ...(c.auth === 'public' ? {} : { security: [{ session: [] }] }),
        ...(parameters.length ? { parameters } : {}),
        ...(c.body
          ? {
              requestBody: {
                required: true,
                content: { 'application/json': { schema: toJsonSchema(c.body, 'input') } },
              },
            }
          : {}),
        responses: {
          [String(c.status ?? 200)]: {
            description: 'Success',
            ...(c.response
              ? { content: { 'application/json': { schema: toJsonSchema(c.response, 'output') } } }
              : {}),
          },
          default: {
            description: `Error (codes: ${ERROR_CODES.join(', ')})`,
            content: {
              'application/json': { schema: toJsonSchema(errorResponseSchema, 'output') },
            },
          },
        },
      };
    }
    return {
      openapi: '3.1.0',
      info: {
        title: 'Ultimate ERP API',
        version: '1',
        description:
          'Generated from the shared Zod contracts (packages/contracts). Every response carries X-Request-Id.',
      },
      components: {
        securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'erp.session_token' } },
      },
      paths,
    };
  }

  private parameters(schema: z.ZodType | undefined, location: 'path' | 'query') {
    if (!schema) return [];
    const json = toJsonSchema(schema, 'input') as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    return Object.entries(json.properties ?? {}).map(([name, property]) => ({
      name,
      in: location,
      required: location === 'path' || (json.required ?? []).includes(name),
      schema: property,
    }));
  }
}
