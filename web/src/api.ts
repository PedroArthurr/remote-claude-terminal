import {
  API,
  type ApiError,
  type AuthStatus,
  type CreateSessionRequest,
  type Favorite,
  type RenameSessionRequest,
  type SessionInfo,
} from '@ccc/shared';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({ error: res.statusText }))) as T | ApiError;
  if (!res.ok) throw new HttpError(res.status, (data as ApiError).error ?? res.statusText);
  return data as T;
}

export const api = {
  authStatus: () => call<AuthStatus>('GET', API.auth),
  login: (token: string) => call<AuthStatus>('POST', API.auth, { token }),
  logout: () => call<AuthStatus>('DELETE', API.auth),
  favorites: () => call<Favorite[]>('GET', API.favorites),
  createSession: (req: CreateSessionRequest) => call<SessionInfo>('POST', API.sessions, req),
  renameSession: (id: string, req: RenameSessionRequest) =>
    call<SessionInfo>('PATCH', `${API.sessions}/${encodeURIComponent(id)}`, req),
  killSession: (id: string) => call<void>('DELETE', `${API.sessions}/${encodeURIComponent(id)}`),
};
