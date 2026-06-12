/**
 * Lightweight `Result<T, E>` type for cases where throwing exceptions is
 * undesirable (typically across module boundaries that want to model
 * "expected failure" explicitly).
 *
 * Adopt this incrementally — it is not a replacement for the standard
 * `throw`/`try`/`catch` flow, and existing call sites should not be
 * refactored without a paired functional change.
 */

export interface Ok<T> {
    readonly ok: true;
    readonly value: T;
}

export interface Err<E> {
    readonly ok: false;
    readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

/** Constructs a successful result. */
export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

/** Constructs a failed result. */
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/** Type guard: narrows a `Result` to the success variant. */
export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;

/** Type guard: narrows a `Result` to the failure variant. */
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok;
