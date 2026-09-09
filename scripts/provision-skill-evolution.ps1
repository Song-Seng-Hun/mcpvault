param(
    [Parameter(Mandatory=$true)][string]$PrivateDirectory,
    [Parameter(Mandatory=$true)][string]$VaultPath
)
# Host-only provisioning: validate location and ACL BEFORE generating any secret.
$ErrorActionPreference = 'Stop'
$privateFull = [IO.Path]::GetFullPath($PrivateDirectory)
$vaultFull = [IO.Path]::GetFullPath($VaultPath)
$sourceFull = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if (-not [IO.Path]::IsPathRooted($PrivateDirectory) -or $privateFull.StartsWith('\\') -or -not [IO.Path]::IsPathRooted($VaultPath)) { throw 'Absolute local private directory and absolute Vault required.' }
foreach ($excluded in @($sourceFull,$vaultFull)) {
    if ($privateFull.Equals($excluded,[StringComparison]::OrdinalIgnoreCase) -or $privateFull.StartsWith($excluded.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Private directory must be outside source and Vault.' }
}
if (-not (Test-Path -LiteralPath $vaultFull -PathType Container)) { throw 'The exact Vault is unavailable.' }
$cursor = $privateFull
while ($cursor) {
    if (Test-Path -LiteralPath $cursor) {
        if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Private storage cannot traverse a reparse point.' }
    }
    $parent = [IO.Directory]::GetParent($cursor)
    $cursor = if ($parent) { $parent.FullName } else { $null }
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
if (-not (Test-Path -LiteralPath $privateFull)) {
    [void][IO.Directory]::CreateDirectory($privateFull)
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($identity)
    $acl.SetAccessRuleProtection($true,$false)
    foreach ($sid in @($identity,(New-Object Security.Principal.SecurityIdentifier 'S-1-5-18'),(New-Object Security.Principal.SecurityIdentifier 'S-1-5-32-544'))) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $privateFull -AclObject $acl
}
$actual = Get-Acl -LiteralPath $privateFull
$allowed = @($identity.Value,'S-1-5-18','S-1-5-32-544')
if ($allowed -notcontains $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value) { throw 'Unexpected private storage owner.' }
foreach ($rule in $actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $rule.IdentityReference.Value) { throw 'Private storage permissions are too broad; no secret generated.' }
}
$keyPath = Join-Path $privateFull 'attestation.key'
$configPath = Join-Path $privateFull 'skill-evolution.json'
if ((Test-Path -LiteralPath $keyPath) -or (Test-Path -LiteralPath $configPath)) { throw 'Existing key or configuration preserved; inspect and reuse it explicitly.' }
$secretBytes = New-Object byte[] 48
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $random.GetBytes($secretBytes)
    $stream = [IO.File]::Open($keyPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {
        $encoded = [Text.Encoding]::UTF8.GetBytes([Convert]::ToBase64String($secretBytes))
        $stream.Write($encoded,0,$encoded.Length); $stream.Flush($true)
    } finally { $stream.Dispose() }
    $configuration = @{ version=1; vaultPath=$vaultFull; enabled=$true; attestationKeyFile='attestation.key'; approverAccounts=@(); profileIds=@() } | ConvertTo-Json -Depth 4
    $stream = [IO.File]::Open($configPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($configuration)
        $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true)
    } finally { $stream.Dispose() }
} finally {
    [Array]::Clear($secretBytes,0,$secretBytes.Length)
    if ($encoded) { [Array]::Clear($encoded,0,$encoded.Length) }
    $random.Dispose()
}
[pscustomobject]@{ configPath=$configPath; keyCreated=$true; profiles=0; approvals=0; secretPrinted=$false } | ConvertTo-Json
