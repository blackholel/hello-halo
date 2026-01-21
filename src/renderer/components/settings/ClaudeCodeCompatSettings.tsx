/**
 * Claude Code Compatibility Settings - 管理 Claude Code 功能配置
 */

import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2 } from '../icons/ToolIcons'
import { useTranslation } from '../../i18n'
import { api } from '../../api'
import type { HaloConfig } from '../../types'

interface ClaudeCodeCompatSettingsProps {
  config: HaloConfig | null
  onConfigChange: (config: Partial<HaloConfig>) => void
}

export function ClaudeCodeCompatSettings({ config, onConfigChange }: ClaudeCodeCompatSettingsProps) {
  const { t } = useTranslation()
  const claudeCodeConfig = config?.claudeCode || {}

  // Compat settings
  const [enableUserSettings, setEnableUserSettings] = useState(claudeCodeConfig.compat?.enableUserSettings || false)
  const [enableProjectSettings, setEnableProjectSettings] = useState(claudeCodeConfig.compat?.enableProjectSettings || false)
  const [enableSystemSkills, setEnableSystemSkills] = useState(claudeCodeConfig.compat?.enableSystemSkills || false)

  // Plugins settings
  const [pluginsEnabled, setPluginsEnabled] = useState(claudeCodeConfig.plugins?.enabled ?? true)
  const [loadDefaultPaths, setLoadDefaultPaths] = useState(claudeCodeConfig.plugins?.loadDefaultPaths ?? true)
  const [globalPaths, setGlobalPaths] = useState<string[]>(claudeCodeConfig.plugins?.globalPaths || [])
  const [newPath, setNewPath] = useState('')

  // Memory settings
  const [memoryEnabled, setMemoryEnabled] = useState(claudeCodeConfig.memory?.enabled ?? true)
  const [autoLoadClaudeMd, setAutoLoadClaudeMd] = useState(claudeCodeConfig.memory?.autoLoadClaudeMd ?? true)

  // UI state
  const [expandedSection, setExpandedSection] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null)

  // Sync state when config changes
  useEffect(() => {
    if (config?.claudeCode) {
      setEnableUserSettings(config.claudeCode.compat?.enableUserSettings || false)
      setEnableProjectSettings(config.claudeCode.compat?.enableProjectSettings || false)
      setEnableSystemSkills(config.claudeCode.compat?.enableSystemSkills || false)
      setPluginsEnabled(config.claudeCode.plugins?.enabled ?? true)
      setLoadDefaultPaths(config.claudeCode.plugins?.loadDefaultPaths ?? true)
      setGlobalPaths(config.claudeCode.plugins?.globalPaths || [])
      setMemoryEnabled(config.claudeCode.memory?.enabled ?? true)
      setAutoLoadClaudeMd(config.claudeCode.memory?.autoLoadClaudeMd ?? true)
    }
  }, [config?.claudeCode])

  const handleSave = async () => {
    setIsSaving(true)
    setSaveResult(null)

    try {
      const newClaudeCodeConfig = {
        claudeCode: {
          ...claudeCodeConfig,
          compat: {
            enableUserSettings,
            enableProjectSettings,
            enableSystemSkills
          },
          plugins: {
            enabled: pluginsEnabled,
            loadDefaultPaths,
            globalPaths
          },
          memory: {
            ...claudeCodeConfig.memory,
            enabled: memoryEnabled,
            autoLoadClaudeMd
          }
        }
      }

      await api.setConfig(newClaudeCodeConfig)
      onConfigChange(newClaudeCodeConfig)
      setSaveResult({ success: true, message: t('Saved') })
      // Auto-clear success message after 3 seconds
      setTimeout(() => setSaveResult(null), 3000)
    } catch (error) {
      setSaveResult({ success: false, message: t('Save failed') })
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddPath = () => {
    const trimmed = newPath.trim()
    if (trimmed && !globalPaths.includes(trimmed)) {
      setGlobalPaths([...globalPaths, trimmed])
      setNewPath('')
    }
  }

  const handleRemovePath = (path: string) => {
    setGlobalPaths(globalPaths.filter(p => p !== path))
  }

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
          <svg className="w-5 h-5 text-purple-500" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-medium">{t('Claude Code Compatibility')}</h2>
          <p className="text-xs text-muted-foreground">{t('Configure Claude Code native features')}</p>
        </div>
      </div>

      {/* Compat Section */}
      <div className="border border-border rounded-lg">
        <button
          onClick={() => toggleSection('compat')}
          className="w-full flex items-center justify-between p-4 hover:bg-secondary/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            {expandedSection === 'compat' ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            <span className="font-medium">{t('Settings Sources')}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {enableUserSettings || enableProjectSettings ? t('Enabled') : t('Isolated Mode')}
          </span>
        </button>

        {expandedSection === 'compat' && (
          <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              {t('Control whether to load Claude Code native configuration files')}
            </p>

            {/* User Settings */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t('User Settings')}</p>
                <p className="text-xs text-muted-foreground">~/.claude/settings.json</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableUserSettings}
                  onChange={(e) => setEnableUserSettings(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-secondary rounded-full peer peer-checked:bg-primary transition-colors">
                  <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${enableUserSettings ? 'translate-x-4' : 'translate-x-0.5'} mt-0.5`} />
                </div>
              </label>
            </div>

            {/* Project Settings */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t('Project Settings')}</p>
                <p className="text-xs text-muted-foreground">{'{workDir}'}/.claude/settings.json</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableProjectSettings}
                  onChange={(e) => setEnableProjectSettings(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-secondary rounded-full peer peer-checked:bg-primary transition-colors">
                  <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${enableProjectSettings ? 'translate-x-4' : 'translate-x-0.5'} mt-0.5`} />
                </div>
              </label>
            </div>

            {/* System Skills */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t('System Skills')}</p>
                <p className="text-xs text-muted-foreground">~/.claude/skills/</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableSystemSkills}
                  onChange={(e) => setEnableSystemSkills(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-secondary rounded-full peer peer-checked:bg-primary transition-colors">
                  <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${enableSystemSkills ? 'translate-x-4' : 'translate-x-0.5'} mt-0.5`} />
                </div>
              </label>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-500/80">
              {t('Enabling these options will load Claude Code CLI configuration, which may affect Halo behavior')}
            </div>
          </div>
        )}
      </div>

      {/* Plugins Section */}
      <div className="border border-border rounded-lg">
        <button
          onClick={() => toggleSection('plugins')}
          className="w-full flex items-center justify-between p-4 hover:bg-secondary/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            {expandedSection === 'plugins' ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            <span className="font-medium">{t('Plugins')}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {pluginsEnabled ? t('Enabled') : t('Disabled')}
          </span>
        </button>

        {expandedSection === 'plugins' && (
          <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              {t('Plugins provide skills, commands, agents, and hooks')}
            </p>

            {/* Plugins Enabled */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t('Enable Plugins')}</p>
                <p className="text-xs text-muted-foreground">{t('Load plugins from configured paths')}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={pluginsEnabled}
                  onChange={(e) => setPluginsEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-secondary rounded-full peer peer-checked:bg-primary transition-colors">
                  <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${pluginsEnabled ? 'translate-x-4' : 'translate-x-0.5'} mt-0.5`} />
                </div>
              </label>
            </div>

            {/* Load Default Paths */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t('Load Default Paths')}</p>
                <p className="text-xs text-muted-foreground">~/.halo/plugins/</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={loadDefaultPaths}
                  onChange={(e) => setLoadDefaultPaths(e.target.checked)}
                  disabled={!pluginsEnabled}
                  className="sr-only peer"
                />
                <div className={`w-9 h-5 rounded-full peer transition-colors ${!pluginsEnabled ? 'bg-secondary/50' : 'bg-secondary peer-checked:bg-primary'}`}>
                  <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${loadDefaultPaths ? 'translate-x-4' : 'translate-x-0.5'} mt-0.5`} />
                </div>
              </label>
            </div>

            {/* Custom Global Paths */}
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('Additional Plugin Paths')}</p>

              {/* Path list */}
              {globalPaths.length > 0 && (
                <div className="space-y-1">
                  {globalPaths.map((path) => (
                    <div key={path} className="flex items-center gap-2 bg-secondary/50 rounded px-2 py-1">
                      <span className="text-xs flex-1 truncate">{path}</span>
                      <button
                        onClick={() => handleRemovePath(path)}
                        className="text-muted-foreground hover:text-red-500 transition-colors"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new path */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddPath()}
                  placeholder={t('Enter plugin path...')}
                  disabled={!pluginsEnabled}
                  className="flex-1 px-2 py-1 text-sm bg-secondary/50 border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
                <button
                  onClick={handleAddPath}
                  disabled={!pluginsEnabled || !newPath.trim()}
                  className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {t('Add')}
                </button>
              </div>
            </div>

            {/* Default paths info */}
            <div className="bg-secondary/50 rounded-lg p-3 space-y-2 text-xs">
              <p className="font-medium text-muted-foreground">{t('Default plugin paths')}:</p>
              <ul className="space-y-1 text-muted-foreground">
                <li>~/.halo/plugins/ ({t('App level')})</li>
                <li>{'{workDir}'}/.claude/ ({t('Space level')})</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Memory Section */}
      <div className="border border-border rounded-lg">
        <button
          onClick={() => toggleSection('memory')}
          className="w-full flex items-center justify-between p-4 hover:bg-secondary/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            {expandedSection === 'memory' ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            <span className="font-medium">{t('Memory')}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {memoryEnabled ? t('Enabled') : t('Disabled')}
          </span>
        </button>

        {expandedSection === 'memory' && (
          <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              {t('Memory files provide persistent context for AI conversations')}
            </p>

            {/* Memory Enabled */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t('Enable Memory')}</p>
                <p className="text-xs text-muted-foreground">{t('Inject memory content into system prompt')}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={memoryEnabled}
                  onChange={(e) => setMemoryEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-secondary rounded-full peer peer-checked:bg-primary transition-colors">
                  <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${memoryEnabled ? 'translate-x-4' : 'translate-x-0.5'} mt-0.5`} />
                </div>
              </label>
            </div>

            {/* Auto Load CLAUDE.md */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t('Auto Load CLAUDE.md')}</p>
                <p className="text-xs text-muted-foreground">{t('Automatically load CLAUDE.md files')}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoLoadClaudeMd}
                  onChange={(e) => setAutoLoadClaudeMd(e.target.checked)}
                  disabled={!memoryEnabled}
                  className="sr-only peer"
                />
                <div className={`w-9 h-5 rounded-full peer transition-colors ${!memoryEnabled ? 'bg-secondary/50' : 'bg-secondary peer-checked:bg-primary'}`}>
                  <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${autoLoadClaudeMd ? 'translate-x-4' : 'translate-x-0.5'} mt-0.5`} />
                </div>
              </label>
            </div>

            {/* Memory file locations */}
            <div className="bg-secondary/50 rounded-lg p-3 space-y-2 text-xs">
              <p className="font-medium text-muted-foreground">{t('Memory file locations')}:</p>
              <ul className="space-y-1 text-muted-foreground">
                <li>~/.claude/CLAUDE.md ({t('User level')})</li>
                <li>{'{workDir}'}/CLAUDE.md ({t('Project level')})</li>
                <li>~/.halo/memory.md ({t('Halo global')})</li>
                <li>{'{workDir}'}/.halo/memory.md ({t('Space level')})</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-4 pt-2">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {isSaving ? t('Saving...') : t('Save')}
        </button>

        {saveResult && (
          <span className={`text-sm flex items-center gap-1 ${saveResult.success ? 'text-green-500' : 'text-red-500'}`}>
            {saveResult.success ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                {saveResult.message}
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4" />
                {saveResult.message}
              </>
            )}
          </span>
        )}
      </div>

      {/* Note */}
      <p className="text-xs text-amber-500/80">
        {t('Configuration changes will take effect after starting a new conversation')}
      </p>
    </div>
  )
}
