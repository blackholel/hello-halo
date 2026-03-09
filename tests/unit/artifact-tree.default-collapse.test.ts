import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'

describe('ArtifactTree default expand state', () => {
  it('uses collapsed folders by default', () => {
    const source = readFileSync(
      new URL('../../src/renderer/components/artifact/ArtifactTree.tsx', import.meta.url),
      'utf-8'
    )

    expect(source).toContain('openByDefault={false}')
  })
})
