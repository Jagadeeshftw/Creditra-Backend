import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';

describe('API Integration Tests', () => {

    describe('GET /health', () => {
        it('returns a successful envelope with health status', async () => {
            const response = await request(app).get('/health');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(response.body).toHaveProperty('error', null);
            expect(response.body.data).toMatchObject({
                status: 'ok',
                service: 'creditra-backend',
            });
            expect(response.body.data).toHaveProperty('ready');
            expect(response.body.data).toHaveProperty('dependencies');
        });
    });

    describe('Credit Routes', () => {
        it('GET /api/credit/lines returns a successful envelope', async () => {
            const response = await request(app).get('/api/credit/lines');

            expect(response.status).toBe(200);
            expect(response.body).toEqual({
                data: {
                    creditLines: [],
                    pagination: {
                        total: 0,
                        offset: 0,
                        limit: 100
                    }
                },
                error: null
            });
        });

        it('GET /api/credit/lines/:id returns a standard failure envelope for 404', async () => {
            const response = await request(app).get('/api/credit/lines/123');

            expect(response.status).toBe(404);
            expect(response.body).toEqual({
                data: null,
                error: 'Credit line not found'
            });
        });
    });

    describe('Risk Routes', () => {
        it('POST /api/risk/evaluate returns a standard failure envelope for missing body', async () => {
            const response = await request(app).post('/api/risk/evaluate').send({});

            expect(response.status).toBe(400);
            expect(response.body).toMatchObject({
                error: 'Validation failed'
            });
        });

        it('POST /api/risk/evaluate returns a successful envelope with risk status', async () => {
            const response = await request(app)
                .post('/api/risk/evaluate')
                .send({ walletAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                data: {
                    walletAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                    message: expect.any(String),
                },
                error: null
            });
        });
    });

});
