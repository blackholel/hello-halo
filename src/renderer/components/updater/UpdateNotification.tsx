/**
 * Update Notification Component
 * Shows a toast-like notification for available updates
 *
 * Behavior:
 * - 'downloaded': Update ready to install (Windows: auto-install, macOS: manual download)
 * - 'manual-download': Need manual download (macOS platform or auto-download failed)
 *
 * The component shows the same UI for both states, with button text depending on the action.
 */

import { useEffect, useState } from 'react'
import { Download, X, RefreshCw, ExternalLink } from 'lucide-react'
import { api } from '../../api'
import { useTranslation } from '../../i18n'

const isMac = navigator.platform.includes('Mac')

interface UpdateInfo {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'manual-download' | 'error'
  version?: string
  percent?: number
  message?: string
  releaseNotes?: string | { version: string; note: string }[]
}

// Parse release notes to array of strings
function parseReleaseNotes(notes: string | { version: string; note: string }[] | undefined): string[] {
  if (!notes) return []

  if (typeof notes === 'string') {
    // Split by newlines and filter out empty lines
    return notes
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => line.replace(/^[-*]\s*/, '')) // Remove leading - or *
  }

  // Array format from electron-updater
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
  const [isManualDownload, setIsManualDownload] = useState(false)

  useEffect(() => {
    // Listen for updater status events
    const unsubscribe = api.onUpdaterStatus((data) => {
      console.log('[UpdateNotification] Received update status:', data)

      // Show notification for both 'downloaded' and 'manual-download' states
      if ((data.status === 'downloaded' || data.status === 'manual-download') && data.version) {
        setNotificationVersion(data.version)
        setReleaseNotes(parseReleaseNotes(data.releaseNotes))
        setIsManualDownload(data.status === 'manual-download')
        setDismissed(false)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const handleInstall = () => {
    if (isManualDownload || isMac) {
      // Open GitHub release page for manual download (macOS always, or when manual-download status)
      if (notificationVersion) {
        window.open(
          `https://github.com/openkursar/hello-halo/releases/tag/v${notificationVersion}`,
          '_blank'
        )
      }
    } else {
      // Windows auto-install
      api.installUpdate()
    }
  }

  const handleDismiss = () => {
    setDismissed(true)
  }

  // Show notification when we have a version to notify and not dismissed
  if (!notificationVersion || dismissed) {
    return null
  }

  const hasNotes = releaseNotes.length > 0

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-fade-in">
      <div className={`glass-dialog !p-4 ${hasNotes ? 'max-w-md' : 'max-w-sm'}`}>
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 bg-halo-success/15 rounded-2xl flex items-center justify-center">
            <Download className="w-5 h-5 text-halo-success" />
          </div>

          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold tracking-tight text-foreground">
              {t('New version Halo {{version}} available', { version: notificationVersion })}
            </h4>

            {hasNotes ? (
              <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto text-xs text-muted-foreground">
                {releaseNotes.map((note, index) => (
                  <li key={index} className="flex items-start gap-1.5">
                    <span className="text-halo-success mt-0.5">•</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">
                {isManualDownload || isMac ? t('Click to download') : t('Click to restart and complete update')}
              </p>
            )}

            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleInstall}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-halo-success hover:brightness-110 text-white text-xs font-medium rounded-xl transition-all duration-200"
              >
                {isManualDownload || isMac ? (
                  <>
                    <ExternalLink className="w-3.5 h-3.5" />
                    {t('Go to download')}
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    {t('Restart now')}
                  </>
                )}
              </button>
              <button
                onClick={handleDismiss}
                className="px-3 py-1.5 btn-ghost text-xs"
              >
                {t('Later')}
              </button>
            </div>
          </div>

          <button
            onClick={handleDismiss}
            className="flex-shrink-0 p-1 rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-secondary/50 transition-all duration-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
