import type { ChangeEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import './App.css'

type Clip = {
  id: string
  file: File
}

const coreBaseURL = 'https://unpkg.com/@ffmpeg/core@0.12.5/dist/esm'

const createId = () =>
  typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

function App() {
  const [clips, setClips] = useState<Clip[]>([])
  const [status, setStatus] = useState('Pick two or more videos to get started.')
  const [progressMessage, setProgressMessage] = useState('')
  const [isLoadingFFmpeg, setIsLoadingFFmpeg] = useState(false)
  const [isJoining, setIsJoining] = useState(false)
  const [isFFmpegReady, setIsFFmpegReady] = useState(false)
  const [outputUrl, setOutputUrl] = useState<string | null>(null)

  const ffmpegRef = useRef<FFmpeg | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    return () => {
      if (outputUrl) {
        URL.revokeObjectURL(outputUrl)
      }
    }
  }, [outputUrl])

  const ensureFFmpeg = useCallback(async () => {
    if (ffmpegRef.current && isFFmpegReady) {
      return ffmpegRef.current
    }

    if (!ffmpegRef.current) {
      const ffmpeg = new FFmpeg()
      ffmpeg.on('log', ({ message }) => {
        setProgressMessage(message)
      })
      ffmpegRef.current = ffmpeg
    }

    const ffmpeg = ffmpegRef.current
    setIsLoadingFFmpeg(true)
    setStatus('Downloading FFmpeg core...')

    try {
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${coreBaseURL}/ffmpeg-core.js`, 'text/javascript'),
        toBlobURL(`${coreBaseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      ])

      await ffmpeg.load({ coreURL, wasmURL })

      setIsFFmpegReady(true)
      setStatus('FFmpeg ready.')
      setProgressMessage('')

      return ffmpeg
    } catch (error) {
      console.error('Failed to load FFmpeg', error)
      setStatus('Failed to load FFmpeg core.')
      setProgressMessage((error as Error | undefined)?.message ?? 'Unknown error')
      throw error
    } finally {
      setIsLoadingFFmpeg(false)
    }
  }, [isFFmpegReady])

  const handleFileSelection = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files ? Array.from(event.target.files) : []
    if (!selected.length) return

    setClips((prev) => [
      ...prev,
      ...selected.map((file) => ({
        id: createId(),
        file,
      })),
    ])

    setStatus('Ready to join. Adjust the order if needed.')
    setProgressMessage('')

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  const removeClip = useCallback((id: string) => {
    setClips((prev) => prev.filter((clip) => clip.id !== id))
  }, [])

  const moveClip = useCallback((index: number, delta: number) => {
    setClips((prev) => {
      const next = [...prev]
      const targetIndex = index + delta
      if (targetIndex < 0 || targetIndex >= next.length) {
        return prev
      }
      const [item] = next.splice(index, 1)
      next.splice(targetIndex, 0, item)
      return next
    })
  }, [])

  const clearAll = useCallback(() => {
    setClips([])
    setStatus('Pick two or more videos to get started.')
    setProgressMessage('')
  }, [])

  const handleJoin = useCallback(async () => {
    if (clips.length < 2) {
      setStatus('Select at least two videos to join.')
      return
    }

    setIsJoining(true)
    setStatus('Preparing files...')
    setProgressMessage('')

    if (outputUrl) {
      URL.revokeObjectURL(outputUrl)
      setOutputUrl(null)
    }

    try {
      const ffmpeg = await ensureFFmpeg()
      const inputNames: string[] = []

      // Clean up any leftovers
      await ffmpeg.deleteFile('filelist.txt').catch(() => undefined)
      await ffmpeg.deleteFile('output.mp4').catch(() => undefined)

      for (const [index, clip] of clips.entries()) {
        const ext = clip.file.name.split('.').pop() ?? 'mp4'
        const inputName = `clip-${index}.${ext}`
        inputNames.push(inputName)
        await ffmpeg.writeFile(inputName, await fetchFile(clip.file))
      }

      const concatList = inputNames.map((name) => `file '${name}'`).join('\n')
      const listData = new TextEncoder().encode(concatList)
      await ffmpeg.writeFile('filelist.txt', listData)

      setStatus('Joining videos...')

      await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'filelist.txt', '-c', 'copy', 'output.mp4'])

      const outputData = await ffmpeg.readFile('output.mp4')
      if (!(outputData instanceof Uint8Array)) {
        throw new Error('Unexpected FFmpeg output format.')
      }
      const videoBytes = new Uint8Array(outputData.length)
      videoBytes.set(outputData)
      const blob = new Blob([videoBytes.buffer], { type: 'video/mp4' })
      const url = URL.createObjectURL(blob)

      setOutputUrl(url)
      setStatus('Combined video ready!')
      setProgressMessage('You can preview or download the merged file below.')

      // Clean up virtual FS to keep future runs simple
      await Promise.all([
        ...inputNames.map((name) => ffmpeg.deleteFile(name).catch(() => undefined)),
        ffmpeg.deleteFile('filelist.txt').catch(() => undefined),
        ffmpeg.deleteFile('output.mp4').catch(() => undefined),
      ])
    } catch (error) {
      console.error('Failed to join videos', error)
      setStatus('Sorry, the join failed.')
      setProgressMessage(
        (error as Error | undefined)?.message ??
          'Check that the clips share the same codec/size – FFmpeg concat with copy requires matching streams.',
      )
    } finally {
      setIsJoining(false)
    }
  }, [clips, ensureFFmpeg, outputUrl])

  const totalSize = useMemo(() => clips.reduce((acc, clip) => acc + clip.file.size, 0), [clips])
  const canJoin = clips.length >= 2 && !isJoining && !isLoadingFFmpeg

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>FFmpeg WASM Video Joiner</h1>
        <p>Drop in your clips, arrange the order, and let FFmpeg merge them directly in your browser.</p>
      </header>

      <section className="uploader">
        <label className="file-picker">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            multiple
            onChange={handleFileSelection}
            aria-label="Add video files"
          />
          <span>Select videos</span>
        </label>
        <button type="button" className="ghost" onClick={clearAll} disabled={!clips.length || isJoining}>
          Clear list
        </button>
      </section>

      <section className="selection">
        <div className="section-heading">
          <h2>Selected clips</h2>
          {clips.length > 0 && <span>{clips.length} files · {formatBytes(totalSize)}</span>}
        </div>

        {clips.length === 0 ? (
          <p className="empty-state">No videos yet. Use "Select videos" to add your clips.</p>
        ) : (
          <ol className="clip-list">
            {clips.map((clip, index) => (
              <li key={clip.id} className="clip-row">
                <div className="clip-info">
                  <span className="clip-index">{index + 1}</span>
                  <div className="clip-meta">
                    <strong>{clip.file.name}</strong>
                    <span>{formatBytes(clip.file.size)}</span>
                  </div>
                </div>
                <div className="clip-actions">
                  <button
                    type="button"
                    className="icon"
                    onClick={() => moveClip(index, -1)}
                    disabled={index === 0 || isJoining}
                    aria-label={`Move ${clip.file.name} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon"
                    onClick={() => moveClip(index, 1)}
                    disabled={index === clips.length - 1 || isJoining}
                    aria-label={`Move ${clip.file.name} down`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => removeClip(clip.id)}
                    disabled={isJoining}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="actions">
        <button type="button" className="primary" onClick={handleJoin} disabled={!canJoin}>
          {isLoadingFFmpeg ? 'Loading FFmpeg…' : isJoining ? 'Joining…' : 'Join videos'}
        </button>
        <div className="status">
          <p>{status}</p>
          {progressMessage && <p className="muted">{progressMessage}</p>}
        </div>
      </section>

      {outputUrl && (
        <section className="result">
          <h2>Preview & download</h2>
          <video controls src={outputUrl} className="preview" />
          <a className="primary" href={outputUrl} download="joined-video.mp4">
            Download merged video
          </a>
        </section>
      )}

      <footer className="footnote">
        <p>
          Videos are processed locally in your browser using WebAssembly. For best results ensure the clips share the
          same resolution and codec (the concat demuxer with <code>-c copy</code> expects matching streams).
        </p>
      </footer>
    </div>
  )
}

export default App
