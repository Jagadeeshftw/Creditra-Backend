import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../src/middleware/errorHandler.js';

function buildApp() {
  const app = express();
  app.get('/error', (_req, _res) => {
    throw new Error('boom');
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler middleware', () => {
  it('returns 500 JSON on unhandled error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(buildApp()).get('/error');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ data: null, error: 'Internal server error' });
    spy.mockRestore();
  });

  it('logs the error to console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await request(buildApp()).get('/error');

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
