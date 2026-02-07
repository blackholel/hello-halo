/**
 * Header Component - Apple-style minimal title bar
 *
 * Design:
 * - Clean, transparent header with glass-subtle effect
 * - Minimal visual weight, content takes priority
 * - Platform-aware padding for window controls
 *
 * Platform handling:
 * - macOS Electron: traffic lights on the left (pl-20)
 * - Windows/Linux Electron: titleBarOverlay buttons on the right (pr-36)
 * - Browser/Mobile: no extra padding needed (pl-4)
 *
 * Height: 44px (slightly taller for elegance)
 * Traffic light vertical center formula: y = height/2 - 7 = 15
 */

import { ReactNode } from 'react'
import { isElectron } from '../../api/transport'

interface HeaderProps {
  /** Left side content (after platform padding) */
  left?: ReactNode
  /** Right side content (before platform padding) */
  right?: ReactNode
  /** Additional className for header */
  className?: string
}

// Get platform info with fallback for SSR/browser
const getPlatform = () => {
  if (typeof window !== 'undefined' && window.platform) {
    return window.platform
  }
  return {
    platform: 'darwin' as const,
    isMac: true,
    isWindows: false,
    isLinux: false
  }
}

export function Header({ left, right, className = '' }: HeaderProps) {
  const platform = getPlatform()
  const isInElectron = isElectron()

  const platformPadding = isInElectron
    ? platform.isMac
      ? 'pl-20 pr-4'
      : 'pl-4 pr-36'
    : 'pl-4 pr-4'

  return (
    <header
      className={`
        flex items-center justify-between h-11
        border-b border-border/50 drag-region
        bg-background/80 backdrop-blur-md
        relative z-20
        ${platformPadding}
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      <div className="flex items-center gap-3 no-drag min-w-0">
        {left}
      </div>

      <div className="flex items-center gap-1.5 no-drag flex-shrink-0">
        {right}
      </div>
    </header>
  )
}

// Export platform detection hook for use in other components
export function usePlatform() {
  return getPlatform()
}
