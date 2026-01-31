/**
 * Logger Service Tests
 * TDD: RED phase - tests written before implementation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('Logger Service', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('createLogger', () => {
    it('should create logger with namespace', async () => {
      const { createLogger } = await import('../../../src/main/utils/logger')
      const logger = createLogger('TestModule')

      expect(logger).toBeDefined()
      expect(logger.debug).toBeInstanceOf(Function)
      expect(logger.info).toBeInstanceOf(Function)
      expect(logger.warn).toBeInstanceOf(Function)
      expect(logger.error).toBeInstanceOf(Function)
    })

    it('should include namespace in log output', async () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
      const { createLogger } = await import('../../../src/main/utils/logger')

      const logger = createLogger('MyService')
      logger.info('test message')

      expect(consoleSpy).toHaveBeenCalled()
      const callArgs = consoleSpy.mock.calls[0]
      expect(callArgs[0]).toContain('MyService')

      consoleSpy.mockRestore()
    })
  })

  describe('log levels', () => {
    it('should support debug level', async () => {
      process.env.LOG_LEVEL = 'debug'
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      const { createLogger } = await import('../../../src/main/utils/logger')

      const logger = createLogger('Test')
      logger.debug('debug message')

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should support info level', async () => {
      process.env.LOG_LEVEL = 'info'
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
      const { createLogger } = await import('../../../src/main/utils/logger')

      const logger = createLogger('Test')
      logger.info('info message')

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should support warn level', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { createLogger } = await import('../../../src/main/utils/logger')

      const logger = createLogger('Test')
      logger.warn('warn message')

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should support error level', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { createLogger } = await import('../../../src/main/utils/logger')

      const logger = createLogger('Test')
      logger.error('error message')

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('log level filtering', () => {
    it('should filter messages below configured level (error)', async () => {
      process.env.LOG_LEVEL = 'error'
      vi.resetModules()

      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { createLogger } = await import('../../../src/main/utils/logger')
      const logger = createLogger('Test')

      logger.debug('debug')
      logger.info('info')
      logger.warn('warn')
      logger.error('error')

      expect(debugSpy).not.toHaveBeenCalled()
      expect(infoSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalled()

      debugSpy.mockRestore()
      infoSpy.mockRestore()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    })

    it('should filter messages below configured level (warn)', async () => {
      process.env.LOG_LEVEL = 'warn'
      vi.resetModules()

      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const { createLogger } = await import('../../../src/main/utils/logger')
      const logger = createLogger('Test')

      logger.debug('debug')
      logger.info('info')
      logger.warn('warn')

      expect(debugSpy).not.toHaveBeenCalled()
      expect(infoSpy).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalled()

      debugSpy.mockRestore()
      infoSpy.mockRestore()
      warnSpy.mockRestore()
    })

    it('should allow all messages at debug level', async () => {
      process.env.LOG_LEVEL = 'debug'
      vi.resetModules()

      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { createLogger } = await import('../../../src/main/utils/logger')
      const logger = createLogger('Test')

      logger.debug('debug')
      logger.info('info')
      logger.warn('warn')
      logger.error('error')

      expect(debugSpy).toHaveBeenCalled()
      expect(infoSpy).toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalled()

      debugSpy.mockRestore()
      infoSpy.mockRestore()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    })
  })

  describe('metadata support', () => {
    it('should support logging with metadata object', async () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
      const { createLogger } = await import('../../../src/main/utils/logger')

      const logger = createLogger('Test')
      logger.info('message with meta', { userId: 123, action: 'test' })

      expect(consoleSpy).toHaveBeenCalled()
      const callArgs = consoleSpy.mock.calls[0]
      expect(callArgs).toContainEqual(expect.objectContaining({ userId: 123 }))

      consoleSpy.mockRestore()
    })

    it('should handle undefined metadata', async () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
      const { createLogger } = await import('../../../src/main/utils/logger')

      const logger = createLogger('Test')
      expect(() => logger.info('message')).not.toThrow()

      consoleSpy.mockRestore()
    })
  })

  describe('LOG_LEVEL environment variable', () => {
    it('should respect LOG_LEVEL environment variable', async () => {
      process.env.LOG_LEVEL = 'error'
      vi.resetModules()

      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
      const { createLogger } = await import('../../../src/main/utils/logger')

      const logger = createLogger('Test')
      logger.info('should not appear')

      expect(infoSpy).not.toHaveBeenCalled()
      infoSpy.mockRestore()
    })

    it('should default to info level when LOG_LEVEL is not set', async () => {
      delete process.env.LOG_LEVEL
      vi.resetModules()

      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      const { createLogger } = await import('../../../src/main/utils/logger')
      const logger = createLogger('Test')

      logger.debug('debug message')
      logger.info('info message')

      // Debug should be filtered at info level
      expect(debugSpy).not.toHaveBeenCalled()
      expect(infoSpy).toHaveBeenCalled()

      debugSpy.mockRestore()
      infoSpy.mockRestore()
    })
  })
})
