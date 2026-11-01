# ClipForge Studio

ClipForge Studio is a portable Windows app for turning a video into a short-form edit. It scans the clip on the device for motion changes and audio peaks, suggests short cuts, and lets you trim, frame, preview, and export the result as WebM.

The scan is a creative heuristic. It does not check live social trends or predict views. Video analysis and rendering happen on the device.

## Put it on GitHub

1. Create a GitHub repository named `ClipForge-Studio`. Make it **public** if friends should be able to download the app without signing in.
2. On the repository page, choose **Add file → Upload files**. Drag in the contents of this folder, including the `.github` folder, and commit them.
3. Open **Releases → Draft a new release**, create the tag `v1.0.0`, and publish the release. The included GitHub Actions workflow will build the Windows executable and attach it to that release. You can also push a `v*` tag to trigger the same workflow.
4. When the workflow finishes, send friends this stable download link, replacing `YOUR-GITHUB-USERNAME` with your GitHub name:

   `https://github.com/YOUR-GITHUB-USERNAME/ClipForge-Studio/releases/latest/download/ClipForge-Studio-Portable.exe`

The source repository intentionally does not contain the roughly 105 MiB executable. GitHub limits regular repository files to 100 MiB; release assets support files up to 2 GiB, so the workflow attaches the `.exe` to a Release instead.

## Build it locally

On Windows with Node.js 24 installed:

```powershell
npm ci
New-Item -ItemType Directory -Path ".electron-cache" -Force | Out-Null
$env:electron_config_cache = (Resolve-Path ".electron-cache").Path
node "node_modules/electron/install.js"
npm run package:windows
```

The portable `.exe` is written to `release/`. It does not require installation. The executable is unsigned, so Windows may show a SmartScreen publisher warning.
