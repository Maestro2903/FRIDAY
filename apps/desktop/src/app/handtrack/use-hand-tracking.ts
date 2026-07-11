import { useEffect, useRef, useState } from 'react'

// Webcam hand tracking via MediaPipe Tasks Vision (HandLandmarker). This is an
// OPTIONAL enhancement: the app wheel is fully usable by keyboard/pointer without
// it. MediaPipe is loaded at RUNTIME from its CDN ESM bundle (not bundled), so no
// npm install is needed — it just requires camera permission (requested here) and
// network access on first use to fetch the module + WASM + model (all cached
// after). To run fully offline, host these three URLs locally and swap them.

// Minimal shapes of the bits of the MediaPipe API we use.
interface Landmark {
  x: number
  y: number
  z: number
}
interface HandResult {
  landmarks: Landmark[][]
}
interface HandLandmarkerLike {
  detectForVideo: (video: HTMLVideoElement, timestampMs: number) => HandResult
  close: () => void
}

const MP_VERSION = '0.10.14'
// Loaded at runtime from the CDN (see note above). Typed as `string` so TS
// doesn't try to resolve the URL as a module.
const CDN_ESM: string = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

// Landmark indices (MediaPipe hand model).
const WRIST = 0
const THUMB_TIP = 4
const INDEX_TIP = 8
const MIDDLE_MCP = 9

// Skeleton connections for drawing.
const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
]

export interface HandTracking {
  available: boolean
  error: string | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  /** Hand roll angle in radians (wrist → middle-finger vector), or null. */
  angle: number | null
  /** Increments each time a pinch (thumb+index) is detected — drives "select". */
  pinchCount: number
}

/**
 * Track one hand from the webcam. Wire `videoRef` to a <video> and `canvasRef`
 * to a <canvas> overlay; `angle` drives the wheel rotation and `pinchCount`
 * fires a selection. Degrades gracefully (available=false) if the dep, camera,
 * or model can't load.
 */
export function useHandTracking(enabled: boolean): HandTracking {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [available, setAvailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [angle, setAngle] = useState<number | null>(null)
  const [pinchCount, setPinchCount] = useState(0)

  const pinchingRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      return
    }

    let cancelled = false
    let raf = 0
    let landmarker: HandLandmarkerLike | null = null
    let stream: MediaStream | null = null

    const start = async () => {
      try {
        await window.hermesDesktop?.requestCameraAccess?.()

        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
        const video = videoRef.current

        if (!video || cancelled) {
          return
        }

        video.srcObject = stream
        await video.play()

        // Runtime import from the CDN ESM bundle (@vite-ignore so Vite leaves the
        // URL alone; the browser imports it natively). No npm dep required.
        const vision: {
          FilesetResolver: { forVisionTasks: (base: string) => Promise<unknown> }
          HandLandmarker: {
            createFromOptions: (fileset: unknown, opts: unknown) => Promise<HandLandmarkerLike>
          }
        } = await import(/* @vite-ignore */ CDN_ESM)

        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE)
        landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          numHands: 1,
          runningMode: 'VIDEO'
        })

        if (cancelled) {
          return
        }

        setAvailable(true)

        const loop = () => {
          if (cancelled || !landmarker || !video) {
            return
          }

          try {
            const result = landmarker.detectForVideo(video, performance.now())
            const hand = result.landmarks?.[0]

            if (hand && hand.length >= 21) {
              const wrist = hand[WRIST]
              const mid = hand[MIDDLE_MCP]
              // Roll angle of the palm in the image plane.
              setAngle(Math.atan2(mid.y - wrist.y, mid.x - wrist.x))

              // Pinch: thumb tip close to index tip (rising edge → one select).
              const thumb = hand[THUMB_TIP]
              const index = hand[INDEX_TIP]
              const dist = Math.hypot(thumb.x - index.x, thumb.y - index.y)
              const pinching = dist < 0.06

              if (pinching && !pinchingRef.current) {
                setPinchCount(c => c + 1)
              }

              pinchingRef.current = pinching
              drawSkeleton(canvasRef.current, hand)
            } else {
              setAngle(null)
              pinchingRef.current = false
              clearCanvas(canvasRef.current)
            }
          } catch {
            /* transient detect failure — keep looping */
          }

          raf = requestAnimationFrame(loop)
        }

        raf = requestAnimationFrame(loop)
      } catch (e) {
        if (!cancelled) {
          setAvailable(false)
          setError(e instanceof Error ? e.message : 'Hand tracking unavailable')
        }
      }
    }

    void start()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      try {
        landmarker?.close()
      } catch {
        /* ignore */
      }
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [enabled])

  return { available, error, videoRef, canvasRef, angle, pinchCount }
}

function clearCanvas(canvas: HTMLCanvasElement | null): void {
  const ctx = canvas?.getContext('2d')
  if (canvas && ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }
}

function drawSkeleton(canvas: HTMLCanvasElement | null, hand: Landmark[]): void {
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) {
    return
  }

  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(90, 209, 255, 0.9)'
  ctx.lineWidth = 2

  for (const [a, b] of CONNECTIONS) {
    const pa = hand[a]
    const pb = hand[b]
    if (!pa || !pb) {
      continue
    }
    ctx.beginPath()
    ctx.moveTo(pa.x * w, pa.y * h)
    ctx.lineTo(pb.x * w, pb.y * h)
    ctx.stroke()
  }

  ctx.fillStyle = 'rgba(126, 240, 162, 0.95)'
  for (const p of hand) {
    ctx.beginPath()
    ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2)
    ctx.fill()
  }
}
