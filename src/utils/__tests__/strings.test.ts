import { describe, it, expect } from 'vitest';
import { isNonEmptyString, truncate, capitalize } from '../strings.js';

describe('strings utils', () => {
    describe('isNonEmptyString', () => {
        it('returns true for a non-empty string', () => {
            expect(isNonEmptyString('hello')).toBe(true);
        });

        it('returns false for an empty string', () => {
            expect(isNonEmptyString('')).toBe(false);
        });

        it('returns false for a whitespace-only string', () => {
            expect(isNonEmptyString('   ')).toBe(false);
        });

        it('returns false for non-string values', () => {
            expect(isNonEmptyString(undefined)).toBe(false);
            expect(isNonEmptyString(null)).toBe(false);
            expect(isNonEmptyString(0)).toBe(false);
            expect(isNonEmptyString({})).toBe(false);
        });
    });

    describe('truncate', () => {
        it('returns the input unchanged when shorter than max', () => {
            expect(truncate('hello', 10)).toBe('hello');
        });

        it('returns the input unchanged when exactly at max', () => {
            expect(truncate('hello', 5)).toBe('hello');
        });

        it('appends ellipsis when truncated', () => {
            expect(truncate('hello world', 8)).toBe('hello w…');
        });

        it('supports a custom marker', () => {
            expect(truncate('hello world', 8, '...')).toBe('hello...');
        });

        it('returns clipped marker when max is smaller than the marker', () => {
            expect(truncate('hello world', 1, '...')).toBe('.');
        });
    });

    describe('capitalize', () => {
        it('capitalizes the first letter', () => {
            expect(capitalize('hello')).toBe('Hello');
        });

        it('leaves an empty string unchanged', () => {
            expect(capitalize('')).toBe('');
        });

        it('does not affect the remaining characters', () => {
            expect(capitalize('hELLO')).toBe('HELLO');
        });
    });
});
