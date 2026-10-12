$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) {
  throw 'Run the installer smoke only on a disposable Windows CI VM.'
}
$taskCandidates = @(Get-ChildItem -LiteralPath 'apps/desktop/src-tauri/target/release/bundle/nsis' -Filter 'Clawdash_*_x64-setup.exe')
if ($taskCandidates.Count -ne 1) { throw 'Expected one newly built Clawdash installer.' }
$taskTempBase = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $env:RUNNER_TEMP ('clawdash-install-' + [guid]::NewGuid().ToString('N'))))
if (-not $taskRoot.StartsWith($taskTempBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture path.' }
$taskInstall = Join-Path $taskRoot 'app'
$taskProfile = Join-Path $taskRoot 'profile'
$taskRuntime = Join-Path $taskRoot 'runtime'
New-Item -ItemType Directory -Force (Join-Path $taskProfile '.claude') | Out-Null
$taskSettings = Join-Path $taskProfile '.claude/settings.json'
$taskOriginal = '{"theme":"fixture","hooks":{"Stop":[{"hooks":[{"type":"command","command":"unrelated-fixture-hook"}]}]}}'
[IO.File]::WriteAllText($taskSettings, $taskOriginal)
$taskPriorProfile = $env:USERPROFILE
$taskPriorRuntime = $env:CLAWDASH_HOME
$taskPriorExe = $env:CLAWDASH_NATIVE_EXE
$taskDebugPolicy = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments'
# Elevated hosted runners ignore WEBVIEW2_* debugging variables. Scope the documented
# machine policy to this disposable VM's installed test executable, and remove it below.
# https://github.com/MicrosoftEdge/WebView2Feedback/issues/5645
if (Get-ItemProperty -LiteralPath $taskDebugPolicy -Name 'clawdash.exe' -ErrorAction SilentlyContinue) {
  throw 'Refusing to overwrite existing WebView2 test policy.'
}
try {
  $taskInstaller = Start-Process -FilePath $taskCandidates[0].FullName -ArgumentList @('/S', ('/D=' + $taskInstall)) -WindowStyle Hidden -Wait -PassThru
  if ($taskInstaller.ExitCode -notin @(0, 3010)) { throw ('Installer failed: ' + $taskInstaller.ExitCode) }
  $taskExe = Join-Path $taskInstall 'clawdash.exe'
  $taskCli = Join-Path $taskInstall 'clawdash-cli.exe'
  if (-not (Test-Path -LiteralPath $taskExe) -or -not (Test-Path -LiteralPath $taskCli)) { throw 'Installed executables missing.' }
  $env:CLAWDASH_NATIVE_EXE = $taskExe
  New-Item -Path $taskDebugPolicy -Force | Out-Null
  New-ItemProperty -LiteralPath $taskDebugPolicy -Name 'clawdash.exe' -Value '--remote-debugging-port=47932' -PropertyType String -Force | Out-Null
  node scripts/smoke-desktop.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Installed native lifecycle failed.' }
  $env:USERPROFILE = $taskProfile
  $env:CLAWDASH_HOME = $taskRuntime
  & $taskCli integrations install claude
  if ($LASTEXITCODE -ne 0) { throw 'Installed hook CLI failed.' }
  $taskSave = (& $taskCli storage-load) -join "`n"
  $taskSave | & $taskCli storage-save | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Installed save CLI failed.' }
  $taskUninstallers = @(Get-ChildItem -LiteralPath $taskInstall -Filter 'uninstall*.exe')
  if ($taskUninstallers.Count -ne 1) { throw 'Installed uninstaller missing.' }
  $taskUninstall = Start-Process -FilePath $taskUninstallers[0].FullName -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
  if ($taskUninstall.ExitCode -ne 0) { throw 'Uninstaller failed.' }
  for ($taskAttempt = 0; $taskAttempt -lt 40 -and (Test-Path -LiteralPath $taskExe); $taskAttempt++) { Start-Sleep -Milliseconds 250 }
  if (Test-Path -LiteralPath $taskExe) { throw 'Uninstaller left the application executable.' }
  $taskAfter = (Get-Content -LiteralPath $taskSettings -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 30 -Compress)
  $taskExpected = ($taskOriginal | ConvertFrom-Json | ConvertTo-Json -Depth 30 -Compress)
  if ($taskAfter -ne $taskExpected) { throw 'Uninstaller did not preserve unrelated Claude settings.' }
  if (-not (Test-Path -LiteralPath (Join-Path $taskRuntime 'game-save.json'))) { throw 'Uninstaller removed progress.' }
  Write-Output 'Actual per-user NSIS install, installed native no-Node-PATH lifecycle, owned-hook removal and progress-preserving uninstall pass.'
} finally {
  Remove-ItemProperty -LiteralPath $taskDebugPolicy -Name 'clawdash.exe' -ErrorAction SilentlyContinue
  $env:USERPROFILE = $taskPriorProfile
  $env:CLAWDASH_HOME = $taskPriorRuntime
  $env:CLAWDASH_NATIVE_EXE = $taskPriorExe
  # This directory is a newly created fixture inside RUNNER_TEMP, never user data.
  if ([IO.Path]::GetFullPath($taskRoot).StartsWith($taskTempBase, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $taskRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
