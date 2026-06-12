import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    ONE_SECOND_MS,
    ONE_MINUTE_MS,
    ONE_HOUR_MS,
    ONE_DAY_MS,
    sleep,
    nowSeconds,
} from '../time.js';

describe('time utils', () => {
    it('exposes consistent duration constants', () => {
        expect(ONE_SECOND_MS).toBe(1000);
        expect(ONE_MINUTE_MS).toBe(60 * 1000);
        expect(ONE_HOUR_MS).toBe(60 * 60 * 1000);
        expect(ONE_DAY_MS).toBe(24 * 60 * 60 * 1000);
    });

    describe('sleep', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('resolves after the requested delay', async () => {
            const promise = sleep(50);
            vi.advanceTimersByTime(50);
            await expect(promise).resolves.toBeUndefined();
        });

        it('treats negative durations as zero', async () => {
            const promise = sleep(-100);
            vi.advanceTimersByTime(0);
            await expect(promise).resolves.toBeUndefined();
        });
    });

    describe('nowSeconds', () => {
        it('returns a finite integer near the current epoch second', () => {
            const value = nowSeconds();
            expect(Number.isInteger(value)).toBe(true);
            expect(value).toBeGreaterThan(0);
        });
    });
});
