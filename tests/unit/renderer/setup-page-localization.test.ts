import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const appFile = path.resolve(__dirname, '../../../src/renderer/App.tsx')
const setupFile = path.resolve(__dirname, '../../../src/renderer/components/setup/ApiSetup.tsx')
const zhCNLocaleFile = path.resolve(__dirname, '../../../src/renderer/i18n/locales/zh-CN.json')

const REQUIRED_SETUP_ZH_KEYS = [
  'Before you start, create your default AI profile',
  'Choose Provider',
  'Profile Name',
  'Vendor',
  'Protocol',
  'API Key',
  'API URL',
  'Default Model',
  'Model Catalog (comma separated)',
  'Doc URL',
  'Create default profile and enter',
  'Default Profile',
  'Anthropic Official',
  'Anthropic Compatible',
  'URL must end with /chat/completions or /responses'
]

describe('setup page localization and updater visibility', () => {
  it('does not render update notification in App shell', () => {
    const appSource = fs.readFileSync(appFile, 'utf-8')

    expect(appSource).not.toContain('import { UpdateNotification }')
    expect(appSource).not.toContain('<UpdateNotification />')
  })

  it('uses i18n labels for setup form API fields and default profile name', () => {
    const setupSource = fs.readFileSync(setupFile, 'utf-8')

    expect(setupSource).toContain("t('API Key')")
    expect(setupSource).toContain("t('API URL')")
    expect(setupSource).toContain("t('Default Profile')")
  })

  it('provides required zh-CN translations for setup page', () => {
    const zhCN = JSON.parse(fs.readFileSync(zhCNLocaleFile, 'utf-8')) as Record<string, string>

    for (const key of REQUIRED_SETUP_ZH_KEYS) {
      expect(zhCN[key], `Missing zh-CN translation for key: ${key}`).toBeTypeOf('string')
      expect(zhCN[key].length, `Empty zh-CN translation for key: ${key}`).toBeGreaterThan(0)
    }
  })
})
