/**
 * Thin HTTP helper for end-to-end tests.
 *
 * Wraps fetch calls and provides convenience methods for the common
 * auth → upload → convert → poll → download workflow.
 */
import http from 'http';
import https from 'https';
import { BASE_URLS } from '../tests/setup';

// ─── Simple HTTP client (no external deps) ───────────────────────────────────

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Record<string, string>;
}

function request<T>(
  method: string,
  url: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResponse<T>> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const client  = isHttps ? https : http;

    const payload = options.body ? JSON.stringify(options.body) : undefined;

    const req = client.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
          ...(options.headers ?? {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          let body: T;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString()) as T;
          } catch {
            body = Buffer.concat(chunks).toString() as unknown as T;
          }
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            headers[k] = Array.isArray(v) ? v.join(', ') : (v ?? '');
          }
          resolve({ status: res.statusCode ?? 0, body, headers });
        });
      },
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── API helpers ──────────────────────────────────────────────────────────────

export async function registerUser(email: string, password: string) {
  return request<any>('POST', `${BASE_URLS.auth}/api/v1/auth/register`, {
    body: { email, password },
  });
}

export async function loginUser(email: string, password: string) {
  return request<any>('POST', `${BASE_URLS.auth}/api/v1/auth/login`, {
    body: { email, password },
  });
}

export async function getUploadUrl(
  token: string,
  filename: string,
  contentType: string,
  size: number,
) {
  return request<any>('POST', `${BASE_URLS.upload}/api/v1/uploads`, {
    body: { filename, contentType, size },
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function submitConversion(
  token: string,
  sourceFileId: string,
  targetFormat: string,
  options: Record<string, unknown> = {},
) {
  return request<any>('POST', `${BASE_URLS.orchestrator}/api/v1/conversions`, {
    body: { sourceFileId, targetFormat, options },
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function pollJobStatus(token: string, jobId: string) {
  return request<any>('GET', `${BASE_URLS.orchestrator}/api/v1/conversions/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getProfile(token: string) {
  return request<any>('GET', `${BASE_URLS.user}/api/v1/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}
