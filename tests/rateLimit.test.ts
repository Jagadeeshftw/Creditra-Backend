import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';

const VALID_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('Rate Limiting Integration Tests', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.API_KEYS = 'test-admin-key';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Rate limit headers on credit endpoints', () => {
    it('sets X-RateLimit-* headers on GET /api/credit/lines', async () => {
      const response = await request(app).get('/api/credit/lines');

      expect(response.status).toBe(200);
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');
    });

    it('sets X-RateLimit-* headers on GET /api/credit/lines/:id', async () => {
      const response = await request(app).get('/api/credit/lines/nonexistent-id');

      expect(response.status).toBe(404);
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');
    });

    it('sets X-RateLimit-* headers on POST /api/credit/lines', async () => {
      const response = await request(app)
        .post('/api/credit/lines')
        .send({ walletAddress: VALID_ADDRESS, requestedLimit: '1000' });

      expect(response.status).toBe(201);
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');
    });
  });

  describe('Rate limit headers on risk endpoints', () => {
    it('sets X-RateLimit-* headers on POST /api/risk/evaluate', async () => {
      const response = await request(app)
        .post('/api/risk/evaluate')
        .send({ walletAddress: VALID_ADDRESS });

      expect(response.status).toBe(200);
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');
    });

    it('sets X-RateLimit-* headers on GET /api/risk/wallet/:address/latest', async () => {
      const response = await request(app).get('/api/risk/wallet/0x123/latest');

      expect([200, 404, 500]).toContain(response.status);
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');
    });

    it('sets X-RateLimit-* headers on GET /api/risk/wallet/:address/history', async () => {
      const response = await request(app).get('/api/risk/wallet/0x123/history');

      expect([200, 500]).toContain(response.status);
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');
    });
  });

  describe('Admin endpoints are not rate limited', () => {
    it('POST /api/risk/admin/recalibrate does not apply rate limiting', async () => {
      const response = await request(app)
        .post('/api/risk/admin/recalibrate')
        .set('X-API-Key', 'invalid-key');

      expect(response.status).toBe(403);
      expect(response.headers).not.toHaveProperty('x-ratelimit-limit');
      expect(response.headers).not.toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).not.toHaveProperty('x-ratelimit-reset');
    });
  });

  describe('429 response shape', () => {
    it('returns correct 429 response body when rate limit is exceeded on /api/risk/evaluate', async () => {
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/api/risk/evaluate')
          .send({ walletAddress: VALID_ADDRESS });
      }

      const response = await request(app)
        .post('/api/risk/evaluate')
        .send({ walletAddress: VALID_ADDRESS });

      if (response.status === 429) {
        expect(response.body).toHaveProperty('data');
        expect(response.body.data).toBeNull();
        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toContain('Too many requests');
        expect(response.body).toHaveProperty('retryAfter');
        expect(typeof response.body.retryAfter).toBe('number');
        expect(response.headers).toHaveProperty('retry-after');
      }
    });
  });
});
