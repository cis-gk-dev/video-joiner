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
  const [status, setStatus] = useState('動画を2つ以上選択して開始してください。')
  const [progressMessage, setProgressMessage] = useState('')
  const [isLoadingFFmpeg, setIsLoadingFFmpeg] = useState(false)
  const [isJoining, setIsJoining] = useState(false)
  const [isFFmpegReady, setIsFFmpegReady] = useState(false)
  const [outputUrl, setOutputUrl] = useState<string | null>(null)

  const ffmpegRef = useRef<FFmpeg | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const ffmpegReadyPromiseRef = useRef<Promise<FFmpeg> | null>(null)

  useEffect(() => {
    return () => {
      if (outputUrl) {
        URL.revokeObjectURL(outputUrl)
      }
    }
  }, [outputUrl])

  // Load FFmpeg on mount
  useEffect(() => {
    let cancelled = false

    const loadFFmpeg = async (): Promise<FFmpeg> => {
      if (ffmpegRef.current) {
        // Check if already loaded by checking if it has the wasm module
        try {
          await ffmpegRef.current.loaded
          return ffmpegRef.current
        } catch {
          // Not loaded yet, continue
        }
      }

      if (!ffmpegRef.current) {
        const ffmpeg = new FFmpeg()
        ffmpeg.on('log', ({ message }) => {
          if (!cancelled) {
            setProgressMessage(message)
          }
        })
        ffmpegRef.current = ffmpeg
      }

      const ffmpeg = ffmpegRef.current
      setIsLoadingFFmpeg(true)
      setStatus('FFmpegコアをダウンロード中...')

      try {
        const [coreURL, wasmURL] = await Promise.all([
          toBlobURL(`${coreBaseURL}/ffmpeg-core.js`, 'text/javascript'),
          toBlobURL(`${coreBaseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        ])

        if (cancelled) throw new Error('Cancelled')

        await ffmpeg.load({ coreURL, wasmURL })

        if (cancelled) throw new Error('Cancelled')

        setIsFFmpegReady(true)
        setStatus('動画を2つ以上選択して開始してください。')
        setProgressMessage('')
        return ffmpeg
      } catch (error) {
        if (cancelled) throw new Error('Cancelled')
        console.error('Failed to load FFmpeg', error)
        setStatus('FFmpegコアの読み込みに失敗しました。')
        setProgressMessage((error as Error | undefined)?.message ?? '不明なエラー')
        throw error
      } finally {
        if (!cancelled) {
          setIsLoadingFFmpeg(false)
        }
      }
    }

    ffmpegReadyPromiseRef.current = loadFFmpeg()

    return () => {
      cancelled = true
    }
  }, [])

  const ensureFFmpeg = useCallback(async () => {
    if (ffmpegRef.current && isFFmpegReady) {
      return ffmpegRef.current
    }

    // If FFmpeg is still loading, wait for the promise
    if (ffmpegReadyPromiseRef.current) {
      return await ffmpegReadyPromiseRef.current
    }

    throw new Error('FFmpeg is not ready')
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

    setStatus('結合の準備ができました。必要に応じて順序を調整してください。')
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
    setStatus('動画を2つ以上選択して開始してください。')
    setProgressMessage('')
  }, [])

  const handleJoin = useCallback(async () => {
    if (clips.length < 2) {
      setStatus('結合するには少なくとも2つの動画を選択してください。')
      return
    }

    setIsJoining(true)
    setStatus('ファイルを準備中...')
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

      setStatus('動画を結合中...')

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
      setStatus('結合した動画の準備ができました！')
      setProgressMessage('下のプレビューまたはダウンロードから結合したファイルを確認できます。')

      // Clean up virtual FS to keep future runs simple
      await Promise.all([
        ...inputNames.map((name) => ffmpeg.deleteFile(name).catch(() => undefined)),
        ffmpeg.deleteFile('filelist.txt').catch(() => undefined),
        ffmpeg.deleteFile('output.mp4').catch(() => undefined),
      ])
    } catch (error) {
      console.error('Failed to join videos', error)
      setStatus('申し訳ございませんが、結合に失敗しました。')
      setProgressMessage(
        (error as Error | undefined)?.message ??
          'クリップが同じコーデック/サイズを共有していることを確認してください – FFmpeg concat with copyでは一致するストリームが必要です。',
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
        <h1>FFmpeg WASM 動画結合ツール</h1>
        <p>
          動画ファイルを追加し、順序を調整して、ブラウザ上でFFmpegが直接結合します。
          <strong>すべての動画は同じコーデック・解像度・フレームレートを共有している必要があります。</strong>
        </p>
      </header>

      <section className="uploader">
        <label className="file-picker">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            multiple
            onChange={handleFileSelection}
            aria-label="動画ファイルを追加"
          />
          <span>動画を選択</span>
        </label>
        <button type="button" className="ghost" onClick={clearAll} disabled={!clips.length || isJoining}>
          リストをクリア
        </button>
      </section>

      <section className="selection">
        <div className="section-heading">
          <h2>選択された動画</h2>
          {clips.length > 0 && <span>{clips.length} ファイル · {formatBytes(totalSize)}</span>}
        </div>

        {clips.length === 0 ? (
          <p className="empty-state">まだ動画がありません。「動画を選択」を使用してクリップを追加してください。</p>
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
                    aria-label={`${clip.file.name}を上に移動`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon"
                    onClick={() => moveClip(index, 1)}
                    disabled={index === clips.length - 1 || isJoining}
                    aria-label={`${clip.file.name}を下に移動`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => removeClip(clip.id)}
                    disabled={isJoining}
                  >
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="actions">
        <button type="button" className="primary" onClick={handleJoin} disabled={!canJoin}>
          {isJoining ? '結合中…' : '動画を結合'}
        </button>
        <div className="status">
          <p>{status}</p>
          {progressMessage && <p className="muted">{progressMessage}</p>}
        </div>
      </section>

      {outputUrl && (
        <section className="result">
          <h2>プレビューとダウンロード</h2>
          <video controls src={outputUrl} className="preview" />
          <a className="primary" href={outputUrl} download="joined-video.mp4">
            結合した動画をダウンロード
          </a>
        </section>
      )}

      <footer className="footnote">
        <p>
          動画はWebAssemblyを使用してブラウザ内でローカルに処理されます。最良の結果を得るには、クリップが同じ解像度とコーデックを共有していることを確認してください（concat demuxer with <code>-c copy</code>は一致するストリームを期待します）。
        </p>
      </footer>
    </div>
  )
}

export default App
