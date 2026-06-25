import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: { status: 'ok', service: 'creditra-backend' },
      error: null,
    });
    expect(res.body.data).toHaveProperty('ready');
    expect(res.body.data).toHaveProperty('dependencies');
  });
});

describe('GET /docs.json', () => {
  it('returns the parsed OpenAPI spec', async () => {
    const res = await request(app).get('/docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.info.title).toBe('Creditra API');
    expect(res.body.paths).toHaveProperty('/api/reconciliation/trigger');
    expect(res.body.paths).toHaveProperty('/api/reconciliation/status');
  });
});

describe('GET /api/reconciliation/status', () => {
  it('is mounted and rejects unauthenticated callers', async () => {
    const res = await request(app).get('/api/reconciliation/status');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });
});

describe('GET /api/credit/lines', () => {
  it('returns 200 with empty creditLines array', async () => {
    const res = await request(app).get('/api/credit/lines');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('creditLines');
    expect(Array.isArray(res.body.data.creditLines)).toBe(true);
  });
});

describe('GET /api/credit/lines/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/credit/lines/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ data: null, error: 'Credit line not found' });
  });
});

describe('POST /api/risk/evaluate', () => {
  it('returns 400 when walletAddress is missing', async () => {
    const res = await request(app).post('/api/risk/evaluate').send({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ data: null, error: 'Validation failed' });
  });

  it('returns 200 with risk fields when walletAddress provided', async () => {
    const res = await request(app)
      .post('/api/risk/evaluate')
      .send({ walletAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    expect(res.status).toBe(200);
    expect(res.body.data.walletAddress).toBe('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(res.body.data).toHaveProperty('riskScore');
    expect(res.body.data).toHaveProperty('creditLimit');
    expect(res.body.data).toHaveProperty('interestRateBps');
    expect(res.body.data).toHaveProperty('message');
  });
});
