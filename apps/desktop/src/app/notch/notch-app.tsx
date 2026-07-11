import { useEffect, useRef, useState } from 'react'

import type { NotchState } from '../../store/notch'
import { statusLabel, type VoiceOrbStatus } from '../voice/presentation'

import { faceGlow, NotchFace } from './notch-face'

const DEFAULT_STATE: NotchState = {
  status: 'idle',
  userText: '',
  replyText: '',
  muted: false,
  persona: 'jarvis'
}

// Shape sizes (px). Closed ≈ the physical notch; it springs open on hover/voice.
const CLOSED = { w: 192, h: 34 }
const OPEN = { w: 420, h: 92 }
const OPEN_TALL = { w: 420, h: 216 }
const R_TOP = [6, 11] as const // concave top corner: closed → open
const R_BOTTOM = [14, 24] as const // convex bottom corner: closed → open

function personaLabel(persona: NotchState['persona']): string {
  return persona === 'friday' ? 'F.R.I.D.A.Y.' : 'J.A.R.V.I.S.'
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// The boring.notch shape, translated verbatim from NotchShape.swift: flush top
// with small concave top corners, rounded convex bottom corners.
function notchPath(w: number, h: number, topR: number, bottomR: number): string {
  const tr = Math.max(0, Math.min(topR, w / 2, h))
  const br = Math.max(0, Math.min(bottomR, (w - 2 * tr) / 2, h - tr))

  return [
    `M 0 0`,
    `Q ${tr} 0 ${tr} ${tr}`,
    `L ${tr} ${h - br}`,
    `Q ${tr} ${h} ${tr + br} ${h}`,
    `L ${w - tr - br} ${h}`,
    `Q ${w - tr} ${h} ${w - tr} ${h - br}`,
    `L ${w - tr} ${tr}`,
    `Q ${w - tr} 0 ${w} 0`,
    `L 0 0 Z`
  ].join(' ')
}

// A critically-ish-damped spring toward `target`, ticked on rAF. Re-renders the
// component each frame while settling (cheap for this tiny overlay).
function useSpringValue(target: number, stiffness = 220, damping = 22): number {
  const [, force] = useState(0)
  const s = useRef({ v: target, vel: 0, target })
  s.current.target = target

  useEffect(() => {
    let raf = 0
    const step = () => {
      const st = s.current
      const dt = 1 / 60
      const a = -stiffness * (st.v - st.target) - damping * st.vel
      st.vel += a * dt
      st.v += st.vel * dt

      if (Math.abs(st.vel) < 0.02 && Math.abs(st.v - st.target) < 0.05) {
        st.v = st.target
        st.vel = 0
        force(x => x + 1)
        return
      }

      force(x => x + 1)
      raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)

    return () => cancelAnimationFrame(raf)
  }, [target, stiffness, damping])

  return s.current.v
}

function NotchOrb({ status, size }: { status: VoiceOrbStatus; size: number }): React.ReactElement {
  const glow = faceGlow(status)
  const active = status !== 'off' && status !== 'idle'

  return (
    <div
      className={`notch-orb${active ? ' notch-orb-active' : ''}`}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 35% 30%, ${glow}, ${glow}22 70%)`,
        boxShadow: `0 0 10px ${glow}aa, inset 0 0 6px ${glow}66`
      }}
      aria-hidden
    />
  )
}

/**
 * boring.notch-style HUD. An always-present black shape that hugs the notch and
 * springs open on hover or voice activity — the shape is the exact NotchShape
 * geometry, morphed by a real spring. Renders state pushed from the main
 * renderer's voice loop; toggles OS click-through so it never blocks the desktop.
 */
export function NotchApp(): React.ReactElement {
  const [state, setState] = useState<NotchState>(DEFAULT_STATE)
  const [hovered, setHovered] = useState(false)

  const { status, userText, replyText, persona } = state
  const voiceActive = status !== 'off' && status !== 'idle'
  const hasText = Boolean(userText || replyText)
  const open = hovered || voiceActive || hasText
  const tall = open && hasText

  const targetW = open ? OPEN.w : CLOSED.w
  const targetH = open ? (tall ? OPEN_TALL.h : OPEN.h) : CLOSED.h

  const w = useSpringValue(targetW)
  const h = useSpringValue(targetH)

  // Openness 0→1 for content cross-fade + radius interpolation.
  const p = Math.max(0, Math.min(1, (w - CLOSED.w) / (OPEN.w - CLOSED.w)))
  const topR = lerp(R_TOP[0], R_TOP[1], p)
  const bottomR = lerp(R_BOTTOM[0], R_BOTTOM[1], p)

  // Hit-test against the TARGET size (stable) rather than the animating size.
  const dimsRef = useRef({ w: targetW, h: targetH })
  dimsRef.current = { w: targetW, h: targetH }

  useEffect(() => {
    const off = window.hermesDesktop?.notch?.onState?.(next => {
      if (next) {
        setState(prev => ({ ...prev, ...next }))
      }
    })

    return () => off?.()
  }, [])

  // Hover hit-testing: the window starts click-through; forwarded mousemove lets
  // us flip it interactive over the shape and back (debounced) when it leaves.
  useEffect(() => {
    window.hermesDesktop?.notch?.setIgnoreMouse?.(true)
    let collapseTimer: number | null = null

    const onMove = (e: MouseEvent) => {
      const { w: dw, h: dh } = dimsRef.current
      const cx = window.innerWidth / 2
      const inside = e.clientX >= cx - dw / 2 && e.clientX <= cx + dw / 2 && e.clientY >= 0 && e.clientY <= dh + 10

      window.hermesDesktop?.notch?.setIgnoreMouse?.(!inside)

      if (inside) {
        if (collapseTimer) {
          window.clearTimeout(collapseTimer)
          collapseTimer = null
        }
        setHovered(true)
      } else if (!collapseTimer) {
        collapseTimer = window.setTimeout(() => {
          setHovered(false)
          collapseTimer = null
        }, 160)
      }
    }

    window.addEventListener('mousemove', onMove)

    return () => {
      window.removeEventListener('mousemove', onMove)
      if (collapseTimer) {
        window.clearTimeout(collapseTimer)
      }
    }
  }, [])

  const peekOpacity = Math.max(0, 1 - p * 2.2)
  const contentOpacity = Math.max(0, (p - 0.35) / 0.65)

  return (
    <div className="notch-viewport">
      <div
        className="notch-stage"
        style={{ width: w, height: h }}
        onClick={() => window.hermesDesktop?.notch?.control?.({ type: 'open-app' })}
        role="button"
        tabIndex={-1}
      >
        <svg className="notch-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
          <path d={notchPath(w, h, topR, bottomR)} fill="#000" />
          <path
            d={notchPath(w, h, topR, bottomR)}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
          />
        </svg>

        {/* Closed "peek": a whisper of the face + orb at the notch edges. */}
        <div className="notch-peek" style={{ opacity: peekOpacity, pointerEvents: peekOpacity > 0.5 ? 'auto' : 'none' }}>
          <NotchFace status={status} size={18} />
          <NotchOrb status={status} size={10} />
        </div>

        {/* Open content. */}
        <div className="notch-content" style={{ opacity: contentOpacity, pointerEvents: contentOpacity > 0.5 ? 'auto' : 'none' }}>
          <div className="notch-top">
            <NotchFace status={status} size={30} />
            <div className="notch-label">
              <span className="notch-name">{personaLabel(persona)}</span>
              <span className="notch-status">{statusLabel(status)}</span>
            </div>
            <NotchOrb status={status} size={22} />
          </div>
          {tall && (
            <div className="notch-body">
              {userText && <div className="notch-user">{userText}</div>}
              {replyText && <div className="notch-reply">{replyText}</div>}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .notch-viewport {
          width: 100vw; height: 100vh;
          display: flex; justify-content: center; align-items: flex-start;
          background: transparent; overflow: hidden;
          -webkit-user-select: none; user-select: none;
          color: #eef2ff;
        }
        .notch-stage {
          position: relative;
          cursor: pointer;
          filter: drop-shadow(0 10px 24px rgba(0,0,0,0.45));
        }
        .notch-svg { position: absolute; inset: 0; display: block; }
        .notch-peek {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 16px;
          transition: opacity 120ms ease;
        }
        .notch-content {
          position: absolute; inset: 0;
          padding: 12px 18px;
          display: flex; flex-direction: column;
          transition: opacity 140ms ease;
        }
        .notch-top { display: flex; align-items: center; gap: 12px; }
        .notch-label { display: flex; flex-direction: column; line-height: 1.15; flex: 1; min-width: 0; }
        .notch-name { font-size: 11px; letter-spacing: 0.14em; font-weight: 600; color: #aebfe6; }
        .notch-status { font-size: 13px; font-weight: 500; color: #eef2ff; }
        .notch-orb { border-radius: 50%; flex: 0 0 auto; transition: box-shadow 220ms ease, background 220ms ease; }
        .notch-orb-active { animation: notch-pulse 1.4s ease-in-out infinite; }
        @keyframes notch-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.18); } }
        .notch-body {
          margin-top: 10px; display: flex; flex-direction: column; gap: 6px;
          overflow-y: auto; flex: 1;
        }
        .notch-user { font-size: 13px; color: #b9c6e6; }
        .notch-reply { font-size: 14px; color: #fff; line-height: 1.35; }
        @media (prefers-reduced-motion: reduce) { .notch-orb-active { animation: none; } }
      `}</style>
    </div>
  )
}
