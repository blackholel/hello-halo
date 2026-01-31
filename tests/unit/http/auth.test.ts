/**
 * Authentication Validators Tests
 * TDD: RED phase - tests written before implementation
 */

import { describe, it, expect } from 'vitest'
import { loginTokenSchema, validateLoginToken } from '../../../src/main/http/validators'

describe('Login Token Validation', () => {
  describe('loginTokenSchema', () => {
    it('should accept valid 6-digit numeric token', () => {
      const result = loginTokenSchema.safeParse({ token: '123456' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.token).toBe('123456')
      }
    })

    it('should accept token with leading zeros', () => {
      const result = loginTokenSchema.safeParse({ token: '012345' })
      expect(result.success).toBe(true)
    })

    it('should reject non-string token', () => {
      const result = loginTokenSchema.safeParse({ token: 123456 })
      expect(result.success).toBe(false)
    })

    it('should reject token with wrong length (too short)', () => {
      const result = loginTokenSchema.safeParse({ token: '12345' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('6')
      }
    })

    it('should reject token with wrong length (too long)', () => {
      const result = loginTokenSchema.safeParse({ token: '1234567' })
      expect(result.success).toBe(false)
    })

    it('should reject token with non-numeric characters', () => {
      const result = loginTokenSchema.safeParse({ token: '12345a' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('digit')
      }
    })

    it('should reject token with special characters', () => {
      const result = loginTokenSchema.safeParse({ token: '123-56' })
      expect(result.success).toBe(false)
    })

    it('should reject token with spaces', () => {
      const result = loginTokenSchema.safeParse({ token: '123 56' })
      expect(result.success).toBe(false)
    })

    it('should reject empty body', () => {
      const result = loginTokenSchema.safeParse({})
      expect(result.success).toBe(false)
    })

    it('should reject null token', () => {
      const result = loginTokenSchema.safeParse({ token: null })
      expect(result.success).toBe(false)
    })

    it('should reject undefined token', () => {
      const result = loginTokenSchema.safeParse({ token: undefined })
      expect(result.success).toBe(false)
    })
  })

  describe('validateLoginToken', () => {
    it('should return validated token for valid input', () => {
      const result = validateLoginToken({ token: '654321' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.token).toBe('654321')
      }
    })

    it('should return error for invalid input', () => {
      const result = validateLoginToken({ token: 'invalid' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeDefined()
      }
    })

    it('should return error message for missing token', () => {
      const result = validateLoginToken({})
      expect(result.success).toBe(false)
    })
  })
})
