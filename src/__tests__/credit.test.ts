import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { createCreditLine, _resetStore } from '../services/creditService.js';

const VALID_KEY = 'integration-test-key';

beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_API_KEY = VALID_KEY;
});

beforeEach(() => {
    _resetStore();
});

afterAll(() => {
    delete process.env.ADMIN_API_KEY;
});

describe('GET /api/credit/lines (public)', () => {
    it('returns 200 without any API key', async () => {
        const res = await request(app).get('/api/credit/lines');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveProperty('creditLines');
    });
});

describe('GET /api/credit/lines/:id (public)', () => {
    it('returns 404 without any API key', async () => {
        const res = await request(app).get('/api/credit/lines/abc');
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('Credit line not found');
    });
});

describe('POST /api/credit/lines/:id/suspend (admin – requires API key)', () => {
    it('returns 401 when x-api-key header is missing', async () => {
        const res = await request(app).post('/api/credit/lines/123/suspend');
        expect(res.status).toBe(401);
        expect(res.body.error).toContain('Unauthorized');
    });

    it('returns 401 when x-admin-api-key header has a wrong value', async () => {
        const res = await request(app)
            .post('/api/credit/lines/123/suspend')
            .set('x-admin-api-key', 'bad-key');
        expect(res.status).toBe(401);
        expect(res.body.error).toContain('Unauthorized');
    });

    it('does not expose the wrong key value in the 403 body', async () => {
        const badKey = 'do-not-echo-me';
        const res = await request(app)
            .post('/api/credit/lines/123/suspend')
            .set('x-admin-api-key', badKey);
        expect(res.status).toBe(401);
        expect(JSON.stringify(res.body)).not.toContain(badKey);
    });

    it('returns 200 with the valid API key', async () => {
        createCreditLine('123');
        const res = await request(app)
            .post('/api/credit/lines/123/suspend')
            .set('x-admin-api-key', VALID_KEY);
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Credit line suspended.');
        expect(res.body.data.id).toBe('123');
    });
});

describe('POST /api/credit/lines/:id/close (admin – requires API key)', () => {
    it('returns 401 when x-api-key header is missing', async () => {
        const res = await request(app).post('/api/credit/lines/456/close');
        expect(res.status).toBe(401);
        expect(res.body.error).toContain('Unauthorized');
    });

    it('returns 401 when x-admin-api-key header has a wrong value', async () => {
        const res = await request(app)
            .post('/api/credit/lines/456/close')
            .set('x-admin-api-key', 'wrong-key');
        expect(res.status).toBe(401);
        expect(res.body.error).toContain('Unauthorized');
    });

    it('returns 200 with the valid API key', async () => {
        createCreditLine('456');
        const res = await request(app)
            .post('/api/credit/lines/456/close')
            .set('x-admin-api-key', VALID_KEY)
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Credit line closed.');
        expect(res.body.data.id).toBe('456');
    });
});
