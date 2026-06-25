import request from 'supertest';
import express from 'express';
import { creditRouter } from '../src/routes/credit.js';

const VALID_ADDRESS = 'G' + 'A'.repeat(55);

const app = express();
app.use(express.json());
app.use('/api/credit', creditRouter);

describe('POST /api/credit/lines/:id/draw', () => {
     it('should draw successfully with valid body', async () => {
          const res = await request(app)
               .post('/api/credit/lines/line-1/draw')
               .send({ walletAddress: VALID_ADDRESS, amount: '200' });

          expect(res.status).toBe(200);
          expect(res.body.id).toBe('line-1');
          expect(res.body.walletAddress).toBe(VALID_ADDRESS);
          expect(res.body.amount).toBe('200');
          expect(res.body.txHash).toBeNull();
          expect(res.body.status).toBe('pending');
     });

     it('should return 400 when walletAddress is missing', async () => {
          const res = await request(app)
               .post('/api/credit/lines/line-1/draw')
               .send({ amount: '100' });

          expect(res.status).toBe(400);
          expect(res.body.details.some((d: any) => d.field === 'walletAddress')).toBe(true);
     });

     it('should return 400 when walletAddress is not a valid Stellar address', async () => {
          const res = await request(app)
               .post('/api/credit/lines/line-1/draw')
               .send({ walletAddress: 'GABCDEF', amount: '100' });

          expect(res.status).toBe(400);
          expect(res.body.details.some((d: any) => d.field === 'walletAddress')).toBe(true);
     });

     it('should return 400 when amount is missing', async () => {
          const res = await request(app)
               .post('/api/credit/lines/line-1/draw')
               .send({ walletAddress: VALID_ADDRESS });

          expect(res.status).toBe(400);
          expect(res.body.details.some((d: any) => d.field === 'amount')).toBe(true);
     });

     it('should return 400 when amount is not a numeric string', async () => {
          const res = await request(app)
               .post('/api/credit/lines/line-1/draw')
               .send({ walletAddress: VALID_ADDRESS, amount: 'abc' });

          expect(res.status).toBe(400);
     });

     it('should return 400 when body is empty', async () => {
          const res = await request(app)
               .post('/api/credit/lines/line-1/draw')
               .send({});

          expect(res.status).toBe(400);
     });
});
