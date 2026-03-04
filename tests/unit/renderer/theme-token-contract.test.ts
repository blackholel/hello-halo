import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const globalsCssPath = path.resolve(__dirname, '../../../src/renderer/assets/styles/globals.css')

describe('theme token contract (monochrome light/dark)', () => {
  it('defines light and dark grayscale tokens', () => {
    const css = fs.readFileSync(globalsCssPath, 'utf-8')

    expect(css).toContain('--primary: 0 0% 8%')
    expect(css).toContain('--background: 0 0% 96%')
    expect(css).toContain('.dark {')
    expect(css).toContain('--background: 0 0% 9%')
  })
})
