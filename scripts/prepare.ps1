# Prepares the build environment: Node runtime + server dependency tree.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# 1. Bundled Node 22 runtime (must match the version dsh is tested with).
if (!(Test-Path "$root\runtime\node\node.exe")) {
  New-Item -ItemType Directory -Force -Path "$root\runtime\node" | Out-Null
  $zip = "$root\runtime\node-runtime.zip"
  Write-Host 'Downloading Node 22.22.0 runtime...'
  Invoke-WebRequest 'https://npmmirror.com/mirrors/node/v22.22.0/node-v22.22.0-win-x64.zip' -OutFile $zip
  Expand-Archive $zip "$root\runtime\tmp" -Force
  Copy-Item "$root\runtime\tmp\node-v22.22.0-win-x64\node.exe" "$root\runtime\node\node.exe"
  Remove-Item "$root\runtime\tmp", $zip -Recurse -Force
  Write-Host 'Node runtime ready.'
}

# 2. Server dependencies. The tree is renamed to dsh-modules because
#    electron-builder's extraResources copy silently drops any source
#    directory named node_modules.
Push-Location "$root\server"
npm install
Pop-Location
if (Test-Path "$root\server\node_modules") {
  if (Test-Path "$root\server\dsh-modules") {
    Remove-Item "$root\server\dsh-modules" -Recurse -Force
  }
  Rename-Item "$root\server\node_modules" 'dsh-modules'
  Write-Host 'Server tree ready (node_modules -> dsh-modules).'
}
