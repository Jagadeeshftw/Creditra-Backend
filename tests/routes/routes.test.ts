import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index.js';

const VALID_ADDRESS = 'G' + 'A'.repeat(55);

describe('GET /health', () => {
  it('returns 200 with ok status', async () => {
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

describe('Credit routes', () => {
  describe('GET /api/credit/lines', () => {
    it('returns empty array', async () => {
      const res = await request(app).get('/api/credit/lines');
      expect(res.status).toBe(200);
      expect(res.body.data.creditLines).toEqual([]);
    });
  });

  describe('GET /api/credit/lines/:id', () => {
    it('returns 404', async () => {
      const res = await request(app).get('/api/credit/lines/abc');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Credit line not found');
      expect(res.body.data).toBeNull();
    });
  });

  describe('POST /api/credit/lines', () => {
    it('returns 201 with valid body', async () => {
      const res = await request(app)
        .post('/api/credit/lines')
        .send({ walletAddress: VALID_ADDRESS, requestedLimit: '5000' });

      expect(res.status).toBe(201);
      expect(res.body.data.walletAddress).toBe(VALID_ADDRESS);
      expect(res.body.data.creditLimit).toBe('5000');
      expect(res.body.data.status).toBe('active');
    });

    it('returns 400 when walletAddress is missing', async () => {
      const res = await request(app)
        .post('/api/credit/lines')
        .send({ requestedLimit: '5000' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.data).toBeNull();
      expect(res.body.details.some((d: any) => d.field === 'walletAddress')).toBe(true);
    });

    it('returns 400 when walletAddress is not a valid Stellar address', async () => {
      const res = await request(app)
        .post('/api/credit/lines')
        .send({ walletAddress: 'GABCDEF', requestedLimit: '5000' });

      expect(res.status).toBe(400);
      expect(res.body.details.some((d: any) => d.field === 'walletAddress')).toBe(true);
    });

    it('returns 400 when requestedLimit is non-numeric', async () => {
      const res = await request(app)
        .post('/api/credit/lines')
        .send({ walletAddress: VALID_ADDRESS, requestedLimit: 'abc' });

      expect(res.status).toBe(400);
      expect(res.body.details.some((d: any) => d.field === 'requestedLimit')).toBe(true);
    });

    it('returns 400 when body is empty', async () => {
      const res = await request(app)
        .post('/api/credit/lines')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/credit/lines/:id/draw', () => {
    it('returns 200 with valid body', async () => {
      const res = await request(app)
        .post('/api/credit/lines/line-1/draw')
        .send({ walletAddress: VALID_ADDRESS, amount: '100' });

      expect(res.status).toBe(200);
      expect(res.body.walletAddress).toBe(VALID_ADDRESS);
      expect(res.body.amount).toBe('100');
      expect(res.body.id).toBe('line-1');
      expect(res.body.txHash).toBeNull();
      expect(res.body.status).toBe('pending');
    });

    it('returns 400 when walletAddress is missing', async () => {
      const res = await request(app)
        .post('/api/credit/lines/line-1/draw')
        .send({ amount: '100' });

      expect(res.status).toBe(400);
      expect(res.body.details.some((d: any) => d.field === 'walletAddress')).toBe(true);
    });

    it('returns 400 when walletAddress is not a valid Stellar address', async () => {
      const res = await request(app)
        .post('/api/credit/lines/line-1/draw')
        .send({ walletAddress: 'GABCDEF', amount: '100' });

      expect(res.status).toBe(400);
      expect(res.body.details.some((d: any) => d.field === 'walletAddress')).toBe(true);
    });

    it('returns 400 when amount is missing', async () => {
      const res = await request(app)
        .post('/api/credit/lines/line-1/draw')
        .send({ walletAddress: VALID_ADDRESS });

      expect(res.status).toBe(400);
      expect(res.body.data).toBeNull();
      expect(res.body.details.some((d: any) => d.field === 'amount')).toBe(true);
    });

    it('returns 400 when amount is not numeric string', async () => {
      const res = await request(app)
        .post('/api/credit/lines/line-1/draw')
        .send({ walletAddress: VALID_ADDRESS, amount: 'abc' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/credit/lines/:id/repay', () => {
    it('returns 200 with valid body', async () => {
      const res = await request(app)
        .post('/api/credit/lines/line-1/repay')
        .send({ walletAddress: VALID_ADDRESS, amount: '50' });

      expect(res.status).toBe(200);
      expect(res.body.walletAddress).toBe(VALID_ADDRESS);
      expect(res.body.amount).toBe('50');
      expect(res.body.id).toBe('line-1');
      expect(res.body.txHash).toBeNull();
      expect(res.body.status).toBe('pending');
    });

    it('returns 400 when walletAddress is missing', async () => {
      const res = await request(app)
        .post('/api/credit/lines/line-1/repay')
        .send({ amount: '50' });

      expect(res.status).toBe(400);
      expect(res.body.details.some((d: any) => d.field === 'walletAddress')).toBe(true);
    });

    it('returns 400 when walletAddress is not a valid Stellar address', async () => {
      const res = await request(app)
        .post('/api/credit/lines/line-1/repay')
        .send({ walletAddress: 'GABCDEF', amount: '50' });

      expect(res.status).toBe(400);
      expect(res.body.details.some((d: any) => d.field === 'walletAddress')).toBe(true);
    });

    it('returns 400 when amount is missing', async () => {
      const res = await request(app)
        .post('/api/credit/lines/line-1/repay')
        .send({ walletAddress: VALID_ADDRESS });

      expect(res.status).toBe(400);
      expect(res.body.details.some((d: any) => d.field === 'amount')).toBe(true);
    });

    it('returns 400 when amount is a number (not string)', async () => {
      const res = await request(app)
        .post('/api/credit/lines/line-1/repay')
        .send({ walletAddress: VALID_ADDRESS, amount: 50 });

      expect(res.status).toBe(400);
    });
  });
});

describe('Risk routes', () => {
  describe('POST /api/risk/evaluate', () => {
    it('returns placeholder risk data for valid walletAddress', async () => {
      const res = await request(app)
        .post('/api/risk/evaluate')
        .send({ walletAddress: VALID_ADDRESS });

      expect(res.status).toBe(200);
      expect(res.body.data.walletAddress).toBe(VALID_ADDRESS);
      expect(res.body.data).toHaveProperty('riskScore');
    });

    it('returns 400 when walletAddress is missing', async () => {
      const res = await request(app)
        .post('/api/risk/evaluate')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.data).toBeNull();
      expect(res.body.details.some((d: any) => d.field === 'walletAddress')).toBe(true);
    });

    it('returns 400 when walletAddress is not a valid Stellar address', async () => {
      const res = await request(app)
        .post('/api/risk/evaluate')
        .send({ walletAddress: '' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when walletAddress is not a string', async () => {
      const res = await request(app)
        .post('/api/risk/evaluate')
        .send({ walletAddress: 12345 });

      expect(res.status).toBe(400);
    });
  });
});
