/**
 * ChatCapsuleOverlay - Floating capsule button for returning to chat
 *
 * This is the overlay version of ChatCapsule that renders in the
 * overlay WebContentsView, ensuring it appears above BrowserViews.
 *
 * Design:
 * - Monochrome style for consistency with app theme
 * - Circular button with shadow for depth
 * - Fixed position on left edge, vertically centered
 *
 * Future enhancements (TODO):
 * - Show unread message count badge
 * - Show AI typing/thinking animation
 * - Hover preview of recent messages
 */

import { useEffect, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { useTranslation } from '../i18n'

interface ChatCapsuleOverlayProps {
  onClick: () => void
}

export function ChatCapsuleOverlay({ onClick }: ChatCapsuleOverlayProps) {
  const { t } = useTranslation()
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    })

    return () => observer.disconnect()
  }, [])

  const baseBackground = isDark ? '#f3f4f6' : '#111111'
  const baseBorder = isDark ? '1px solid rgba(243, 244, 246, 0.92)' : '1px solid rgba(17, 17, 17, 0.9)'
  const baseShadow = isDark ? '0 2px 6px rgba(0, 0, 0, 0.35)' : '0 2px 6px rgba(0, 0, 0, 0.2)'
  const hoverShadow = isDark ? '0 3px 8px rgba(0, 0, 0, 0.4)' : '0 3px 8px rgba(0, 0, 0, 0.24)'
  const iconColor = isDark ? '#111111' : '#ffffff'

  return (
    <button
      onClick={onClick}
      style={{
        // Inline styles for reliability (no CSS class dependency)
        position: 'fixed',
        left: '12px',
        top: '50%',
        transform: 'translateY(-50%)',
        width: '44px',
        height: '44px',
        borderRadius: '50%',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: baseBackground,
        border: baseBorder,
        boxShadow: baseShadow,
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        pointerEvents: 'auto',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-50%) scale(1.1)'
        e.currentTarget.style.boxShadow = hoverShadow
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(-50%) scale(1)'
        e.currentTarget.style.boxShadow = baseShadow
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = 'translateY(-50%) scale(0.95)'
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = 'translateY(-50%) scale(1.1)'
      }}
      title={t('Return to conversation')}
      aria-label={t('Exit fullscreen and return to chat')}
    >
      {/* High-contrast icon for current theme */}
      <MessageCircle
        style={{
          width: '22px',
          height: '22px',
          color: iconColor,
        }}
      />
    </button>
  )
}
