param(
    [Parameter(Mandatory=$true)][string]$PrivateDirectory,
    [Parameter(Mandatory=$true)][string]$VaultPath
)
# Explicit pristine, dormant provisioning. Never selects administrators or world content.
$ErrorActionPreference = 'Stop'
$privateFull = [IO.Path]::GetFullPath($PrivateDirectory)
$vaultFull = [IO.Path]::GetFullPath($VaultPath)
$sourceFull = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if (-not [IO.Path]::IsPathRooted($PrivateDirectory) -or $privateFull.StartsWith('\\') -or -not [IO.Path]::IsPathRooted($VaultPath)) { throw 'Absolute local private directory and absolute Vault required.' }
foreach ($excluded in @($sourceFull,$vaultFull)) {
    if ($privateFull.Equals($excluded,[StringComparison]::OrdinalIgnoreCase) -or $privateFull.StartsWith($excluded.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Host directory must be outside source and Vault.' }
}
if (-not (Test-Path -LiteralPath $vaultFull -PathType Container)) { throw 'The exact Vault is unavailable.' }
$turnDirectory = Join-Path $vaultFull 'Community\Roleplay\Turns'
if ((Test-Path -LiteralPath $turnDirectory) -and @(Get-ChildItem -LiteralPath $turnDirectory -Force).Count) { throw 'Existing roleplay records require their original administrators/checkpoint; no dormant configuration created.' }
$cursor = $privateFull
while ($cursor) {
    if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Host storage cannot traverse a reparse point.' }
    $parent = [IO.Directory]::GetParent($cursor)
    $cursor = if ($parent) { $parent.FullName } else { $null }
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
if (-not (Test-Path -LiteralPath $privateFull)) {
    [void][IO.Directory]::CreateDirectory($privateFull)
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($identity); $acl.SetAccessRuleProtection($true,$false)
    foreach ($sid in @($identity,(New-Object Security.Principal.SecurityIdentifier 'S-1-5-18'),(New-Object Security.Principal.SecurityIdentifier 'S-1-5-32-544'))) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
    }
    Set-Acl -LiteralPath $privateFull -AclObject $acl
}
$actual = Get-Acl -LiteralPath $privateFull
$allowed = @($identity.Value,'S-1-5-18','S-1-5-32-544')
if ($allowed -notcontains $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value) { throw 'Unexpected host storage owner.' }
foreach ($rule in $actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $rule.IdentityReference.Value) { throw 'Host storage permissions are too broad.' }
}
$configPath = Join-Path $privateFull 'roleplay.json'
if (Test-Path -LiteralPath $configPath) { throw 'Existing configuration preserved; inspect and reuse it explicitly.' }
$configuration = @{ version=1; vaultPath=$vaultFull; hostPath=$privateFull; administrators=@() } | ConvertTo-Json -Depth 4
$stream = [IO.File]::Open($configPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($configuration)
    $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true)
} finally { $stream.Dispose() }
[pscustomobject]@{ configPath=$configPath; administrators=0; worldCreated=$false; dormant=$true } | ConvertTo-Json
