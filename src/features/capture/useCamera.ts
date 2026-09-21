import { useCallback, useEffect, useRef, useState } from 'react'

export type CameraStatus = 'idle' | 'starting' | 'live' | 'denied' | 'unavailable'

export type CameraState = {
  status: CameraStatus
  /** What the camera actually gave us, which is rarely what we asked for. */
  settings: { width: number; height: number } | null
  facing: 'environment' | 'user'
}

const IDEAL_WIDTH = 3840
const IDEAL_HEIGHT = 2160

/**
 * Owns the camera stream.
 *
 * Two iOS constraints shape this:
 *  - Only one getUserMedia stream may be live at a time, so the previous one
 *    is always stopped before a new one is requested.
 *  - `facingMode: { exact: ... }` throws OverconstrainedError on devices that
 *    cannot honour it, so we ask with `ideal` and read back what we got.
 */
export function useCamera(enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [state, setState] = useState<CameraState>({
    status: 'idle',
    settings: null,
    facing: 'environment',
  })

  const stop = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
  }, [])

  const start = useCallback(
    async (facing: 'environment' | 'user') => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState({ status: 'unavailable', settings: null, facing })
        return
      }

      stop()
      setState((prev) => ({ ...prev, status: 'starting', facing }))

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: IDEAL_WIDTH },
            height: { ideal: IDEAL_HEIGHT },
          },
          audio: false,
        })

        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          // iOS refuses to autoplay inline video without these.
          video.muted = true
          video.playsInline = true
          await video.play().catch(() => undefined)
        }

        const track = stream.getVideoTracks()[0]
        const settings = track?.getSettings()
        setState({
          status: 'live',
          settings:
            settings?.width && settings.height
              ? { width: settings.width, height: settings.height }
              : null,
          facing,
        })
      } catch (error) {
        const denied =
          error instanceof DOMException &&
          (error.name === 'NotAllowedError' || error.name === 'SecurityError')
        setState({ status: denied ? 'denied' : 'unavailable', settings: null, facing })
      }
    },
    [stop],
  )

  useEffect(() => {
    if (!enabled) {
      stop()
      return
    }

    // The camera is the external system this effect exists to synchronise
    // with; `start` reports its progress through state after awaiting it.
    // oxlint-disable-next-line react/set-state-in-effect
    void start('environment')
    return stop
    // `start` is stable and intentionally not re-run when facing changes;
    // flipping the camera goes through `flip` below.
  }, [enabled, start, stop])

  const flip = useCallback(() => {
    void start(state.facing === 'environment' ? 'user' : 'environment')
  }, [start, state.facing])

  return { videoRef, ...state, flip, retry: () => void start(state.facing) }
}
