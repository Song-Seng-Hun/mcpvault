param(
  [Parameter(Mandatory=$true)][string]$ConfigPath,
  [string]$DiagnosticHost,
  [string]$ConsoleDebugger
)
# Operator-only, data-free --check under the same native sandbox restrictions.
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 required' }
function Assert-NoReparsePath([string]$path) {
  for ($cursor = [IO.Path]::GetFullPath($path); $cursor; $cursor = Split-Path -Parent $cursor) {
    if (Test-Path -LiteralPath $cursor) {
      if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse path rejected' }
    }
    if ($cursor -eq [IO.Path]::GetPathRoot($cursor)) { break }
  }
}
Assert-NoReparsePath $ConfigPath
$c = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$boundary = [IO.Path]::GetFullPath($c.boundaryRoot).TrimEnd('\')
if ($boundary -notmatch '^[A-Za-z]:\\.+\\pdf-host-v\d+$') { throw 'Dedicated PDF host boundary required' }
foreach ($path in @($boundary, (Join-Path $boundary 'jobs'), $c.sandboxHost, $c.aclHelper, $c.powershell)) { Assert-NoReparsePath $path }
if ([bool]$DiagnosticHost -ne [bool]$ConsoleDebugger) { throw 'Diagnostic host and debugger must be supplied together' }
if ($DiagnosticHost) {
  if ([IO.Path]::GetFullPath($DiagnosticHost) -ne (Join-Path $boundary 'pdf-appcontainer-debug-host.exe')) { throw 'Invalid diagnostic host' }
  Assert-NoReparsePath $DiagnosticHost; Assert-NoReparsePath $ConsoleDebugger
  $signature = Get-AuthenticodeSignature -LiteralPath $ConsoleDebugger
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'CN=Microsoft Corporation(?:,|$)') { throw 'Signed Microsoft debugger required' }
  # WMI ExecutablePath can be empty before the loader initializes. Query the
  # kernel image path by limited-information handle; never waive identity checks.
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public sealed class PdfDiagnosticImage : IDisposable {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder path, ref int length);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  IntPtr handle;
  public PdfDiagnosticImage(uint pid) {
    handle = OpenProcess(0x101000, false, pid);
    if (handle == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
  public string Path() {
      var path = new StringBuilder(32768); int length = path.Capacity;
      if (!QueryFullProcessImageNameW(handle, 0, path, ref length)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      return path.ToString();
  }
  public bool Exited(uint milliseconds) { return WaitForSingleObject(handle, milliseconds) == 0; }
  public void Dispose() { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }
}
'@
}
$lockPath = Join-Path $boundary 'provider.lock'
$lock = [IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
$id = [guid]::NewGuid().ToString('N')
$profile = 'mcpvault-pdf-v1-' + $id
$job = Join-Path $boundary ('jobs\job-' + $id)
$ledger = [Text.Encoding]::UTF8.GetBytes((@{version=1;profile=$profile;job=$job;pid=$PID} | ConvertTo-Json -Compress))
$lock.Write($ledger,0,$ledger.Length)
$lock.Flush($true)
$created = $false; $touched = $false; $clean = $true; $containerSid = ''; $diagnosticExitUnconfirmed = $false
try {
  $null = New-Item -ItemType Directory -Path $job
  $created = $true
  $creation = & $c.sandboxHost --profile $profile --create-profile
  if ($LASTEXITCODE -ne 0) { throw 'profile creation failed' }
  $planText = & $c.sandboxHost --profile $profile --provision-job $job
  if ($LASTEXITCODE -ne 0) { throw 'profile plan failed' }
  $plan = $planText | ConvertFrom-Json
  if ($plan.profile -ne $profile -or $plan.applied -ne $false -or $plan.roots.Count -ne 1 -or $plan.roots[0].path -ne $job -or $plan.containerSid -notmatch '^S-1-15-2-(\d+-){6}\d+$') { throw 'invalid plan' }
  $containerSid = $plan.containerSid
  & $c.powershell -NoLogo -NoProfile -NonInteractive -File $c.aclHelper -Kind job -BoundaryRoot $boundary -Root $job -ContainerSid $containerSid
  if ($LASTEXITCODE -ne 0) { throw 'job ACL failed' }
  $touched = $true
  & $c.powershell -NoLogo -NoProfile -NonInteractive -File $c.aclHelper -Kind runtime -BoundaryRoot $boundary -Root (Join-Path $boundary 'runtime') -ContainerSid $containerSid
  if ($LASTEXITCODE -ne 0) { throw 'runtime ACL failed' }
  $workerArgs = @('--profile', $profile, '--python', $c.python, '--worker', $c.worker, '--runtime-root', (Join-Path $boundary 'runtime'), '--job-dir', $job, '--max-memory-mb', '1024', '--timeout-seconds', '120', '--', '--check')
  if (-not $DiagnosticHost) {
    & $c.sandboxHost @workerArgs
    $workerCode = $LASTEXITCODE
  } else {
    # Only the data-free child PID emitted AFTER token/Job verification is eligible.
    # No process-name attachment, registry/IFEO edits, kernel/system trace or dumps.
    $debugDir = Join-Path $boundary ('diagnostic-' + $id)
    $null = New-Item -ItemType Directory -Path $debugDir
    $brokerInfo = [Diagnostics.ProcessStartInfo]::new($DiagnosticHost)
    $brokerInfo.UseShellExecute = $false; $brokerInfo.CreateNoWindow = $true
    $brokerInfo.RedirectStandardOutput = $true; $brokerInfo.RedirectStandardError = $true
    foreach ($arg in $workerArgs) { $brokerInfo.ArgumentList.Add($arg) }
    $broker = [Diagnostics.Process]::Start($brokerInfo)
    $debugger = $null; $heldChild = $null
    try {
      $brokerOutput = $broker.StandardOutput.ReadToEndAsync()
      $lineTask = $broker.StandardError.ReadLineAsync()
      if (-not $lineTask.Wait(65000) -or $lineTask.Result -notmatch '^pdf_debug_pid_(\d+)$') { throw 'Verified diagnostic child PID missing' }
      $childId = [int]$Matches[1]
      $brokerError = $broker.StandardError.ReadToEndAsync()
      $heldChild = [PdfDiagnosticImage]::new($childId)
      $child = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $childId)
      $imagePath = $heldChild.Path()
      if ($child.ParentProcessId -ne $broker.Id -or $imagePath -ne [IO.Path]::GetFullPath($c.python)) {
        Write-Output (@{ diagnosticIdentity = @{ pid = $childId; found = ($null -ne $child); expectedParent = $broker.Id; actualParent = $child.ParentProcessId; pathAvailable = [bool]$imagePath; pathMatches = ($imagePath -eq [IO.Path]::GetFullPath($c.python)) } } | ConvertTo-Json -Compress)
        throw 'Diagnostic child identity mismatch'
      }
      $debugInfo = [Diagnostics.ProcessStartInfo]::new($ConsoleDebugger)
      $debugInfo.UseShellExecute = $false; $debugInfo.CreateNoWindow = $true
      $debugInfo.RedirectStandardInput = $true; $debugInfo.RedirectStandardOutput = $true; $debugInfo.RedirectStandardError = $true
      # Explicit Microsoft public OS symbols only; no source-server requests or
      # PDF input. The parser's OS network denial is unchanged.
      $symbolCache = Join-Path $boundary 'debug-symbols'
      Assert-NoReparsePath $symbolCache
      $commandFile = Join-Path $PSScriptRoot 'pdf-loader-diagnostic.cdb'
      Assert-NoReparsePath $commandFile
      foreach ($arg in @('-p', [string]$childId, '-pr', '-g', '-xe', 'ld', '-sins', '-noshell', '-nosqm', '-y', ('srv*' + $symbolCache + '*https://msdl.microsoft.com/download/symbols'), '-logo', (Join-Path $debugDir 'loader.log'), '-cf', $commandFile)) { $debugInfo.ArgumentList.Add($arg) }
      if ($heldChild.Exited(0)) { throw 'Diagnostic child already exited' }
      $debugger = [Diagnostics.Process]::Start($debugInfo)
      $debugger.StandardInput.Close()
      $debugOutput = $debugger.StandardOutput.ReadToEndAsync(); $debugError = $debugger.StandardError.ReadToEndAsync()
      if (-not $broker.WaitForExit(125000)) { throw 'Diagnostic broker deadline' }
      $workerCode = $broker.ExitCode
      if (-not $debugger.WaitForExit(10000)) { throw 'Diagnostic debugger deadline' }
      $null = $brokerOutput.GetAwaiter().GetResult(); $null = $debugOutput.GetAwaiter().GetResult(); $null = $debugError.GetAwaiter().GetResult()
      $hostDiagnostic = $brokerError.GetAwaiter().GetResult().Trim()
      if ($hostDiagnostic -match '^[a-z0-9_\r\n]{1,200}$') { Write-Output ('brokerDiagnostic=' + $hostDiagnostic) }
      Write-Output ('diagnosticLog=' + (Join-Path $debugDir 'loader.log'))
      Write-Output ('diagnosticChildPid=' + $childId)
    } finally {
      foreach ($owned in @($debugger,$broker)) {
        if ($null -ne $owned -and -not $owned.HasExited) {
          try {
            $owned.Kill()
            if (-not $owned.WaitForExit(10000)) { throw 'Diagnostic exit unconfirmed; retain recovery state' }
          } catch { $diagnosticExitUnconfirmed = $true; throw }
        }
      }
      if ($null -ne $heldChild) {
        if (-not $heldChild.Exited(10000)) { $diagnosticExitUnconfirmed = $true; throw 'Diagnostic child exit unconfirmed; retain recovery state' }
        $heldChild.Dispose()
      }
    }
  }
  Write-Output ('sandboxCheckExit=' + $workerCode)
} finally {
  if ($diagnosticExitUnconfirmed) {
    $lock.Dispose()
    throw 'Diagnostic exit unconfirmed; no cleanup attempted; retained ledger requires recovery'
  }
  if ($created) {
    & $c.sandboxHost --profile $profile --delete-profile
    if ($LASTEXITCODE -ne 0) { $clean = $false }
  }
  if ($touched) {
    & $c.powershell -NoLogo -NoProfile -NonInteractive -File $c.aclHelper -Operation revoke -Kind runtime -BoundaryRoot $boundary -Root (Join-Path $boundary 'runtime') -ContainerSid $containerSid
    if ($LASTEXITCODE -ne 0) { $clean = $false }
  }
  if (Test-Path -LiteralPath $job) {
    Assert-NoReparsePath $job
    $resolved = (Get-Item -LiteralPath $job).FullName
    if ($resolved -ne $job -or (Split-Path -Parent $resolved) -ne (Join-Path $boundary 'jobs') -or (Split-Path -Leaf $resolved) -notmatch '^job-[a-f0-9]{32}$') { $clean = $false }
    else {
      foreach ($entry in Get-ChildItem -LiteralPath $resolved -Recurse -Force) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Cleanup reparse rejected; retained ledger requires recovery' }
      }
      Remove-Item -LiteralPath $resolved -Recurse -Force
    }
  }
  $lock.Dispose()
  if ($clean) { Remove-Item -LiteralPath $lockPath; Write-Output 'cleanupCompleted=true' }
  else { throw 'Cleanup failed; retained provider.lock requires recovery' }
}
if ($workerCode -ne 0) { exit 1 }
