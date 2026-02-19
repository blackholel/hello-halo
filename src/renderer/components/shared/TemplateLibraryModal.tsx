import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { api } from '../../api'
import type { SkillDefinition } from '../../stores/skills.store'
import type { AgentDefinition } from '../../stores/agents.store'
import type { CommandDefinition } from '../../stores/commands.store'

export type TemplateLibraryTab = 'skills' | 'agents' | 'commands'

interface TemplateLibraryModalProps {
  open: boolean
  workDir?: string
  initialTab?: TemplateLibraryTab
  onClose: () => void
  onImported?: () => void
}

interface PresetSummary {
  id: string
  name: string
  description?: string
}

function resourceKey(item: { name: string; namespace?: string }): string {
  return item.namespace ? `${item.namespace}:${item.name}` : item.name
}

export function TemplateLibraryModal({
  open,
  workDir,
  initialTab = 'skills',
  onClose,
  onImported
}: TemplateLibraryModalProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<TemplateLibraryTab>(initialTab)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [commands, setCommands] = useState<CommandDefinition[]>([])
  const [presets, setPresets] = useState<PresetSummary[]>([])

  useEffect(() => {
    if (!open) return
    setTab(initialTab)
  }, [initialTab, open])

  useEffect(() => {
    if (!open || !workDir) return

    const load = async (): Promise<void> => {
      setLoading(true)
      const [skillsRes, agentsRes, commandsRes, presetsRes] = await Promise.all([
        api.listSkills(workDir),
        api.listAgents(workDir),
        api.listCommands(workDir),
        api.listPresets()
      ])

      if (skillsRes.success && skillsRes.data) setSkills(skillsRes.data as SkillDefinition[])
      if (agentsRes.success && agentsRes.data) setAgents(agentsRes.data as AgentDefinition[])
      if (commandsRes.success && commandsRes.data) setCommands(commandsRes.data as CommandDefinition[])
      if (presetsRes.success && presetsRes.data) {
        setPresets((presetsRes.data as PresetSummary[]).slice(0, 3))
      }
      setLoading(false)
    }

    void load()
  }, [open, workDir])

  const spaceSkills = useMemo(() => skills.filter(skill => skill.source === 'space'), [skills])
  const templateSkills = useMemo(() => skills.filter(skill => skill.source !== 'space'), [skills])
  const spaceAgents = useMemo(() => agents.filter(agent => agent.source === 'space'), [agents])
  const templateAgents = useMemo(() => agents.filter(agent => agent.source !== 'space'), [agents])
  const spaceCommands = useMemo(() => commands.filter(command => command.source === 'space'), [commands])
  const templateCommands = useMemo(() => commands.filter(command => command.source !== 'space'), [commands])

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return templateSkills
    return templateSkills.filter(item => (
      resourceKey(item).toLowerCase().includes(q) ||
      item.description?.toLowerCase().includes(q)
    ))
  }, [query, templateSkills])

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return templateAgents
    return templateAgents.filter(item => (
      resourceKey(item).toLowerCase().includes(q) ||
      item.description?.toLowerCase().includes(q)
    ))
  }, [query, templateAgents])

  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return templateCommands
    return templateCommands.filter(item => (
      resourceKey(item).toLowerCase().includes(q) ||
      item.description?.toLowerCase().includes(q)
    ))
  }, [query, templateCommands])

  const isAdded = (type: TemplateLibraryTab, item: { name: string; namespace?: string }): boolean => {
    if (type === 'skills') return spaceSkills.some(spaceItem => resourceKey(spaceItem) === resourceKey(item))
    if (type === 'agents') return spaceAgents.some(spaceItem => resourceKey(spaceItem) === resourceKey(item))
    return spaceCommands.some(spaceItem => resourceKey(spaceItem) === resourceKey(item))
  }

  const handleImport = async (type: TemplateLibraryTab, item: { name: string; namespace?: string; source?: string; path?: string }): Promise<void> => {
    if (!workDir) return

    const ref = {
      type: type === 'skills' ? 'skill' : (type === 'agents' ? 'agent' : 'command'),
      name: item.name,
      namespace: item.namespace,
      source: item.source,
      path: item.path
    }

    const invoke = async (overwrite?: boolean) => {
      if (type === 'skills') return api.copySkillToSpaceByRef(ref, workDir, { overwrite })
      if (type === 'agents') return api.copyAgentToSpaceByRef(ref, workDir, { overwrite })
      return api.copyCommandToSpaceByRef(ref, workDir, { overwrite })
    }

    const first = await invoke(false)
    if (!first.success || !first.data) return

    const result = first.data as { status: 'copied' | 'conflict' | 'not_found' }
    if (result.status === 'conflict') {
      const shouldOverwrite = window.confirm(t('Already added. Overwrite existing resource?'))
      if (!shouldOverwrite) return
      await invoke(true)
    }

    onImported?.()
    const [skillsRes, agentsRes, commandsRes] = await Promise.all([
      api.listSkills(workDir),
      api.listAgents(workDir),
      api.listCommands(workDir)
    ])
    if (skillsRes.success && skillsRes.data) setSkills(skillsRes.data as SkillDefinition[])
    if (agentsRes.success && agentsRes.data) setAgents(agentsRes.data as AgentDefinition[])
    if (commandsRes.success && commandsRes.data) setCommands(commandsRes.data as CommandDefinition[])
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl border border-border bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <div className="text-sm font-semibold">{t('Template Library')}</div>
          <button className="p-1 rounded hover:bg-secondary/70" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center gap-2">
            <button className={`px-2.5 py-1 text-xs rounded ${tab === 'skills' ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`} onClick={() => setTab('skills')}>{t('Skills')}</button>
            <button className={`px-2.5 py-1 text-xs rounded ${tab === 'agents' ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`} onClick={() => setTab('agents')}>{t('Agents')}</button>
            <button className={`px-2.5 py-1 text-xs rounded ${tab === 'commands' ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`} onClick={() => setTab('commands')}>{t('Commands')}</button>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Search templates...')}
              className="ml-auto w-56 px-2.5 py-1.5 text-xs rounded border border-border/50 bg-secondary/30"
            />
          </div>

          <div className="max-h-[420px] overflow-auto border border-border/40 rounded-lg">
            {loading ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">{t('Loading...')}</div>
            ) : (
              <div className="divide-y divide-border/40">
                {tab === 'skills' && filteredSkills.map((skill) => (
                  <div key={skill.path} className="px-3 py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">/{resourceKey(skill)}</div>
                      {skill.description && <div className="text-[11px] text-muted-foreground truncate">{skill.description}</div>}
                    </div>
                    <button
                      className="px-2 py-1 text-xs rounded border border-border/50 hover:bg-secondary disabled:opacity-50"
                      disabled={isAdded('skills', skill)}
                      onClick={() => void handleImport('skills', skill)}
                    >
                      {isAdded('skills', skill) ? t('Already added') : t('Add to space')}
                    </button>
                  </div>
                ))}

                {tab === 'agents' && filteredAgents.map((agent) => (
                  <div key={agent.path} className="px-3 py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">@{resourceKey(agent)}</div>
                      {agent.description && <div className="text-[11px] text-muted-foreground truncate">{agent.description}</div>}
                    </div>
                    <button
                      className="px-2 py-1 text-xs rounded border border-border/50 hover:bg-secondary disabled:opacity-50"
                      disabled={isAdded('agents', agent)}
                      onClick={() => void handleImport('agents', agent)}
                    >
                      {isAdded('agents', agent) ? t('Already added') : t('Add to space')}
                    </button>
                  </div>
                ))}

                {tab === 'commands' && filteredCommands.map((command) => (
                  <div key={command.path} className="px-3 py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">/{resourceKey(command)}</div>
                      {command.description && <div className="text-[11px] text-muted-foreground truncate">{command.description}</div>}
                    </div>
                    <button
                      className="px-2 py-1 text-xs rounded border border-border/50 hover:bg-secondary disabled:opacity-50"
                      disabled={isAdded('commands', command)}
                      onClick={() => void handleImport('commands', command)}
                    >
                      {isAdded('commands', command) ? t('Already added') : t('Add to space')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {presets.length > 0 && (
            <div className="pt-1">
              <div className="text-[11px] text-muted-foreground mb-1">{t('Presets')}</div>
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => (
                  <div key={preset.id} className="px-2 py-1 text-[11px] rounded bg-secondary/40 border border-border/40">
                    {preset.name}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
