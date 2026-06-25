import { z } from 'zod';
import { TransactionType } from '../models/Transaction.js';
import { isValidStellarAddress } from '../utils/stellarAddress.js';

const numericString = /^\d+(\.\d+)?$/;
const isoDateTime = z.string().datetime({ offset: true });
const positiveIntString = z.coerce.number().int().positive();
const nonNegativeIntString = z.coerce.number().int().min(0);

const stellarAddressField = z
  .string()
  .refine(isValidStellarAddress, 'walletAddress must be a valid Stellar address');

export const createCreditLineSchema = z.object({
  walletAddress: stellarAddressField,
  creditLimit: z
    .string()
    .regex(numericString, 'creditLimit must be a numeric string')
    .optional(),
  requestedLimit: z
    .string()
    .regex(numericString, 'requestedLimit must be a numeric string')
    .optional(),
  interestRateBps: nonNegativeIntString.optional(),
}).strict().refine(data => data.creditLimit || data.requestedLimit, {
  message: "Either creditLimit or requestedLimit must be provided",
  path: ["creditLimit"]
});

export type CreateCreditLineBody = z.infer<typeof createCreditLineSchema>;

export const creditLinesQuerySchema = z.object({
  offset: nonNegativeIntString.optional(),
  limit: positiveIntString.max(100).optional(),
}).strict();

export type CreditLinesQuery = z.infer<typeof creditLinesQuerySchema>;

export const drawSchema = z.object({
  walletAddress: stellarAddressField,
  amount: z
    .string()
    .min(1, 'amount is required')
    .regex(numericString, 'amount must be a numeric string'),
}).strict();

export type DrawBody = z.infer<typeof drawSchema>;

export const repaySchema = z.object({
  walletAddress: stellarAddressField,
  amount: z
    .string()
    .min(1, 'amount is required')
    .regex(numericString, 'amount must be a numeric string'),
}).strict();

export type RepayBody = z.infer<typeof repaySchema>;

export const transactionHistoryQuerySchema = z.object({
  type: z.nativeEnum(TransactionType).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  page: positiveIntString.optional(),
  limit: positiveIntString.max(100).optional(),
}).strict();

export type TransactionHistoryQuery = z.infer<typeof transactionHistoryQuerySchema>;
