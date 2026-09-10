param([Parameter(Mandatory=$true)][string]$BoundaryRoot)
# Host-only regression fixtures. Never point this at a deployed runtime boundary.
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
$boundary = [IO.Path]::GetFullPath($BoundaryRoot).TrimEnd('\')
if ($boundary -notmatch '^[A-Za-z]:\\.+\\acl-regression-[a-f0-9]{32}$' -or (Test-Path -LiteralPath $boundary)) { throw 'New dedicated regression boundary required' }
Assert-NoReparsePath $boundary
$helper = Join-Path $PSScriptRoot 'pdf-job-acl.ps1'
$sid = 'S-1-15-2-1-2-3-4-5-6-7'
$jobs = Join-Path $boundary 'jobs'
$null = New-Item -ItemType Directory -Path $jobs
function Run-Helper([string]$job) {
  $output = & (Join-Path $PSHOME 'pwsh.exe') -NoLogo -NoProfile -NonInteractive -File $helper -Kind job -BoundaryRoot $boundary -Root $job -ContainerSid $sid 2>&1
  return @{ Code = $LASTEXITCODE; Output = ($output | Out-String).Trim() }
}
try {
  foreach ($scenario in @('protected', 'hardlink', 'safe')) {
    $job = Join-Path $jobs ('job-' + [guid]::NewGuid().ToString('N'))
    $nested = Join-Path $job 'first\second\third'
    $null = New-Item -ItemType Directory -Path $nested
    if ($scenario -eq 'protected') {
      $info = [IO.DirectoryInfo]::new($nested)
      $acl = [IO.FileSystemAclExtensions]::GetAccessControl($info)
      $acl.SetAccessRuleProtection($true,$true)
      [IO.FileSystemAclExtensions]::SetAccessControl($info,$acl)
    } elseif ($scenario -eq 'hardlink') {
      $outside = Join-Path $boundary 'outside.txt'
      $null = New-Item -ItemType File -Path $outside
      $null = New-Item -ItemType HardLink -Path (Join-Path $nested 'linked.txt') -Target $outside
    }
    $before = (Get-Acl -LiteralPath $job).Sddl
    $result = Run-Helper $job
    $after = (Get-Acl -LiteralPath $job).Sddl
    if ($scenario -eq 'safe') {
      if ($result.Code -ne 0 -or $result.Output -notmatch '"applied":true') { throw ('Safe tree failed: ' + $result.Output) }
      $grants = @((Get-Acl -LiteralPath $nested).GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq $sid -and $_.IsInherited })
      if ($grants.Count -ne 1) { throw 'Nested grant missing' }
    } else {
      if ($result.Code -ne 70 -or $before -ne $after) { throw ('Unsafe tree was not rejected before mutation: ' + $scenario) }
    }
    Write-Output ('PASS ' + $scenario)
  }
} finally {
  Assert-NoReparsePath $boundary
  $resolved = (Get-Item -LiteralPath $boundary).FullName.TrimEnd('\')
  if ($resolved -ne $boundary -or $resolved -notmatch '\\acl-regression-[a-f0-9]{32}$') { throw 'Cleanup boundary mismatch' }
  foreach ($entry in Get-ChildItem -LiteralPath $resolved -Recurse -Force) {
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Cleanup reparse rejected' }
  }
  # Remove only this newly created synthetic tree; no junction fixtures are used.
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
