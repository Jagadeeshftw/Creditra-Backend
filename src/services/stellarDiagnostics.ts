const STELLAR_PUBLIC_KEY_REGEX = /\bG[A-Z2-7]{55}\b/g;
const STELLAR_SECRET_KEY_REGEX = /\bS[A-Z2-7]{55}\b/g;

const REDACTED_PUBLIC_KEY = '[REDACTED_STELLAR_PUBLIC_KEY]';
const REDACTED_SECRET_KEY = '[REDACTED_STELLAR_SECRET_KEY]';

export function sanitizeStellarDiagnostic(value: unknown): string {
  return stringifyForDiagnostic(value)
    .replace(STELLAR_SECRET_KEY_REGEX, REDACTED_SECRET_KEY)
    .replace(STELLAR_PUBLIC_KEY_REGEX, REDACTED_PUBLIC_KEY);
}

export function sanitizeJsonForStellarDiagnostics(value: unknown): string {
  try {
    return sanitizeStellarDiagnostic(JSON.stringify(value, diagnosticJsonReplacer, 2));
  } catch {
    return sanitizeStellarDiagnostic(value);
  }
}

function stringifyForDiagnostic(value: unknown): string {
  if (value instanceof Error) {
    const errorName = value.name || 'Error';
    return `${errorName}: ${value.message}`;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, diagnosticJsonReplacer);
  } catch {
    return String(value);
  }
}

function diagnosticJsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
