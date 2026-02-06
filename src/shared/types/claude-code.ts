/**
 * Shared Claude Code configuration types
 *
 * These types are used by both main process and renderer process
 * to ensure consistency in configuration handling.
 */

// ============================================
// Hooks Configuration
// ============================================

/**
 * Hooks configuration (compatible with Claude Code ~/.claude/settings.json)
 */
export interface HooksConfig {
  PreToolUse?: HookDefinition[]
  PostToolUse?: HookDefinition[]
  PostToolUseFailure?: HookDefinition[]
  Stop?: HookDefinition[]
  Notification?: HookDefinition[]
  UserPromptSubmit?: HookDefinition[]
  SessionStart?: HookDefinition[]
  SessionEnd?: HookDefinition[]
  SubagentStart?: HookDefinition[]
  SubagentStop?: HookDefinition[]
  PreCompact?: HookDefinition[]
  PermissionRequest?: HookDefinition[]
  Setup?: HookDefinition[]
}

export interface HookDefinition {
  matcher?: string | string[]  // Tool name pattern(s) to match
  hooks: HookCommand[]
}

export interface HookCommand {
  type: 'command'
  command: string
  timeout?: number  // milliseconds
}

// ============================================
// Plugins Configuration
// ============================================

export interface PluginsConfig {
  enabled?: boolean           // Default: true
  globalPaths?: string[]      // Additional global plugin paths
  loadDefaultPaths?: boolean  // Load default paths (~/.halo/plugins/, ~/.halo/skills/) - Default: true
}

// ============================================
// Agents Configuration
// ============================================

export interface AgentsConfig {
  paths?: string[]  // Additional agent paths
}

// ============================================
// Claude Code Configuration
// ============================================

/**
 * Claude Code configuration (nested under config.claudeCode)
 */
export interface ClaudeCodeConfig {
  plugins?: PluginsConfig
  hooks?: HooksConfig
  agents?: AgentsConfig
  /** Global kill switch for Claude Code hooks (default: true) */
  hooksEnabled?: boolean
  /** Global kill switch for MCP servers (default: true) */
  mcpEnabled?: boolean
  /** Enable lazy skills loading (default: false) */
  skillsLazyLoad?: boolean
  enableSystemSkills?: boolean    // Load ~/.claude/skills/ - Default: false
  /**
   * @deprecated No longer needed. CLAUDE_CONFIG_DIR=~/.halo/ provides isolation.
   * Kept for backward compatibility but ignored.
   */
  enableUserSettings?: boolean
  /**
   * @deprecated No longer needed. CLAUDE_CONFIG_DIR=~/.halo/ provides isolation.
   * Kept for backward compatibility but ignored.
   */
  enableProjectSettings?: boolean
}
