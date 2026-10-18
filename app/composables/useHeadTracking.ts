/**
 * Hands-free look and point (Sprint 5). Webcam → MediaPipe Face Landmarker (with the facial
 * transformation matrix) → head yaw/pitch → the camera, and Hand Landmarker → a pointed index finger →
 * a gaze override, so "put a tower there" while pointing uses the pointed spot.
 *
 * Client-only and lazy: nothing (module, WASM, models, camera) loads until `enable()`. The WASM comes
 * from jsdelivr pinned to the installed package version; the models from storage.googleapis.com.
 * Head look ADDS to the mouse/WASD controls: each frame it nudges renderer.yaw/pitch by the change in
 * its own offset plus a rate term, so mouse-look keeps working underneath.
 */
import { shallowRef } from 'vue'
import type { FaceLandmarker, HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { applyHeadLook, detectPointing, headAngles, smooth, wrapDeg } from '~/world/tracking/math'
import { setGazeOverride } from '~/world/look'

/** Keep in step with package.json (tests/tracking.test.ts checks it against the installed package). */
export const MEDIAPIPE_VERSION = '1.1.1'
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

export type TrackingStatus = 'off' | 'starting' | 'loading' | 'no-face' | 'tracking' | 'denied' | 'unavailable' | 'error'

export interface TrackingFrame {
  face: NormalizedLandmark[] | null
  hand: NormalizedLandmark[] | null
  /** Video aspect (w / h), for drawing and pointing math. */
  aspect: number
}

/** Smoothing time constants (seconds). */
const HEAD_TAU = 0.12
const POINT_TAU = 0.08
/** Frames of agreement before pointing turns on / off, so a flicker doesn't jump the gaze. */
const POINT_ON = 3
const POINT_OFF = 5

const enabled = shallowRef(false)
const status = shallowRef<TrackingStatus>('off')
const error = shallowRef('')
/** Smoothed head angles relative to the calibrated centre (degrees). */
const yaw = shallowRef(0)
const pitch = shallowRef(0)
const pointing = shallowRef(false)
/** NDC screen point the gaze is cast through while pointing; null otherwise. */
const pointRay = shallowRef<[number, number] | null>(null)
const stream = shallowRef<MediaStream | null>(null)
const frame = shallowRef<TrackingFrame>({ face: null, hand: null, aspect: 4 / 3 })
const connections = shallowRef<{ face: { start: number, end: number }[], hand: { start: number, end: number }[] }>({ face: [], hand: [] })

let face: FaceLandmarker | null = null
let hands: HandLandmarker | null = null
let video: HTMLVideoElement | null = null
let raf = 0
let lastVideoTime = -1
let lastTick = 0
let lastDetect = 0
let center: { yaw: number, pitch: number } | null = null
let raw = { yaw: 0, pitch: 0 }
let applied = { yaw: 0, pitch: 0 }
let pointVotes = 0
let smoothNdc: [number, number] | null = null
let session = 0
/** A pointed spot forced from devtools / the shoot script (no hand needed). */
let forced: [number, number] | null = null

async function loadModels() {
  if (face && hands) return
  const vision = await import('@mediapipe/tasks-vision')
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL)
  const make = async (delegate: 'GPU' | 'CPU') => Promise.all([
    vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFacialTransformationMatrixes: true
    }),
    vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: HAND_MODEL, delegate },
      runningMode: 'VIDEO',
      numHands: 1
    })
  ])
  try {
    ;[face, hands] = await make('GPU')
  } catch (err) {
    console.warn('[voice-world] MediaPipe GPU delegate failed, falling back to CPU', err)
    ;[face, hands] = await make('CPU')
  }
  connections.value = { face: vision.FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, hand: vision.HandLandmarker.HAND_CONNECTIONS }
}

/** Turn the camera on: permission → models → loop. Resolves with the final status (never throws). */
async function enable(): Promise<TrackingStatus> {
  if (enabled.value) return status.value
  const my = ++session
  enabled.value = true
  error.value = ''
  status.value = 'starting'
  if (!navigator.mediaDevices?.getUserMedia) {
    return fail('unavailable', 'This browser has no camera access.')
  }
  let s: MediaStream
  try {
    s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false })
  } catch (err) {
    const name = (err as DOMException).name
    if (name === 'NotAllowedError' || name === 'SecurityError') return fail('denied', 'Camera permission was denied.')
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return fail('unavailable', 'No camera found.')
    return fail('error', `Camera: ${(err as Error).message}`)
  }
  if (my !== session) {
    s.getTracks().forEach(t => t.stop())
    return status.value
  }
  stream.value = s
  status.value = 'loading'
  try {
    video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = s
    await video.play()
    await loadModels()
  } catch (err) {
    console.warn('[voice-world] head tracking failed to start', err)
    return fail('error', `Tracking: ${(err as Error).message}`)
  }
  if (my !== session) return status.value
  center = null
  applied = { yaw: 0, pitch: 0 }
  lastTick = performance.now()
  lastDetect = lastTick
  status.value = 'no-face'
  loop()
  return status.value
}

