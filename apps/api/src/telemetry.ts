// Traces (OpenTelemetry, docs/modules/files-monitoring.md section 3). Preloaded before the app:
//   node --import ./dist/telemetry.js dist/main.js        (also dist/worker.js)
// Does nothing unless OTEL_EXPORTER_OTLP_ENDPOINT is set (owner decision 2026-10-28: monitoring
// is off unless configured). Records incoming/outgoing HTTP and database queries (SQL text with
// placeholders, never values); query strings, client addresses and user agents are removed
// before anything leaves the server.
import { register } from 'node:module';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  // ESM modules are instrumented through this loader hook (it must run before they load).
  // The OpenTelemetry hook is an asynchronous loader, which needs register() (not registerHooks()).
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
  const { context, trace } = await import('@opentelemetry/api');
  const { AsyncLocalStorageContextManager } = await import('@opentelemetry/context-async-hooks');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const { registerInstrumentations } = await import('@opentelemetry/instrumentation');
  const { HttpInstrumentation } = await import('@opentelemetry/instrumentation-http');
  const { PgInstrumentation } = await import('@opentelemetry/instrumentation-pg');
  const { resourceFromAttributes } = await import('@opentelemetry/resources');
  const { BatchSpanProcessor, TracerProvider } = await import('@opentelemetry/sdk-trace');
  const DROP = new Set([
    'url.query',
    'client.address',
    'http.client_ip',
    'net.sock.peer.addr',
    'user_agent.original',
    'http.user_agent',
  ]);
  const PATH_ONLY = ['url.full', 'http.url', 'http.target'];

  /** A copy of the span without personal data in its attributes. */
  const scrub = (span: ReadableSpan): ReadableSpan => {
    const attributes = { ...span.attributes };
    for (const key of DROP) Reflect.deleteProperty(attributes, key);
    for (const key of PATH_ONLY) {
      const value = attributes[key];
      if (typeof value === 'string') attributes[key] = value.split('?')[0] ?? value;
    }
    return new Proxy(span, {
      get: (target, prop, receiver) =>
        prop === 'attributes' ? attributes : (Reflect.get(target, prop, receiver) as unknown),
    });
  };

  const exporter = new OTLPTraceExporter();
  const scrubbing: SpanExporter = {
    export: (spans, done) => {
      exporter.export(spans.map(scrub), done);
    },
    shutdown: () => exporter.shutdown(),
    forceFlush: () => exporter.forceFlush(),
  };

  const provider = new TracerProvider({
    resource: resourceFromAttributes({
      'service.name':
        process.env.OTEL_SERVICE_NAME ??
        (process.argv.some((a) => a.endsWith('worker.js'))
          ? 'ultimate-erp-worker'
          : 'ultimate-erp-api'),
    }),
    spanProcessors: [new BatchSpanProcessor({ exporter: scrubbing })],
  });
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(provider);
  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => req.url?.startsWith('/api/v1/health/live') ?? false,
      }),
      new PgInstrumentation(),
    ],
  });
  const stop = () => {
    void provider.shutdown();
  };
  process.once('SIGTERM', stop);
  process.once('beforeExit', stop);
}
