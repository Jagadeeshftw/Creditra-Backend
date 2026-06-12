/**
 * Small string helpers used across the codebase.
 *
 * These functions are pure and have no I/O. They are intentionally kept
 * dependency-free so they can be safely used from any layer (route,
 * service, or repository) without introducing import cycles.
 */

/**
 * Returns `true` when the value is a non-empty string after trimming.
 *
 * @param value Any value to check.
 */
export const isNonEmptyString = (value: unknown): value is string => {
    return typeof value === 'string' && value.trim().length > 0;
};

/**
 * Truncates a string to the given maximum length, appending an ellipsis
 * marker when truncation occurs. Useful for log lines that should not
 * contain unbounded user input.
 *
 * @param input  The input string.
 * @param max    Maximum total length, including the marker.
 * @param marker Truncation marker. Defaults to a single ellipsis.
 */
export const truncate = (input: string, max: number, marker = '…'): string => {
    if (input.length <= max) return input;
    if (max <= marker.length) return marker.slice(0, max);
    return input.slice(0, max - marker.length) + marker;
};

/**
 * Returns a string with the first character upper-cased. Returns the
 * original value when given an empty string.
 */
export const capitalize = (input: string): string => {
    if (input.length === 0) return input;
    return input.charAt(0).toUpperCase() + input.slice(1);
};
