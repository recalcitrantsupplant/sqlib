export const AUTH_ENV_KEY_REGEX = /^[A-Z0-9_]+$/;

function applyCommonTransforms(value: string): string {
  let normalized = value.toUpperCase();
  normalized = normalized.replace(/[^A-Z0-9_]/g, '_');
  normalized = normalized.replace(/_+/g, '_');
  normalized = normalized.replace(/^_+/, '').replace(/_+$/, '');
  if (normalized.length === 0) {
    return '';
  }
  if (/^\d/.test(normalized)) {
    normalized = `B_${normalized}`;
  }
  return normalized;
}

export function normalizeAuthEnvKey(input: string | null | undefined): string | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }
  const trimmed = input.toString().trim();
  if (!trimmed) {
    return undefined;
  }
  const normalized = applyCommonTransforms(trimmed);
  return normalized || undefined;
}

export function deriveAuthEnvKeyFromName(name: string | null | undefined): string {
  if (!name) {
    return '';
  }
  return applyCommonTransforms(name);
}

export function ensureAuthEnvKey(options: { provided?: string | null; fallbackName: string }): string | undefined {
  const provided = normalizeAuthEnvKey(options.provided ?? undefined);
  if (provided) {
    return provided;
  }
  const derived = deriveAuthEnvKeyFromName(options.fallbackName);
  return derived || undefined;
}

export function buildBackendAuthEnvVarNames(authEnvKey?: string | null) {
  const key = normalizeAuthEnvKey(authEnvKey);
  if (!key) {
    return null;
  }
  const base = `SQLIB_BACKEND_${key}`;
  return {
    base,
    key,
    username: `${base}_USERNAME`,
    password: `${base}_PASSWORD`,
    authHeader: `${base}_AUTH_HEADER`,
  };
}