function fail(s: TrackingStatus, msg: string): TrackingStatus {
  stop()
  status.value = s
  error.value = msg
  return s
}

function stop() {
  session++
  cancelAnimationFrame(raf)
  raf = 0
  stream.value?.getTracks().forEach(t => t.stop())
  stream.value = null
  if (video) video.srcObject = null
  video = null
  enabled.value = false
  pointing.value = false
  pointRay.value = null
  pointVotes = 0
  smoothNdc = null
  setGazeOverride(null)
  frame.value = { face: null, hand: null, aspect: frame.value.aspect }
  lastVideoTime = -1
}

function disable() {
  stop()
  status.value = 'off'
  error.value = ''
  yaw.value = 0
  pitch.value = 0
}

async function toggle(): Promise<TrackingStatus> {
  if (!enabled.value) return enable()
  disable()
  return status.value
}

/** "Look at the centre": the current head pose becomes neutral. The camera stays where it is. */
function recenter() {
  center = face && enabled.value ? { ...raw } : null
  applied = { yaw: 0, pitch: 0 }
  yaw.value = 0
  pitch.value = 0
}

function loop() {
  raf = requestAnimationFrame(loop)
  const v = video
  if (!v || !face || !hands || v.readyState < 2) return
  const now = performance.now()
  const dt = Math.min(0.1, (now - lastTick) / 1000)
  lastTick = now
  const r = useWorld().renderer()
  const aspect = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3

  let handLm: NormalizedLandmark[] | null = null
  let matrix: number[] | null = null
  let fresh = false
  // Smoothing runs per detection, so it needs the time since the last detection, not the last paint.
  let ddt = dt
  if (v.currentTime !== lastVideoTime) {
    lastVideoTime = v.currentTime
    fresh = true
    ddt = Math.min(0.2, (now - lastDetect) / 1000)
    lastDetect = now
    try {
      const fr = face.detectForVideo(v, now)
      const faceLm = fr.faceLandmarks[0] ?? null
      matrix = fr.facialTransformationMatrixes?.[0]?.data ?? null
      const hr = hands.detectForVideo(v, now)
      handLm = hr.landmarks[0] ?? null
      frame.value = { face: faceLm, hand: handLm, aspect }
    } catch (err) {
      console.warn('[voice-world] tracking frame failed', err)
      return
    }
  }

  // ---- head → camera ----
  if (fresh) {
    if (matrix) {
      const a = headAngles(matrix)
      raw = { yaw: smooth(raw.yaw, a.yaw, ddt, center ? HEAD_TAU : 0), pitch: smooth(raw.pitch, a.pitch, ddt, center ? HEAD_TAU : 0) }
      // Calibrate on the first face after enabling: wherever you're looking is "centre".
      if (!center) center = { ...raw }
      status.value = 'tracking'
    } else if (status.value === 'tracking') {
      status.value = 'no-face'
    }
  }
  if (r && center && status.value === 'tracking') {
    const relYaw = wrapDeg(raw.yaw - center.yaw)
    const relPitch = raw.pitch - center.pitch
    yaw.value = relYaw
    pitch.value = relPitch
    const next = applyHeadLook({ yaw: r.yaw, pitch: r.pitch }, applied, { yaw: relYaw, pitch: relPitch }, dt)
    r.yaw = next.cam.yaw
    r.pitch = next.cam.pitch
    applied = next.applied
  }

  // ---- hand → gaze override ----
  if (fresh) {
    const p = detectPointing(handLm, aspect)
    pointVotes = p.pointing ? Math.min(POINT_ON, Math.max(0, pointVotes) + 1) : Math.max(-POINT_OFF, Math.min(0, pointVotes) - 1)
    if (p.pointing && p.ndc) {
      smoothNdc = smoothNdc
        ? [smooth(smoothNdc[0], p.ndc[0], ddt, POINT_TAU), smooth(smoothNdc[1], p.ndc[1], ddt, POINT_TAU)]
        : p.ndc
    }
    if (!pointing.value && pointVotes >= POINT_ON) pointing.value = true
    if (pointing.value && pointVotes <= -POINT_OFF) {
      pointing.value = false
      smoothNdc = null
    }
    pointRay.value = forced ?? (pointing.value ? smoothNdc : null)
    if (forced) pointing.value = true
    setGazeOverride(pointRay.value)
  }
}

if (import.meta.client) {
  // A handle for the shoot script / devtools: force a pointed spot without a hand.
  const w = window as unknown as Record<string, unknown>
  w.__voiceWorldTracking = {
    state: () => ({ enabled: enabled.value, status: status.value, yaw: yaw.value, pitch: pitch.value, pointing: pointing.value, pointRay: pointRay.value, error: error.value, camYaw: useWorld().renderer()?.yaw ?? 0, camPitch: useWorld().renderer()?.pitch ?? 0 }),
    point: (ndc: [number, number] | null) => {
      forced = ndc
      pointing.value = !!ndc
      pointRay.value = ndc
      setGazeOverride(ndc)
    }
  }
}

export function useHeadTracking() {
  return { enabled, status, error, yaw, pitch, pointing, pointRay, stream, frame, connections, enable, disable, toggle, recenter }
}
