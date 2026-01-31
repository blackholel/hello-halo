/**
 * CORS Configuration - Secure cross-origin resource sharing
 *
 * Restricts CORS to trusted origins only, preventing unauthorized
 * cross-origin requests from malicious websites.
 */

import { Request, Response, NextFunction } from 'express'
import { getConfig } from '../services/config.service'

// Default allowed origins (localhost for development)
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]

/**
 * Get all allowed origins from config and defaults
 */
export function getAllowedOrigins(): string[] {
  const config = getConfig()
  const trustedOrigins = config.remoteAccess?.trustedOrigins || []
  return [...DEFAULT_ORIGINS, ...trustedOrigins]
}

/**
 * Check if an origin is allowed
 * @param origin - The origin header value (null/undefined for same-origin)
 */
export function isOriginAllowed(origin: string | null | undefined): boolean {
  // Same-origin requests (no origin header) are always allowed
  if (!origin || origin === '') {
    return true
  }

  const allowedOrigins = getAllowedOrigins()
  return allowedOrigins.includes(origin)
}

/**
 * Express CORS middleware
 * Only sets CORS headers for trusted origins
 */
export function corsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const origin = req.headers.origin

  // Only set CORS headers if origin is trusted
  if (isOriginAllowed(origin)) {
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin)
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.sendStatus(200)
    return
  }

  next()
}
