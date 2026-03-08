/**
 * Update Notification Component
 * Notify-only strategy:
 * - Show when a new version is available
 * - Provide download link only (no auto install)
 * - Same version is reminded only once after user dismisses it
 */

import { useEffect, useRef, useState } from 'react'
import { Download, ExternalLink, X } from 'lucide-react'
import { api } from '../../api'
import { useTranslation } from '../../i18n'

interface UpdaterStatusPayload {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'manual-download' | 'error'
  version?: string | null
  releaseNotes?: string | { version: string; note: string }[]
  downloadUrl?: string | null
  downloadSource?: 'github' | 'baidu' | null
  baiduExtractCode?: string | null
  lastDismissedVersion?: string | null
}

function parseReleaseNotes(notes: string | { version: string; note: string }[] | undefined): string[] {
  if (!notes) return []

  if (typeof notes === 'string') {
    return notes
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => line.replace(/^[-*]\s*/, ''))
  }

  if (Array.isArray(notes)) {
    return notes.map(item => item.note)
  }

  return []
}

export function UpdateNotification() {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(false)
  const [notificationVersion, setNotificationVersion] = useState<string | null>(null)
  const [releaseNotes, setReleaseNotes] = useState<string[]>([])
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [downloadSource, setDownloadSource] = useState<'github' | 'baidu' | null>(null)
  const [baiduExtractCode, setBaiduExtractCode] = useState<string | null>(null)
  const dismissedVersionRef = useRef<string | null>(null)

  const handleAvailableStatus = (data: UpdaterStatusPayload) => {
    if (data.status !== 'available' || !data.version) return

    if (dismissedVersionRef.current && dismissedVersionRef.current === data.version) {
      return
    }

    setNotificationVersion(data.version)
    setReleaseNotes(parseReleaseNotes(data.releaseNotes))
    setDownloadUrl(data.downloadUrl || null)
    setDownloadSource(data.downloadSource || null)
    setBaiduExtractCode(data.baiduExtractCode || null)
    setDismissed(false)
  }

  useEffect(() => {
    void (async () => {
      const stateRes = await api.getUpdaterState()
      if (stateRes.success && stateRes.data) {
        const state = stateRes.data as UpdaterStatusPayload
        dismissedVersionRef.current = state.lastDismissedVersion || null
        handleAvailableStatus(state)
      }
    })()

    const unsubscribe = api.onUpdaterStatus((data) => {
      const payload = data as UpdaterStatusPayload
      if (payload.lastDismissedVersion) {
        dismissedVersionRef.current = payload.lastDismissedVersion
      }
      handleAvailableStatus(payload)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const handleDownload = async () => {
    if (!notificationVersion) return
    const targetUrl = downloadUrl || `https://github.com/blackholel/buddykite/releases/tag/v${notificationVersion}`
    await api.openExternal(targetUrl)
  }

  const handleDismiss = async () => {
    if (notificationVersion) {
      dismissedVersionRef.current = notificationVersion
      await api.dismissUpdateVersion(notificationVersion)
    }
    setDismissed(true)
  }

  if (!notificationVersion || dismissed) {
    return null
  }

  const hasNotes = releaseNotes.length > 0

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-fade-in">
      <div className={`glass-dialog !p-4 ${hasNotes ? 'max-w-md' : 'max-w-sm'}`}>
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 bg-kite-success/15 rounded-2xl flex items-center justify-center">
            <Download className="w-5 h-5 text-kite-success" />
          </div>

          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold tracking-tight text-foreground">
              {t('New version Kite {{version}} available', { version: notificationVersion })}
            </h4>

            {hasNotes ? (
              <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto text-xs text-muted-foreground">
                {releaseNotes.map((note, index) => (
                  <li key={index} className="flex items-start gap-1.5">
                    <span className="text-kite-success mt-0.5">•</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">{t('Click to download')}</p>
            )}

            {downloadSource === 'baidu' && baiduExtractCode && (
              <p className="text-xs text-muted-foreground mt-2">
                {t('Extract code')}: <span className="font-mono">{baiduExtractCode}</span>
              </p>
            )}

            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => void handleDownload()}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-kite-success hover:brightness-110 text-white text-xs font-medium rounded-xl transition-all duration-200"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {t('Go to download')}
              </button>
              <button
                onClick={() => void handleDismiss()}
                className="px-3 py-1.5 btn-ghost text-xs"
              >
                {t('Later')}
              </button>
            </div>
          </div>

          <button
            onClick={() => void handleDismiss()}
            className="flex-shrink-0 p-1 rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-secondary/50 transition-all duration-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
