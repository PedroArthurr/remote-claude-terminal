import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Request, Response, NextFunction, Router } from 'express';
import express from 'express';
import { API, type ApiError, type AuthStatus } from '@ccc/shared';

const COOKIE = 'ccc_auth';
const COOKIE_MAX_AGE_SEC = 365 * 24 * 3600;
// Failed logins allowed per window (global: behind `tailscale serve` every request is from loopback).
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 5 * 60_000;

export interface Auth {
  isAuthed(req: IncomingMessage): boolean;
  /** Rejects /api/* (except auth and health) without a valid cookie. */
  guard(req: Request, res: Response, next: NextFunction): void;
  routes(): Router;
}

export function createAuth(token: string): Auth {
  // Cookie holds a value derived from the token: rotating the token logs every device out.
  const cookieValue = createHmac('sha256', token).update('ccc-cookie-v1').digest('base64url');
  let fails = 0;
  let windowStart = 0;

  const isAuthed = (req: IncomingMessage) => safeEqual(readCookie(req, COOKIE), cookieValue);

  return {
    isAuthed,

    guard(req, res, next) {
      const open = !req.path.startsWith('/api/') || req.path === API.auth || req.path === API.health;
      if (open || isAuthed(req)) return next();
      res.status(401).json({ error: 'unauthorized' } satisfies ApiError);
    },

    routes() {
      const r = express.Router();
      r.get(API.auth, (req, res) => {
        res.json({ authed: isAuthed(req) } satisfies AuthStatus);
      });
      r.post(API.auth, (req, res) => {
        const now = Date.now();
        if (now - windowStart > FAIL_WINDOW_MS) {
          windowStart = now;
          fails = 0;
        }
        if (fails >= MAX_FAILS) {
          res.status(429).json({ error: 'too many attempts, wait a few minutes' } satisfies ApiError);
          return;
        }
        const given = (req.body as { token?: unknown } | undefined)?.token;
        if (typeof given !== 'string' || !safeEqual(given.trim(), token)) {
          fails++;
          res.status(401).json({ error: 'invalid token' } satisfies ApiError);
          return;
        }
        res.setHeader('Set-Cookie', serializeCookie(cookieValue, COOKIE_MAX_AGE_SEC, isHttps(req)));
        res.json({ authed: true } satisfies AuthStatus);
      });
      r.delete(API.auth, (req, res) => {
        res.setHeader('Set-Cookie', serializeCookie('', 0, isHttps(req)));
        res.json({ authed: false } satisfies AuthStatus);
      });
      return r;
    },
  };
}

function serializeCookie(value: string, maxAge: number, secure: boolean): string {
  const parts = [`${COOKIE}=${value}`, 'Path=/', `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Strict'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// The server only binds loopback or Tailscale, so X-Forwarded-Proto can only come from `tailscale serve`.
function isHttps(req: IncomingMessage): boolean {
  return req.headers['x-forwarded-proto'] === 'https';
}

function readCookie(req: IncomingMessage, name: string): string {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
