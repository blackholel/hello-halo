import { describe, expect, it, vi } from 'vitest'
import {
  collectTrackedPathsFromToolUse,
  extractTrackedPathsFromBashCommand,
  trackChangeFileFromToolUse
} from '../../../src/main/services/agent/change-tracking'

describe('change-tracking', () => {
  it('tracks direct file_path for mutation-capable tool calls', () => {
    const trackChangeFileFn = vi.fn()

    trackChangeFileFromToolUse(
      'space-1',
      'conv-1',
      'MultiEdit',
      { file_path: 'src/feature.ts' },
      trackChangeFileFn
    )

    expect(trackChangeFileFn).toHaveBeenCalledTimes(1)
    expect(trackChangeFileFn).toHaveBeenCalledWith('space-1', 'conv-1', 'src/feature.ts')
  })

  it('does not track read-only file tools by file_path', () => {
    const paths = collectTrackedPathsFromToolUse('Read', { file_path: 'README.md' })
    expect(paths).toEqual([])
  })

  it('extracts file paths from common Bash mutation patterns', () => {
    const paths = collectTrackedPathsFromToolUse('Bash', {
      command: [
        'echo "hello" > out.txt',
        'cat out.txt | tee -a logs/run.log',
        "sed -i 's/hello/world/' src/main.ts",
        'touch notes.md',
        'mv old.txt new.txt',
        'cp src/main.ts backup/main.ts',
        'rm gone.txt'
      ].join(' && ')
    })

    expect(paths).toEqual(expect.arrayContaining([
      'out.txt',
      'logs/run.log',
      'src/main.ts',
      'notes.md',
      'new.txt',
      'old.txt',
      'backup/main.ts',
      'gone.txt'
    ]))
  })

  it('tracks sed in-place targets when script is provided via -e', () => {
    const paths = collectTrackedPathsFromToolUse('Bash', {
      command: "sed -i -e 's/hello/world/' src/main.ts"
    })

    expect(paths).toContain('src/main.ts')
  })

  it('expands cp and mv destinations when target is a directory path', () => {
    const paths = collectTrackedPathsFromToolUse('Bash', {
      command: [
        'cp src/main.ts backup/',
        'mv src/old.ts archive/',
        'cp src/a.ts src/b.ts dist/'
      ].join(' && ')
    })

    expect(paths).toEqual(expect.arrayContaining([
      'backup/main.ts',
      'archive/old.ts',
      'src/old.ts',
      'dist/a.ts',
      'dist/b.ts'
    ]))
  })

  it('deduplicates paths and enforces max tracked files per Bash command', () => {
    const repeated = extractTrackedPathsFromBashCommand('echo a > dup.txt && echo b > dup.txt')
    expect(repeated).toEqual(['dup.txt'])

    const manyTargets = Array.from({ length: 30 }, (_item, index) => `echo ${index} > file-${index}.txt`).join(' ; ')
    const limited = extractTrackedPathsFromBashCommand(manyTargets, 5)
    expect(limited).toHaveLength(5)
  })

  it('skips unsafe or non-file shell targets', () => {
    const paths = collectTrackedPathsFromToolUse('Bash', {
      command: 'echo "x" > /dev/null && cat data | tee >(cat) && rm -rf -- *'
    })

    expect(paths).toEqual([])
  })
})
