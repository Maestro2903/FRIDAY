import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useHandTracking } from './use-hand-tracking'

// The hand-control "control panel": a full-screen overlay showing a radial wheel
// of the user's CHOSEN apps (curated in the built-in picker or Settings). Rotate
// with a hand roll (MediaPipe), the arrow keys, or the scroll wheel; select the
// top app with a pinch, Enter, or a click — which launches it and closes the
// overlay. Fully usable without the camera.

const TAU = Math.PI * 2

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

function closeOverlay(): void {
  void window.hermesDesktop?.handtrack?.close()
}

function AppIcon({ app, size }: { app: InstalledApp; size: number }): React.ReactElement {
  if (app.icon) {
    return <img src={app.icon} alt="" width={size} height={size} draggable={false} style={{ objectFit: 'contain' }} />
  }

  return (
    <span className="ht-fallback" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {app.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function HandtrackApp(): React.ReactElement {
  const [allApps, setAllApps] = useState<InstalledApp[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [rotation, setRotation] = useState(0)
  const { available, videoRef, canvasRef, angle, pinchCount } = useHandTracking(true)

  // Load installed apps + the saved selection.
  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.hermesDesktop?.apps?.list(),
      window.hermesDesktop?.apps?.getSelection()
    ]).then(([list, sel]) => {
      if (cancelled) {
        return
      }
      if (list?.ok) {
        setAllApps(list.apps)
      }
      if (sel?.ok) {
        setSelected(sel.apps)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  // The apps actually on the wheel, in the user's chosen order.
  const wheelApps = useMemo(
    () => selected.map(name => allApps.find(a => a.name === name)).filter((a): a is InstalledApp => Boolean(a)),
    [selected, allApps]
  )

  const count = wheelApps.length
  const step = count > 0 ? TAU / count : TAU
  const selectedIndex = count > 0 ? mod(Math.round(-rotation / step), count) : -1

  const launch = useCallback(
    (index: number) => {
      const target = wheelApps[index]
      if (target) {
        void window.hermesDesktop?.apps?.launch(target.name)
        closeOverlay()
      }
    },
    [wheelApps]
  )

  const toggleApp = useCallback((name: string) => {
    setSelected(prev => {
      const next = prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
      void window.hermesDesktop?.apps?.setSelection(next)
      return next
    })
  }, [])

  // Hand roll → smoothly rotate the wheel.
  useEffect(() => {
    if (angle == null || editing) {
      return
    }
    const target = -angle * 2
    setRotation(prev => prev + (target - prev) * 0.2)
  }, [angle, editing])

  // Pinch → select the top app.
  const lastPinch = useRef(0)
  useEffect(() => {
    if (pinchCount > lastPinch.current) {
      lastPinch.current = pinchCount
      if (!editing && selectedIndex >= 0) {
        launch(selectedIndex)
      }
    }
  }, [pinchCount, selectedIndex, launch, editing])

  // Keyboard + scroll controls (disabled while editing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editing) {
          setEditing(false)
        } else {
          closeOverlay()
        }
        return
      }
      if (editing) {
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setRotation(r => r - step)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setRotation(r => r + step)
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        launch(selectedIndex)
      }
    }
    const onWheel = (e: WheelEvent) => {
      if (!editing) {
        setRotation(r => r + (e.deltaY > 0 ? -step : step) * 0.5)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: true })

    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [step, selectedIndex, launch, editing])

  const radius = 210
  const positions = useMemo(
    () =>
      wheelApps.map((app, i) => {
        const a = -Math.PI / 2 + i * step + rotation
        return { app, index: i, x: Math.cos(a) * radius, y: Math.sin(a) * radius, top: i === selectedIndex }
      }),
    [wheelApps, step, rotation, selectedIndex]
  )

  const selectedApp = selectedIndex >= 0 ? wheelApps[selectedIndex] : null

  return (
    <div className="ht-viewport">
      <div className="ht-toolbar">
        <button type="button" className="ht-btn" onClick={() => setEditing(e => !e)}>
          {editing ? 'Done' : 'Choose apps'}
        </button>
        <button type="button" className="ht-btn ht-btn-x" aria-label="Close" onClick={closeOverlay}>
          ×
        </button>
      </div>

      {editing ? (
        <div className="ht-picker">
          <div className="ht-picker-title">Choose apps for the wheel</div>
          <div className="ht-picker-grid">
            {allApps.map(app => {
              const on = selected.includes(app.name)
              return (
                <button
                  key={app.path}
                  type="button"
                  className={`ht-pick${on ? ' ht-pick-on' : ''}`}
                  onClick={() => toggleApp(app.name)}
                  title={app.name}
                >
                  <AppIcon app={app} size={40} />
                  <span className="ht-pick-name">{app.name}</span>
                  {on && <span className="ht-pick-check">✓</span>}
                </button>
              )
            })}
          </div>
        </div>
      ) : count === 0 ? (
        <div className="ht-empty">
          <div className="ht-empty-title">No apps in the wheel yet</div>
          <button type="button" className="ht-btn ht-btn-primary" onClick={() => setEditing(true)}>
            Choose apps
          </button>
        </div>
      ) : (
        <div className="ht-wheel">
          {positions.map(p => (
            <button
              key={p.app.path}
              type="button"
              className={`ht-app${p.top ? ' ht-app-top' : ''}`}
              style={{ transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)` }}
              onClick={() => launch(p.index)}
              title={p.app.name}
            >
              <AppIcon app={p.app} size={p.top ? 52 : 44} />
            </button>
          ))}
          <div className="ht-center">
            <div className="ht-center-name">{selectedApp?.name ?? ''}</div>
            <div className="ht-center-hint">
              {available ? 'Roll your hand · pinch to open' : 'Arrow keys / scroll · Enter to open'}
            </div>
          </div>
        </div>
      )}

      <div className={`ht-cam${available ? '' : ' ht-cam-hidden'}`}>
        <video ref={videoRef} className="ht-video" muted playsInline width={160} height={120} />
        <canvas ref={canvasRef} className="ht-canvas" width={160} height={120} />
      </div>

      <style>{`
        .ht-viewport {
          position: fixed; inset: 0;
          display: flex; align-items: center; justify-content: center;
          background: radial-gradient(circle at center, rgba(8,10,16,0.74), rgba(4,5,8,0.9));
          color: #eef2ff; -webkit-user-select: none; user-select: none; overflow: hidden;
        }
        .ht-toolbar { position: fixed; top: 16px; right: 20px; display: flex; gap: 8px; }
        .ht-btn {
          padding: 6px 14px; border: 1px solid rgba(255,255,255,0.14); border-radius: 10px;
          background: rgba(255,255,255,0.07); color: #dfe7fb; font-size: 13px; cursor: pointer;
        }
        .ht-btn:hover { background: rgba(255,255,255,0.14); }
        .ht-btn-primary { background: #5ad1ff; color: #04121a; border-color: transparent; font-weight: 600; }
        .ht-btn-x { width: 34px; padding: 0; height: 34px; border-radius: 50%; font-size: 20px; }
        .ht-wheel { position: relative; width: 500px; height: 500px; }
        .ht-app {
          position: absolute; left: 50%; top: 50%; width: 62px; height: 62px; padding: 0;
          border: none; border-radius: 16px; background: rgba(255,255,255,0.06);
          box-shadow: 0 4px 16px rgba(0,0,0,0.4); cursor: pointer; opacity: 0.72;
          display: flex; align-items: center; justify-content: center;
          transition: transform 140ms cubic-bezier(0.22,1,0.36,1), box-shadow 140ms ease, opacity 140ms ease;
        }
        .ht-app-top { opacity: 1; box-shadow: 0 0 0 2px #5ad1ff, 0 8px 28px rgba(90,209,255,0.5); }
        .ht-fallback {
          display: inline-flex; align-items: center; justify-content: center;
          border-radius: 12px; background: rgba(255,255,255,0.12); color: #cdd8f5; font-weight: 600;
        }
        .ht-center {
          position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
          text-align: center; pointer-events: none; width: 220px;
        }
        .ht-center-name { font-size: 20px; font-weight: 600; min-height: 24px; }
        .ht-center-hint { margin-top: 4px; font-size: 12px; color: #8fa0c8; }
        .ht-empty { text-align: center; display: flex; flex-direction: column; gap: 16px; align-items: center; }
        .ht-empty-title { font-size: 18px; color: #cdd8f5; }
        .ht-picker {
          width: min(760px, 86vw); max-height: 74vh; display: flex; flex-direction: column;
          background: rgba(16,18,26,0.9); border: 1px solid rgba(255,255,255,0.1);
          border-radius: 18px; padding: 18px; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        }
        .ht-picker-title { font-size: 16px; font-weight: 600; margin-bottom: 14px; }
        .ht-picker-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
          gap: 10px; overflow-y: auto; padding-right: 6px;
        }
        .ht-pick {
          position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px;
          padding: 12px 6px; border: 1px solid transparent; border-radius: 12px;
          background: rgba(255,255,255,0.04); color: #cdd8f5; cursor: pointer;
        }
        .ht-pick:hover { background: rgba(255,255,255,0.09); }
        .ht-pick-on { border-color: #5ad1ff; background: rgba(90,209,255,0.12); }
        .ht-pick-name {
          font-size: 11px; text-align: center; max-width: 90px; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
        }
        .ht-pick-check {
          position: absolute; top: 6px; right: 8px; color: #5ad1ff; font-weight: 700; font-size: 13px;
        }
        .ht-cam {
          position: fixed; left: 20px; bottom: 20px; width: 160px; height: 120px;
          border-radius: 10px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1); opacity: 0.9;
        }
        .ht-cam-hidden { display: none; }
        .ht-video { transform: scaleX(-1); width: 160px; height: 120px; object-fit: cover; }
        .ht-canvas { position: absolute; inset: 0; transform: scaleX(-1); }
      `}</style>
    </div>
  )
}
