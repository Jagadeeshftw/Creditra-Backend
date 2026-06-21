const STELLAR_ADDRESS_REGEX = /\bG[A-Z2-7]{55}\b/g;
const STELLAR_SECRET_SEED_REGEX = /\bS[A-Z2-7]{55}\b/g;
const STELLAR_MUXED_ACCOUNT_REGEX = /\bM[A-Z2-7]{68}\b/g;
const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isLogRedactionDebugEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const flag = env['LOG_REDACTION_DEBUG'];
  if (!flag) {
    return false;
  }

  const normalized = flag.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

export function redactLogString(
  value: string,
  debugEnabled = isLogRedactionDebugEnabled(),
): string {
  if (debugEnabled) {
    return value;
  }

  return value
    .replace(STELLAR_SECRET_SEED_REGEX, '[REDACTED_STELLAR_SECRET]')
    .replace(STELLAR_MUXED_ACCOUNT_REGEX, '[REDACTED_MUXED_ACCOUNT]')
    .replace(EMAIL_REGEX, '[REDACTED_EMAIL]')
    .replace(STELLAR_ADDRESS_REGEX, truncateAddress);
}

function redactValueInternal(
  value: unknown,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === 'string') {
    return redactLogString(value, false);
  }

  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
  }

  if (value instanceof Error) {
    const redactedError = new Error(redactLogString(value.message, false));
    redactedError.name = value.name;
    if (value.stack) {
      redactedError.stack = redactLogString(value.stack, false);
    }

    const extra = value as unknown as Record<string, unknown>;
    for (const [key, nested] of Object.entries(extra)) {
      (redactedError as unknown as Record<string, unknown>)[key] =
        redactValueInternal(nested, seen);
    }

    return redactedError;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValueInternal(entry, seen));
  }

  if (isPlainObject(value)) {
    const redacted: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      redacted[key] = redactValueInternal(nested, seen);
    }

    return redacted;
  }

  return value;
}

export function redactLogValue<T>(
  value: T,
  debugEnabled = isLogRedactionDebugEnabled(),
): T {
  if (debugEnabled) {
    return value;
  }

  return redactValueInternal(value, new WeakSet<object>()) as T;
}

export function redactLogArgs(
  args: unknown[],
  debugEnabled = isLogRedactionDebugEnabled(),
): unknown[] {
  if (debugEnabled) {
    return args;
  }

  return args.map((arg) => redactLogValue(arg, false));
}
