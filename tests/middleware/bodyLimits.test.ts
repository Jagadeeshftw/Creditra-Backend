import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index.js';

describe('JSON body size limit', () => {
  it('accepts a payload within the 100kb limit', async () => {
    const res = await request(app)
      .post('/api/risk/evaluate')
      .set('Content-Type', 'application/json')
      .send({ walletAddress: '0x123' });

    expect(res.status).not.toBe(413);
  });

  it('returns 413 for a payload exceeding 100kb', async () => {
    // ~110 kb of JSON
    const largeBody = JSON.stringify({ walletAddress: 'x'.repeat(110 * 1024) });

    const res = await request(app)
      .post('/api/risk/evaluate')
      .set('Content-Type', 'application/json')
      .send(largeBody);

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      data: null,
      error: expect.stringContaining('100kb'),
    });
  });
});

describe('Content-Type enforcement', () => {
  it('returns 415 when Content-Type is text/plain on a POST route', async () => {
    const res = await request(app)
      .post('/api/risk/evaluate')
      .set('Content-Type', 'text/plain')
      .send('walletAddress=0x123');

    expect(res.status).toBe(415);
    expect(res.body).toMatchObject({
      data: null,
      error: expect.stringContaining('application/json'),
    });
  });

  it('returns 415 for form-encoded bodies on JSON routes', async () => {
    const res = await request(app)
      .post('/api/risk/evaluate')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('walletAddress=0x123');

    expect(res.status).toBe(415);
  });

  it('does not enforce Content-Type on GET requests', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('allows a valid JSON POST through', async () => {
    const res = await request(app)
      .post('/api/risk/evaluate')
      .set('Content-Type', 'application/json')
      .send({ walletAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });

    expect(res.status).toBe(200);
  });
});
