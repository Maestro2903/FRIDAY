import { useEffect, useMemo, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { LiveWaveform } from '@/components/voice/live-waveform'
import { LazyOrb as Orb } from '@/components/voice/orb-lazy'
import { ShimmeringText } from '@/components/voice/shimmering-text'
import { AudioLines, Mic, Volume2, VolumeX } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { pushNotchState } from '@/store/notch'

import { orbAgentState, orbColors, statusLabel } from './presentation'
import { useVoiceOrb } from './use-voice-orb'

/**
 * Full-page Voice view (an in-page route like Skills/Messaging/Artifacts, not a
 * modal overlay). Renders the ElevenLabs-blue Orb + transcript and runs the
 * hands-free loop while mounted.
 */
export function VoiceView() {
  const voice = useVoiceOrb(true)
  const { status, level, muted, transcript, partialReply, error, toggleMute, stopTurn, clearTranscript } = voice

  const listening = status === 'idle' || status === 'listening'

  const colors = useMemo(() => orbColors(status), [status])
  const thinking = status === 'thinking' || status === 'transcribing'
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current

    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [transcript, partialReply])

  // Mirror live voice state to the notch HUD (a no-op when the notch window
  // isn't open). The notch is a display; this view owns the actual voice loop.
  const lastUser = useMemo(() => {
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
      if (transcript[i].role === 'user') {
        return transcript[i].text
      }
    }

    return ''
  }, [transcript])
  const lastAssistant = useMemo(() => {
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
      if (transcript[i].role === 'assistant') {
        return transcript[i].text
      }
    }

    return ''
  }, [transcript])

  useEffect(() => {
    pushNotchState({
      status,
      userText: lastUser,
      replyText: partialReply || lastAssistant,
      muted,
      persona: 'jarvis'
    })
  }, [status, lastUser, lastAssistant, partialReply, muted])

  return (
    <div className="flex h-full min-h-0 flex-col bg-(--ui-chat-surface-background)">
      <div className="flex min-h-0 flex-1 flex-col items-center gap-6 px-6 pb-6 pt-[calc(var(--titlebar-height)+1.5rem)]">
        <div className="flex items-center gap-2 text-(--ui-text-tertiary)">
          <AudioLines className="size-4" />
          <span className="text-xs font-medium uppercase tracking-wide">J.A.R.V.I.S.</span>
        </div>

        {/* Orb */}
        <div className="relative h-52 w-52 shrink-0 sm:h-60 sm:w-60">
          <Orb agentState={orbAgentState(status)} className="absolute inset-0 h-full w-full" colors={colors} />
        </div>

        {/* Live mic waveform — visible proof the agent is listening */}
        <LiveWaveform active={listening && !muted} className="w-64 max-w-full" level={level} />

        {/* Status */}
        <div className="flex h-7 items-center">
          {thinking ? (
            <ShimmeringText className="text-lg" spread={1} text={statusLabel(status)} />
          ) : (
            <span
              className={cn(
                'text-lg font-medium',
                status === 'listening' ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {muted ? 'Muted' : statusLabel(status)}
            </span>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <Button className="gap-2" onClick={toggleMute} size="sm" variant={muted ? 'default' : 'outline'}>
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            {muted ? 'Resume' : 'Mute'}
          </Button>
          <Button className="gap-2" disabled={muted} onClick={stopTurn} size="sm" variant="ghost">
            <Mic className="size-4" />
            {status === 'listening' ? 'Send now' : 'Interrupt'}
          </Button>
          {transcript.length > 0 && (
            <Button onClick={clearTranscript} size="sm" variant="ghost">
              Clear
            </Button>
          )}
        </div>

        {error && <p className="max-w-md text-center text-sm text-destructive">{error}</p>}

        {/* Transcript */}
        <div
          className="flex w-full max-w-2xl flex-1 flex-col gap-3 overflow-y-auto rounded-lg border border-border/60 bg-background/40 p-4"
          ref={scrollRef}
        >
          {transcript.length === 0 && !partialReply ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
              <p className="text-sm font-medium text-foreground">Just start talking</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Ask a question or give Hermes a task. It listens hands-free and speaks back.
              </p>
            </div>
          ) : (
            <>
              {transcript.map(entry => (
                <MessageRow key={entry.id} role={entry.role} text={entry.text} />
              ))}
              {partialReply && <MessageRow role="assistant" streaming text={partialReply} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function MessageRow({
  role,
  text,
  streaming
}: {
  role: 'user' | 'assistant' | 'system'
  text: string
  streaming?: boolean
}) {
  if (role === 'system') {
    return <div className="text-center text-xs text-destructive">{text}</div>
  }

  const isUser = role === 'user'

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm',
          isUser ? 'bg-primary/15 text-foreground' : 'bg-muted text-foreground',
          streaming && 'opacity-90'
        )}
      >
        {text}
      </div>
    </div>
  )
}

export default VoiceView
