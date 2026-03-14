import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const globalsCssPath = path.resolve(__dirname, '../../../src/renderer/assets/styles/globals.css')

describe('theme token contract (minimal neutral + blue accent)', () => {
  it('defines light and dark tokens for minimal blue-accent palette', () => {
    const css = fs.readFileSync(globalsCssPath, 'utf-8')

    expect(css).toContain('--primary: 213 80% 44%')
    expect(css).toContain('--background: 210 20% 98%')
    expect(css).toContain('.dark {')
    expect(css).toContain('--background: 223 24% 10%')
  })
})
