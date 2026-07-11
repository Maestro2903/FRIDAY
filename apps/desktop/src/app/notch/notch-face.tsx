import type { VoiceOrbStatus } from '../voice/presentation'

// A small, friendly animated face for the left of the notch HUD. Pure SVG + CSS
// so it's cheap in a transparent panel (no WebGL). Expression is keyed to the
// voice state: calm when idle, wide-eyed while listening, a thinking squint, and
// an animated mouth while speaking. It blinks on a loop.
//
// Colour is a status-driven glow so the face doubles as a state indicator,
// matching the orb on the right.

export function faceGlow(status: VoiceOrbStatus): string {
  switch (status) {
    case 'listening':
      return '#5ad1ff' // cyan — hearing you
    case 'transcribing':
    case 'thinking':
      return '#ffcc66' // amber — working
    case 'speaking':
      return '#7ef0a2' // green — talking
    case 'idle':
      return '#9fb8ff' // soft blue — ready
    default:
      return '#5b6b8c' // dim — paused/off
  }
}

interface NotchFaceProps {
  status: VoiceOrbStatus
  size?: number
}

export function NotchFace({ status, size = 30 }: NotchFaceProps): React.ReactElement {
  const glow = faceGlow(status)
  const speaking = status === 'speaking'
  const listening = status === 'listening'
  const thinking = status === 'thinking' || status === 'transcribing'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden
      style={{ filter: `drop-shadow(0 0 6px ${glow}88)`, transition: 'filter 200ms ease' }}
    >
      {/* face ring */}
      <circle
        cx="20"
        cy="20"
        r="16"
        stroke={glow}
        strokeWidth="2"
        opacity="0.9"
        style={{ transition: 'stroke 200ms ease' }}
      />
      {/* eyes */}
      <g fill={glow} style={{ transition: 'fill 200ms ease' }}>
        <circle className="notch-eye" cx="14" cy={listening ? 16 : 17} r={listening ? 2.4 : 2} />
        <circle className="notch-eye" cx="26" cy={listening ? 16 : 17} r={listening ? 2.4 : 2} />
      </g>
      {/* mouth: a smile when idle, a flat line while thinking, an animated
          bar while speaking */}
      {speaking ? (
        <rect className="notch-mouth-speak" x="14" y="25" width="12" height="3" rx="1.5" fill={glow} />
      ) : thinking ? (
        <line x1="15" y1="26" x2="25" y2="26" stroke={glow} strokeWidth="2" strokeLinecap="round" />
      ) : (
        <path
          d="M14 24 Q20 29 26 24"
          stroke={glow}
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      )}
      <style>{`
        .notch-eye { animation: notch-blink 4.2s infinite; transform-origin: center; }
        @keyframes notch-blink {
          0%, 92%, 100% { transform: scaleY(1); }
          95% { transform: scaleY(0.1); }
        }
        .notch-mouth-speak { animation: notch-talk 0.5s ease-in-out infinite; transform-origin: 20px 26px; }
        @keyframes notch-talk {
          0%, 100% { transform: scaleY(1); }
          50% { transform: scaleY(2.2); }
        }
        @media (prefers-reduced-motion: reduce) {
          .notch-eye, .notch-mouth-speak { animation: none; }
        }
      `}</style>
    </svg>
  )
}
