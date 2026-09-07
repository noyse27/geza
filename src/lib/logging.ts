import { AsyncLocalStorage } from 'node:async_hooks';
import { query } from './db';

export const logContext = new AsyncLocalStorage<Record<string, unknown>>();
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[gekürzt]';
  if (value instanceof Error)
    return redact({ name: value.name, message: value.message, cause: value.cause }, depth + 1);
  if (typeof value === 'string')
    return value
      .replace(/\/api\/plex\/[^\s?"/]+/gi, '/api/plex/[REDACTED]')
      .replace(/([?&](?:[^=&\s]*(?:token|key|secret|password|pin)[^=&\s]*)=)[^&\s]+/gi, '$1[REDACTED]')
      .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
      .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[REDACTED]@')
      .slice(0, 2000);
  if (Array.isArray(value)) return value.slice(0, 30).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([k, v]) => [
          k,
          /token|secret|password|authorization|cookie|apikey|api_key|pin/i.test(k)
            ? '[REDACTED]'
            : redact(v, depth + 1),
        ]),
    );
  return value;
}
export async function logEvent(
  level: 'info' | 'warn' | 'error',
  source: string,
  message: string,
  context: Record<string, unknown> = {},
) {
  const safe = redact({ ...logContext.getStore(), ...context });
  try {
    await query('INSERT INTO event_logs(level,source,message,context) VALUES($1,$2,$3,$4)', [
      level,
      source,
      redact(message),
      JSON.stringify(safe),
    ]);
  } catch {
    console.error(
      'Ereignisprotokoll nicht verfügbar',
      JSON.stringify({ level, source, message: redact(message), context: safe }),
    );
  }
}
export async function loggedFetch(provider: string, url: string, init: RequestInit = {}) {
  const started = Date.now();
  const context = { provider, url, method: init.method || 'GET' };
  await logEvent('info', 'provider', 'Anbieterabfrage gestartet', context);
  try {
    const response = await fetch(url, init);
    await logEvent(
      response.ok ? 'info' : 'warn',
      'provider',
      response.ok ? 'Anbieterabfrage erfolgreich' : 'Anbieter meldet HTTP-Fehler',
      { ...context, status: response.status, durationMs: Date.now() - started },
    );
    if (!response.ok)
      throw Error(
        `${provider}: HTTP ${response.status} bei ${init.method || 'GET'} ${redact(url)}${response.status === 404 ? ' – Ressource unter dieser Anbieter-ID nicht gefunden.' : ''}`,
      );
    return response;
  } catch (error) {
    await logEvent('error', 'provider', 'Anbieterabfrage fehlgeschlagen', {
      ...context,
      error,
      durationMs: Date.now() - started,
    });
    throw error;
  }
}
