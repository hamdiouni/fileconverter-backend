/**
 * Integration tests for Correlation ID middleware (Task 27.3)
 * Requirements: 15.7
 */
import Fastify from 'fastify';
import supertest from 'supertest';
import { correlationIdHook, forwardCorrelationHeader, extractCorrelationId, CORRELATION_HEADER } from '../correlation';

// ─── Test app factory ─────────────────────────────────────────────────────────

function buildTestApp() {
  const app = Fastify({ logger: false });

  // Register the hook
  app.addHook('onRequest', correlationIdHook);

  // Echo route — returns the correlationId as seen by the handler
  app.get('/echo', async (req, _reply) => {
    return { correlationId: (req as any).correlationId };
  });

  // Forward route — returns what forwardCorrelationHeader builds
  app.get('/forward', async (req, _reply) => {
    return forwardCorrelationHeader(req);
  });

  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('correlationIdHook', () => {
  let app: ReturnType<typeof buildTestApp>;

  beforeAll(async () => {
    app = buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('generates a correlation ID when none is provided', async () => {
    const res = await supertest(app.server).get('/echo');
    expect(res.status).toBe(200);
    expect(typeof res.body.correlationId).toBe('string');
    expect(res.body.correlationId.length).toBeGreaterThan(0);
  });

  it('uses the provided x-correlation-id header', async () => {
    const id = 'test-correlation-123';
    const res = await supertest(app.server)
      .get('/echo')
      .set(CORRELATION_HEADER, id);

    expect(res.status).toBe(200);
    expect(res.body.correlationId).toBe(id);
  });

  it('echoes the correlation ID in the response header', async () => {
    const id = 'response-echo-test';
    const res = await supertest(app.server)
      .get('/echo')
      .set(CORRELATION_HEADER, id);

    expect(res.headers[CORRELATION_HEADER]).toBe(id);
  });

  it('generates a new UUID when no header is given and echoes it back', async () => {
    const res = await supertest(app.server).get('/echo');

    const responseId = res.headers[CORRELATION_HEADER] as string;
    const bodyId = res.body.correlationId as string;

    expect(responseId).toBeDefined();
    expect(bodyId).toBeDefined();
    expect(responseId).toBe(bodyId);
    // UUID v4 format
    expect(responseId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('each request without header gets a unique correlation ID', async () => {
    const [r1, r2, r3] = await Promise.all([
      supertest(app.server).get('/echo'),
      supertest(app.server).get('/echo'),
      supertest(app.server).get('/echo'),
    ]);

    const ids = [r1.body.correlationId, r2.body.correlationId, r3.body.correlationId];
    const unique = new Set(ids);
    expect(unique.size).toBe(3);
  });

  it('forwardCorrelationHeader includes the ID in returned object', async () => {
    const id = 'forward-test-456';
    const res = await supertest(app.server)
      .get('/forward')
      .set(CORRELATION_HEADER, id);

    expect(res.status).toBe(200);
    expect(res.body[CORRELATION_HEADER]).toBe(id);
  });
});

describe('extractCorrelationId', () => {
  it('extracts from plain header object', () => {
    const id = extractCorrelationId({ [CORRELATION_HEADER]: 'abc-123' });
    expect(id).toBe('abc-123');
  });

  it('extracts first value from array header', () => {
    const id = extractCorrelationId({ [CORRELATION_HEADER]: ['first', 'second'] });
    expect(id).toBe('first');
  });

  it('generates UUID when header is missing', () => {
    const id = extractCorrelationId({});
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/i);
  });

  it('generates UUID when header is undefined', () => {
    const id = extractCorrelationId({ [CORRELATION_HEADER]: undefined });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});
