import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

interface LiveWaveformProps {
  /** Current mic input level, 0..1. */
  level: number
  /** Whether the mic is actively listening (drives the scroll + reactivity). */
  active: boolean
  /** Number of bars. */
  barCount?: number
  className?: string
}

/**
 * A lightweight, mirror-symmetric bar waveform driven by the mic `level` the
 * voice engine already computes — so the user can *see* the agent is listening
 * (bars react to their voice) without opening a second microphone stream.
 */
export function LiveWaveform({ level, active, barCount = 32, className }: LiveWaveformProps) {
  const [bars, setBars] = useState<number[]>(() => new Array(barCount).fill(0))
  const rafRef = useRef<number | null>(null)
  const levelRef = useRef(level)

  useEffect(() => {
    levelRef.current = level
  }, [level])

  useEffect(() => {
    if (!active) {
      // Settle to a flat idle line.
      setBars(new Array(barCount).fill(0))

      return
    }

    const tick = () => {
      setBars(prev => {
        const next = prev.slice(1)
        // A touch of smoothing/gain so quiet speech still reads visually.
        next.push(Math.min(1, levelRef.current * 1.6))

        return next
      })
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) {cancelAnimationFrame(rafRef.current)}
      rafRef.current = null
    }
  }, [active, barCount])

  return (
    <div aria-hidden className={cn('flex h-8 items-center justify-center gap-[3px]', className)}>
      {bars.map((v, i) => (
        <span
          className={cn(
            'w-[3px] rounded-full transition-[height,opacity] duration-75 ease-out',
            active ? 'bg-primary/80' : 'bg-muted-foreground/30'
          )}
          key={i}
          style={{ height: `${Math.max(8, v * 100)}%`, opacity: active ? 0.55 + v * 0.45 : 0.4 }}
        />
      ))}
    </div>
  )
}
