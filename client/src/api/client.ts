// Thin fetch wrapper with error normalization + 401 PIN_REQUIRED signalling.

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

// When a request hits 401 PIN_REQUIRED, we broadcast so the app can show the PIN screen.
export const PIN_REQUIRED_EVENT = 'collectory:pin-required';

function signalPinRequired() {
  window.dispatchEvent(new CustomEvent(PIN_REQUIRED_EVENT));
}

async function parseError(res: Response): Promise<ApiRequestError> {
  let message = `Request failed (${res.status})`;
  let code: string | undefined;
  try {
    const body = await res.json();
    if (body?.error?.message) message = body.error.message;
    if (body?.error?.code) code = body.error.code;
  } catch {
    // non-JSON error body
  }
  return new ApiRequestError(message, res.status, code);
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await parseError(res);
    if (res.status === 401 && err.code === 'PIN_REQUIRED') {
      signalPinRequired();
    }
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

const BASE = '/api';

function qs(params?: Record<string, unknown>): string {
  if (!params) return '';
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export const api = {
  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${BASE}${path}${qs(params)}`, { credentials: 'same-origin' });
    return handle<T>(res);
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return handle<T>(res);
  },

  async patch<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return handle<T>(res);
  },

  async put<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return handle<T>(res);
  },

  async del<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${BASE}${path}${qs(params)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    return handle<T>(res);
  },

  // multipart/form-data with optional upload progress (uses XHR for progress events).
  async upload<T>(
    path: string,
    form: FormData,
    onProgress?: (fraction: number) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}${path}`);
      xhr.withCredentials = true;
      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(e.loaded / e.total);
        };
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(xhr.responseText ? (JSON.parse(xhr.responseText) as T) : (undefined as T));
          } catch {
            resolve(undefined as T);
          }
        } else {
          let message = `Upload failed (${xhr.status})`;
          let code: string | undefined;
          try {
            const body = JSON.parse(xhr.responseText);
            if (body?.error?.message) message = body.error.message;
            if (body?.error?.code) code = body.error.code;
          } catch {
            /* ignore */
          }
          if (xhr.status === 401 && code === 'PIN_REQUIRED') signalPinRequired();
          reject(new ApiRequestError(message, xhr.status, code));
        }
      };
      xhr.onerror = () => reject(new ApiRequestError('Network error', 0));
      xhr.send(form);
    });
  },

  // Trigger a browser download for endpoints that stream files.
  downloadUrl(path: string, params?: Record<string, unknown>): string {
    return `${BASE}${path}${qs(params)}`;
  },
};
