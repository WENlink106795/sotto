<p align="right"><strong>English</strong> · <a href="README.md">简体中文</a></p>

# Sotto · 耳畔

[![CI](https://github.com/WENlink106795/sotto/actions/workflows/ci.yml/badge.svg)](https://github.com/WENlink106795/sotto/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/WENlink106795/sotto)](https://github.com/WENlink106795/sotto/releases)
[![License](https://img.shields.io/github/license/WENlink106795/sotto)](LICENSE)

> Turn an ASMR collection into something your player actually understands.

Sotto is a **local-first Windows library organizer for ASMR / voice works**. It converts downloaded VTT/SRT subtitles into LRC files that hardware players can read, aligns audio and subtitle filenames, picks and normalizes cover images, and can optionally transcode large WAV / FLAC files to MP3 or M4A.

The UI ships with three themes — **Fluent**, **Material You**, and **Studio** — with configurable accent color, corner radius, and density. Everything runs on your machine; no files are uploaded.

<p align="center">
  <img src="docs/screenshots/workspace-fluent-dark.png" width="49%" alt="Fluent workspace" />
  <img src="docs/screenshots/workspace-material-light.png" width="49%" alt="Material You workspace" />
</p>
<p align="center">
  <img src="docs/screenshots/workspace-studio-dark.png" width="49%" alt="Studio workspace" />
  <img src="docs/screenshots/settings-fluent-dark.png" width="49%" alt="Appearance settings" />
</p>

## Features

- **VTT / SRT / TXT → LRC** — handles cue tags, HTML entities, NOTE/STYLE blocks, out-of-order and overlapping cues. It also recognizes files whose extension is `.txt` but whose content is actually WebVTT, SRT, or LRC. Output can be UTF-8, UTF-8 with BOM, or GB18030 for picky car stereos and players. Plain scripts and readmes are rejected by content detection.
- **Real-world download naming** — supports double-extension subtitles such as `track.mp3.vtt`, matches them by the name after removing the media suffix, and renames the source subtitle to `track.vtt`.
- **Strict filename alignment** — audio, generated LRC, and retained source VTT/SRT all share the exact same basename. Source subtitles are renamed in place inside the atomic working directory, so subtitle folders are not emptied. Emoji, unsupported symbols, and Windows-illegal characters are removed with a preview of exactly what changed.
- **Smart pairing** — exact, normalized, and fuzzy matching in the same folder, plus cross-folder matching (for example `work/subtitles/xxx.vtt`). Low-confidence matches are explicitly flagged; unmatched files are listed separately for review.
- **Cover selection** — scans images in the work folder and its subfolders, then renames the chosen image to `cover.jpg` (or folder/front/album/封面), converting to JPEG with ffmpeg when needed. Batch mode can auto-pick a clearly named cover and refuses to guess when many candidates exist.
- **Optional audio transcoding** — WAV / FLAC / APE / AIFF / ALAC / WMA → MP3 (libmp3lame) or M4A (AAC), preserving metadata and optionally moving originals to the Recycle Bin.
- **Safe by design** — build a complete plan before touching files; two-phase renames avoid collisions; run history, journal, and one-click undo; deletions go to the Recycle Bin by default.
- **Batch mode** — drag an entire `[ASMR]` root folder in, use current settings as a preset, then auto-pair, normalize names, convert subtitles, and optionally transcode or pick covers before one click on **Apply**.
- **Local-first** — no account, no telemetry, no network requests. Settings and logs live only in `%APPDATA%\Sotto`.

## Themes

| Fluent / UWP (default) | Material You | Studio |
| --- | --- | --- |
| Layered translucency, fine strokes, Windows 11 feel | Accent-derived tonal containers, large radii, more whitespace | Near-black high contrast, tabular numerals, restrained glow |

All themes support light, dark, and system mode. Accent colors come from presets or a color picker. See [docs/DESIGN.md](docs/DESIGN.md) (Chinese).

## Download

Release binaries are published **only on GitHub Releases**. The source repository never commits exe files, signing private keys, or ffmpeg binaries:

- [Latest release](https://github.com/WENlink106795/sotto/releases/latest)
- Assets: x64 / ia32 NSIS installers and portable builds, plus `SHA256SUMS.txt`
- Current builds use a local self-signed certificate. Other machines must import the public certificate to trust them; a CA-issued certificate is recommended for public distribution. See [docs/SIGNING.md](docs/SIGNING.md) (Chinese).

## Development quick start

Requirements: Windows 10/11, Node.js 20+, npm 10+.

```powershell
npm install
npm run dev          # Electron + Vite development mode
npm test             # core engine unit tests
npm run typecheck    # main + renderer type checks
npm run build        # production build
npm run screenshots  # generate UI screenshots from demo data into screenshots/
```

Render only the UI in a browser with demo data (no Electron):

```powershell
npm run dev:web      # http://localhost:5174
```

## Packaging

```powershell
npm run fetch:ffmpeg -- --arch x64    # download ffmpeg into resources/ffmpeg
npm run fetch:ffmpeg -- --arch ia32   # compatible ffmpeg for 32-bit builds
npm run pack:win                      # electron-builder: NSIS + portable
```

- The 64-bit installer is recommended; an **ia32 (32-bit)** build is also provided for older devices. Electron is pinned to 34.x because later versions no longer publish Windows 32-bit binaries.
- The signed v0.1.0 release includes `Sotto-Setup-0.1.0-x64.exe` / `Sotto-Setup-0.1.0-ia32.exe` and `Sotto-0.1.0-x64-portable.exe` / `Sotto-0.1.0-ia32-portable.exe`; checksums are in `SHA256SUMS.txt` on the release page.
- These builds use a local self-signed certificate (valid on the build machine via `Get-AuthenticodeSignature`; Defender found no threats there). Other machines need `build/signing/sotto-selfsigned.cer` to trust them. Use a CA certificate for public releases; see [docs/SIGNING.md](docs/SIGNING.md) (Chinese).
- Without a bundled ffmpeg, subtitle conversion, naming, and cover renaming still work. Audio transcoding and image-to-JPEG conversion require an `ffmpeg.exe` configured in Settings.
- Licensing for release builds and ffmpeg is covered in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Security

- The repository contains no tokens, passwords, private keys, PFX files, or real user data.
- `.gitignore` excludes `build/signing/`, `*.pfx`, `*.key`, `*.env`, `release/`, `resources/ffmpeg/*`, and similar artifacts.
- Release executables are uploaded only to GitHub Releases and never enter git history.
- The app has no account system, telemetry, or network requests; all file processing is local.

## Project layout

```text
src/
  main/             Electron main process (windows, IPC, image protocol)
    core/           scan, pairing, plan, subtitle, ffmpeg, apply/undo
  preload/          typed contextBridge API
  renderer/         React + Tailwind UI (three themes + demo bridge)
  shared/           types, defaults, filename sanitizer, IPC contract
tests/core/         core engine unit tests
docs/               architecture, design, user guide, screenshots
scripts/            icons, screenshots, ffmpeg fetcher, demo library
```

More: [architecture](docs/ARCHITECTURE.md) · [user guide](docs/USER_GUIDE.md) · [design](docs/DESIGN.md) · [roadmap](docs/ROADMAP.md). These documents are currently in Chinese.

## Ideas and roadmap

Already shipped: fuzzy pairing, filename-diff visualization, subtitle encoding choice, plan preview and undo, Recycle Bin deletion, theme customization, run history, and an offline demo mode. More candidates are in [docs/ROADMAP.md](docs/ROADMAP.md), including embedded cover art, bilingual subtitle merging, folder watching, and a CLI mode.

## License

Application code is released under [MIT](LICENSE). Third-party components and optional ffmpeg binaries keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
