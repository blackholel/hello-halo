import type { ClaudeCodeResourceRuntimePolicy } from '../../shared/types/claude-code'

const DEFAULT_RUNTIME_POLICY: ClaudeCodeResourceRuntimePolicy = 'app-single-source'
const warnedContexts = new Set<string>()

function warnFullMeshIgnored(context: string): void {
  const key = context.trim() || 'default'
  if (warnedContexts.has(key)) return
  warnedContexts.add(key)
  console.warn(
    `[ResourceRuntimePolicy] "full-mesh" is deprecated and ignored at runtime. Using "${DEFAULT_RUNTIME_POLICY}" instead. context=${key}`
  )
}

export function normalizeResourceRuntimePolicy(
  policy: ClaudeCodeResourceRuntimePolicy | undefined,
  context: string
): ClaudeCodeResourceRuntimePolicy {
  if (policy === 'full-mesh') {
    warnFullMeshIgnored(context)
    return DEFAULT_RUNTIME_POLICY
  }
  return policy || DEFAULT_RUNTIME_POLICY
}

export function resolveResourceRuntimePolicy(
  options: {
    explicit?: ClaudeCodeResourceRuntimePolicy
    spacePolicy?: ClaudeCodeResourceRuntimePolicy
    globalPolicy?: ClaudeCodeResourceRuntimePolicy
  },
  context: string
): ClaudeCodeResourceRuntimePolicy {
  return normalizeResourceRuntimePolicy(
    options.explicit || options.spacePolicy || options.globalPolicy || DEFAULT_RUNTIME_POLICY,
    context
  )
}

export function _testResetResourceRuntimePolicyWarnings(): void {
  warnedContexts.clear()
}
