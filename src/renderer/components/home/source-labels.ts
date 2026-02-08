export type AnySource = 'app' | 'global' | 'space' | 'installed' | 'plugin'

const DISPLAY_LABEL: Record<AnySource, string> = {
  app: 'App',
  global: 'Global',
  space: 'Space',
  installed: 'Plugin',
  plugin: 'Plugin'
}

const DISPLAY_COLOR: Record<AnySource, string> = {
  app: 'bg-blue-500/10 text-blue-500',
  global: 'bg-purple-500/10 text-purple-500',
  space: 'bg-green-500/10 text-green-500',
  installed: 'bg-orange-500/10 text-orange-500',
  plugin: 'bg-orange-500/10 text-orange-500'
}

export function getSourceLabel(source: AnySource, t: (key: string) => string): string {
  return t(DISPLAY_LABEL[source])
}

export function getSourceColor(source: AnySource): string {
  return DISPLAY_COLOR[source]
}
