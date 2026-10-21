# Bundled FFmpeg (optional)

Sotto can call a local `ffmpeg.exe` for audio transcoding and JPEG cover conversion.
Nothing in this folder is required for subtitle conversion, matching or renaming.

Layout expected by electron-builder and the app:

```text
resources/ffmpeg/
  x64/ffmpeg.exe
  x64/ffprobe.exe        (optional, used for progress/duration)
  ia32/ffmpeg.exe
  ia32/ffprobe.exe       (optional)
  README.md
```

Fetch both architectures with:

```powershell
npm run fetch:ffmpeg
```

The binaries are not committed to git (see `.gitignore`). When distributing a build,
include the corresponding license text and source link from ffmpeg.org, as described in
`THIRD_PARTY_NOTICES.md`.
