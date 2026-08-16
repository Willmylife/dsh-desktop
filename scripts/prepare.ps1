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
#    directory named node_modules. A junction restores the literal
#    node_modules name alongside it: Node's module resolution only walks
#    into directories actually named node_modules, so dev mode needs it.
$nm = "$root\server\node_modules"
$dm = "$root\server\dsh-modules"
# Drop a stale junction from a previous run so npm installs into a real dir.
if (Test-Path $nm) {
  $item = Get-Item $nm -Force
  if ($item.LinkType -eq 'Junction') { $item.Delete() }
}
Push-Location "$root\server"
npm install
Pop-Location
if ((Test-Path $nm) -and (-not (Test-Path $dm))) {
  Rename-Item $nm 'dsh-modules'
}
if ((Test-Path $dm) -and (-not (Test-Path $nm))) {
  cmd /c mklink /J "$nm" "$dm" | Out-Null
}
Write-Host 'Server tree ready (dsh-modules + node_modules junction).'
