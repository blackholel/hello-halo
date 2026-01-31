/**
 * CORS Configuration Tests
 * TDD: RED phase - tests written before implementation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock config service before importing cors module
vi.mock('../../../src/main/services/config.service', () => ({
  getConfig: vi.fn()
}))

import { getAllowedOrigins, isOriginAllowed, corsMiddleware } from '../../../src/main/http/cors'
import { getConfig } from '../../../src/main/services/config.service'

const mockGetConfig = vi.mocked(getConfig)

describe('CORS Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getAllowedOrigins', () => {
    it('should return localhost origins by default', () => {
      mockGetConfig.mockReturnValue({
        remoteAccess: { enabled: true, port: 3847 }
      } as ReturnType<typeof getConfig>)

      const origins = getAllowedOrigins()

      expect(origins).toContain('http://localhost:5173')
      expect(origins).toContain('http://127.0.0.1:5173')
    })

    it('should include configured trusted origins from config', () => {
      mockGetConfig.mockReturnValue({
        remoteAccess: {
          enabled: true,
          port: 3847,
          trustedOrigins: ['https://myapp.example.com', 'https://internal.corp.net']
        }
      } as ReturnType<typeof getConfig>)

      const origins = getAllowedOrigins()

      expect(origins).toContain('https://myapp.example.com')
      expect(origins).toContain('https://internal.corp.net')
      // Should still include localhost
      expect(origins).toContain('http://localhost:5173')
    })

    it('should handle empty trustedOrigins array', () => {
      mockGetConfig.mockReturnValue({
        remoteAccess: {
          enabled: true,
          port: 3847,
          trustedOrigins: []
        }
      } as ReturnType<typeof getConfig>)

      const origins = getAllowedOrigins()

      // Should still have default localhost origins
      expect(origins.length).toBeGreaterThan(0)
      expect(origins).toContain('http://localhost:5173')
    })

    it('should handle undefined trustedOrigins', () => {
      mockGetConfig.mockReturnValue({
        remoteAccess: { enabled: true, port: 3847 }
      } as ReturnType<typeof getConfig>)

      const origins = getAllowedOrigins()

      expect(origins).toContain('http://localhost:5173')
      expect(origins).toContain('http://127.0.0.1:5173')
    })
  })

  describe('isOriginAllowed', () => {
    beforeEach(() => {
      mockGetConfig.mockReturnValue({
        remoteAccess: {
          enabled: true,
          port: 3847,
          trustedOrigins: ['https://trusted.example.com']
        }
      } as ReturnType<typeof getConfig>)
    })

    it('should allow requests from trusted origins', () => {
      expect(isOriginAllowed('https://trusted.example.com')).toBe(true)
      expect(isOriginAllowed('http://localhost:5173')).toBe(true)
      expect(isOriginAllowed('http://127.0.0.1:5173')).toBe(true)
    })

    it('should reject requests from untrusted origins', () => {
      expect(isOriginAllowed('https://evil.com')).toBe(false)
      expect(isOriginAllowed('https://attacker.example.com')).toBe(false)
    })

    it('should allow null origin (same-origin requests)', () => {
      expect(isOriginAllowed(null)).toBe(true)
      expect(isOriginAllowed(undefined)).toBe(true)
    })

    it('should allow empty string origin', () => {
      // Empty string is treated as same-origin
      expect(isOriginAllowed('')).toBe(true)
    })
  })

  describe('corsMiddleware', () => {
    let mockReq: { headers: { origin?: string }; method: string }
    let mockRes: {
      header: ReturnType<typeof vi.fn>
      sendStatus: ReturnType<typeof vi.fn>
    }
    let mockNext: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockGetConfig.mockReturnValue({
        remoteAccess: {
          enabled: true,
          port: 3847,
          trustedOrigins: ['https://trusted.example.com']
        }
      } as ReturnType<typeof getConfig>)

      mockReq = { headers: {}, method: 'GET' }
      mockRes = {
        header: vi.fn().mockReturnThis(),
        sendStatus: vi.fn()
      }
      mockNext = vi.fn()
    })

    it('should set CORS headers for trusted origin', () => {
      mockReq.headers.origin = 'https://trusted.example.com'

      corsMiddleware(mockReq as any, mockRes as any, mockNext)

      expect(mockRes.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://trusted.example.com'
      )
      expect(mockRes.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, DELETE, OPTIONS'
      )
      expect(mockRes.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization'
      )
      expect(mockNext).toHaveBeenCalled()
    })

    it('should NOT set Access-Control-Allow-Origin for untrusted origin', () => {
      mockReq.headers.origin = 'https://evil.com'

      corsMiddleware(mockReq as any, mockRes as any, mockNext)

      // Should not set Allow-Origin header for untrusted origins
      const allowOriginCalls = mockRes.header.mock.calls.filter(
        (call) => call[0] === 'Access-Control-Allow-Origin'
      )
      expect(allowOriginCalls.length).toBe(0)
      expect(mockNext).toHaveBeenCalled()
    })

    it('should handle OPTIONS preflight requests for trusted origin', () => {
      mockReq.method = 'OPTIONS'
      mockReq.headers.origin = 'http://localhost:5173'

      corsMiddleware(mockReq as any, mockRes as any, mockNext)

      expect(mockRes.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'http://localhost:5173'
      )
      expect(mockRes.sendStatus).toHaveBeenCalledWith(200)
      expect(mockNext).not.toHaveBeenCalled()
    })

    it('should reject OPTIONS preflight from untrusted origin', () => {
      mockReq.method = 'OPTIONS'
      mockReq.headers.origin = 'https://evil.com'

      corsMiddleware(mockReq as any, mockRes as any, mockNext)

      // Should not set Allow-Origin for untrusted origin
      const allowOriginCalls = mockRes.header.mock.calls.filter(
        (call) => call[0] === 'Access-Control-Allow-Origin'
      )
      expect(allowOriginCalls.length).toBe(0)
      // Still respond to OPTIONS but without CORS headers
      expect(mockRes.sendStatus).toHaveBeenCalledWith(200)
    })

    it('should handle same-origin requests (no origin header)', () => {
      // No origin header means same-origin request
      mockReq.headers.origin = undefined

      corsMiddleware(mockReq as any, mockRes as any, mockNext)

      // Should allow same-origin requests
      expect(mockNext).toHaveBeenCalled()
    })
  })
})
