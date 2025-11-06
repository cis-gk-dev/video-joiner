# FFmpeg WASM Video Joiner

A lightweight browser-based utility that merges multiple videos using [`@ffmpeg/ffmpeg`](https://github.com/ffmpegwasm/ffmpeg.wasm). Select your clips, reorder them, and create a single output file – everything runs locally in the browser with no uploads required.

## Features

- Client-side video concatenation powered by FFmpeg WebAssembly
- Drag-free reordering via simple move up/down controls
- Live status updates while FFmpeg loads and processes
- Preview player and direct download link for the merged video

## Getting Started

### Prerequisites

- Node.js 18+

### Installation

```bash
npm install
```

### Run the development server

```bash
npm run dev
```

Open the printed URL (defaults to `http://localhost:5173`) to use the app.

## Usage

1. Click **Select videos** and choose at least two video files (they stay on your device).
2. Reorder clips with the ↑/↓ buttons until the sequence matches what you need.
3. Press **Join videos** to launch FFmpeg in the browser.
4. When finished, preview the merged clip or download it as `joined-video.mp4`.

## Notes & Limitations

- The concat operation uses `-c copy`, so inputs must share the same codec, resolution, and bitrate profile. If FFmpeg reports mismatched streams, transcode the files first or align their settings.
- Large files can take time to load into memory because everything happens locally.
- Works best in Chromium-based browsers with WebAssembly SIMD support.

## Tech Stack

- React + TypeScript + Vite
- `@ffmpeg/ffmpeg` & `@ffmpeg/util`
