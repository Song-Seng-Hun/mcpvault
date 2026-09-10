param(
  [ValidateSet('grant','revoke')][string]$Operation = 'grant',
  [Parameter(Mandatory=$true)][ValidateSet('runtime','models','job')][string]$Kind,
  [Parameter(Mandatory=$true)][string]$BoundaryRoot,
  [Parameter(Mandatory=$true)][string]$Root,
  [Parameter(Mandatory=$true)][string]$ContainerSid
)
# Trusted host-only helper. Never expose these parameters through MCP/REST.
# Only a reviewed dedicated runtime/models or newly created opaque job is admitted.
# No executable strings, shell interpolation, external network or recursive grants
# to a repository, Vault, user home or drive root are accepted.
$ErrorActionPreference = 'Stop'
$stage = 'validation'
try {
  if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'powershell_7_required' }
  if ($ContainerSid -notmatch '^S-1-15-2-(\d+-){6}\d+$') { throw 'sid' }
  $boundary = [IO.Path]::GetFullPath($BoundaryRoot).TrimEnd('\')
  $target = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  if ($boundary -notmatch '^[A-Za-z]:\\' -or $boundary.Substring(3).Split('\').Count -lt 2 -or $boundary.StartsWith('\\')) { throw 'boundary' }
  $expected = if ($Kind -eq 'job') { Join-Path $boundary 'jobs' } else { $boundary }
  $leaf = Split-Path -Leaf $target
  if ((Split-Path -Parent $target) -ne $expected -or ($Kind -eq 'job' -and $leaf -notmatch '^job-[a-f0-9]{32}$') -or ($Kind -ne 'job' -and $leaf -ne $Kind)) { throw 'target' }
  $ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $systemSid = 'S-1-5-18'
  $adminSid = 'S-1-5-32-544'
  # Validate all ancestor components before enumeration. Never follow junctions.
  for ($current = $target; $current; $current = Split-Path -Parent $current) {
    $entry = Get-Item -LiteralPath $current -Force
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'reparse' }
    if ($current -eq [IO.Path]::GetPathRoot($current)) { break }
  }
  $pending = [Collections.Generic.Stack[IO.FileSystemInfo]]::new()
  $stage = 'tree'
  $pending.Push((Get-Item -LiteralPath $target -Force))
  $count = 0
  while ($pending.Count) {
    $entry = $pending.Pop()
    $path = $entry.FullName
    if (++$count -gt 32768 -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $entry.LinkType) { throw 'tree' }
    $acl = [IO.FileSystemAclExtensions]::GetAccessControl($entry, [Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner)
    $actualOwner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($actualOwner -notin @($ownerSid,$systemSid,$adminSid)) { throw 'owner' }
    if ($path -ne $target) {
      # Root replacement propagates to inherited descendants. Never silently
      # retain protected/custom children or change an outside hardlink's DACL.
      if ($acl.AreAccessRulesProtected) { throw 'protected_child' }
      if ($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]).Count) { throw 'explicit_child' }
    }
    if ($entry -is [IO.DirectoryInfo]) {
      foreach ($child in $entry.EnumerateFileSystemInfos()) { $pending.Push($child) }
    }
  }
  $mask = if ($Kind -eq 'job') { '0x1301bf' } else { '0x1200a9' }
  $stage = 'descriptor'
  $sddl = 'O:' + $ownerSid + 'D:P(A;OICI;FA;;;' + $ownerSid + ')(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)'
  if ($Operation -eq 'grant') { $sddl += '(A;OICI;' + $mask + ';;;' + $ContainerSid + ')' }
  # Change the DACL only. Set-Acl with a new security object can attempt SACL
  # replacement and unnecessarily require SeSecurityPrivilege. Owner was checked
  # above; neither ownership nor the system audit policy is modified here.
  $directory = [IO.DirectoryInfo]::new($target)
  $security = [IO.FileSystemAclExtensions]::GetAccessControl($directory, [Security.AccessControl.AccessControlSections]::Access)
  $security.SetSecurityDescriptorSddlForm($sddl, [Security.AccessControl.AccessControlSections]::Access)
  $stage = 'apply'
  [IO.FileSystemAclExtensions]::SetAccessControl($directory, $security)
  if ($Kind -eq 'job' -and $Operation -eq 'grant') {
    $stage = 'integrity'
    $icacls = Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\icacls.exe'
    & $icacls $target '/setintegritylevel' '(OI)(CI)L' '/T' > $null 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'integrity' }
  }
  $verified = Get-Acl -LiteralPath $target
  $stage = 'verify'
  if (-not $verified.AreAccessRulesProtected) { throw 'verify' }
  $grants = @($verified.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq $ContainerSid })
  if ($Operation -eq 'grant' -and ($grants.Count -ne 1 -or $grants[0].AccessControlType -ne 'Allow')) { throw 'verify' }
  if ($Operation -eq 'revoke' -and $grants.Count -ne 0) { throw 'verify' }
  # The native launcher independently pins/audits every descendant before resume.
  '{"version":1,"applied":true}'
  exit 0
} catch {
  [Console]::Error.WriteLine('pdf_acl_setup_failed_' + $stage)
  exit 70
}
