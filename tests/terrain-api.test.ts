/**
 * Unit tests for the API fetch layer (src/terrain/api.ts).
 *
 * Every live terrain/hub/verification feature talks through this module, so its
 * contract is the most load-bearing piece of client plumbing in the app:
 *  - a non-JSON answer (a static host answering with its HTML shell) is never
 *    mistaken for an empty success;
 *  - HTTP errors carry status, machine code and Retry-After;
 *  - timeouts and network failures get friendly, explicit messages.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { terrainApi, ApiError, BackendUnavailableError } from '../src/terrain/api';

function mockResponse(body: unknown, { ok = true, status = 200, contentType = 'application/json', retryAfter = null, jsonThrows = false }: { ok?: boolean; status?: number; contentType?: string; retryAfter?: string | null; jsonThrows?: boolean } = {}) {
  return {
    ok,
    status,
    headers: {
      get: (k: string) => {
        const key = k.toLowerCase();
        if (key === 'content-type') return contentType;
        if (key === 'retry-after') return retryAfter;
        return null;
      },
    },
    json: jsonThrows ? () => Promise.reject(new Error('invalid JSON')) : () => Promise.resolve(body),
  };
}

describe('terrainApi fetch layer', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('returns the parsed body for a healthy 200 JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse({ dem_ready: true, engine: 'native-go' })));
    const cfg = await terrainApi.config();
    expect(cfg.dem_ready).toBe(true);
    expect(cfg.engine).toBe('native-go');
  });

  it('rejects a static host answering with HTML (200, non-JSON content-type)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse('<!doctype html>', { ok: true, status: 200, contentType: 'text/html' })));
    await expect(terrainApi.config()).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it('rejects a 200 whose body is not valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(null, { jsonThrows: true })));
    await expect(terrainApi.config()).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it('rejects a 200 whose body parses to a non-object', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(42)));
    await expect(terrainApi.config()).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it('maps JSON error responses to ApiError with status, code and Retry-After', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse({ error: 'Too many requests. Please wait.', code: 'rate_limited' }, { ok: false, status: 429, retryAfter: '17' })));
    const err = await terrainApi.config().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterS).toBe(17);
    expect(err.message).toBe('Too many requests. Please wait.');
  });

  it('falls back to a generic message when the error body has no message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse({ code: 'x' }, { ok: false, status: 503 })));
    await expect(terrainApi.config()).rejects.toThrow(/Request failed \(503\)/);
  });

  it('ignores an unparseable Retry-After header', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse({ error: 'nope' }, { ok: false, status: 429, retryAfter: 'not-a-number' })));
    const err = await terrainApi.config().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.retryAfterS).toBeNull();
  });

  it('treats a network-level TypeError as the backend being unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const err = await terrainApi.config().catch((e) => e);
    expect(err).toBeInstanceOf(BackendUnavailableError);
  });

  it('maps an aborted request (timeout) to a friendly error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_path: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const pending = terrainApi.config();
    const expectation = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(120_000);
    await expectation;
  });

  it('POSTs JSON with a content-type header for terrain requests', async () => {
    const calls: Array<{ path: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
      calls.push({ path, init });
      return mockResponse({ mode: 'synthetic', site: {} });
    }));
    await terrainApi.terrain({ latitude: -89.5, longitude: 45, radius_km: 2, quality: 'low', mode: 'synthetic' });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/api/terrain');
    expect((calls[0].init as RequestInit).method).toBe('POST');
    expect((calls[0].init as RequestInit).headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse((calls[0].init as RequestInit).body as string)).toMatchObject({ latitude: -89.5, longitude: 45, radius_km: 2 });
  });
});
