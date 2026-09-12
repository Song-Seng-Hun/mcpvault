import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';

// Only the interpreter is reused. Every request reads the current native ACLs.
// Paths are newline-framed JSON data, never PowerShell source or command arguments.
const program = `$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed=@($identity,'S-1-5-18','S-1-5-32-544')
while($null -ne ($line=[Console]::ReadLine())) {
  $id=0; $status=4
  try {
    $request=ConvertFrom-Json -InputObject $line
    $id=[long]$request.id
    if($id -lt 1 -or $request.paths.Count -gt 64){throw 'Invalid request'}
    $status=0
    foreach($path in $request.paths) {
      if([IO.Directory]::Exists($path)) {$acl=[IO.Directory]::GetAccessControl($path)}
      else {$acl=[IO.File]::GetAccessControl($path)}
      $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
      if($allowed -notcontains $owner){$status=2; break}
      foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        if($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $rule.IdentityReference.Value){$status=3; break}
      }
      if($status -ne 0){break}
    }
  } catch {$status=4}
  [Console]::WriteLine([string]$id+':'+[string]$status)
}`;

type Pending = { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
let inspector: Inspector | undefined;
const unavailable = () => new Error('Host private storage permissions could not be verified');

class Inspector {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  private output = '';
  private closed = false;
  private idle?: ReturnType<typeof setTimeout>;

  constructor() {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    this.child = spawn(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', program], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { SystemRoot: systemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
          PSModulePath: join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') },
      });
    this.child.once('error', () => this.stop());
    this.child.once('exit', () => this.stop());
    this.child.stdin.on('error', () => this.stop());
    this.child.stdout.on('error', () => this.stop());
    this.child.stderr.on('error', () => this.stop());
    // Native errors are deliberately not retained or surfaced with sensitive paths.
    this.child.stderr.on('data', () => this.stop());
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.output += chunk;
      if (this.output.length > 1024) { this.stop(); return; }
      let end: number;
      while ((end = this.output.indexOf('\n')) !== -1) {
        const frame = this.output.slice(0, end).replace(/\r$/, '');
        this.output = this.output.slice(end + 1);
        const match = /^(\d{1,15}):([0234])$/.exec(frame);
        const item = match && this.pending.get(Number(match[1]));
        if (!match || !item) { this.stop(); return; }
        this.pending.delete(Number(match[1])); clearTimeout(item.timer);
        if (match[2] === '0') item.resolve(); else item.reject(unavailable());
      }
      if (!this.pending.size) this.startIdle();
    });
  }

  check(paths: readonly string[]): Promise<void> {
    if (this.closed || this.pending.size >= 64 || this.nextId >= 999999999999999) return Promise.reject(unavailable());
    const id = ++this.nextId;
    const frame = JSON.stringify({ id, paths }) + '\n';
    if (paths.length > 64 || Buffer.byteLength(frame, 'utf8') > 256 * 1024) return Promise.reject(unavailable());
    clearTimeout(this.idle);
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.stop(), 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(frame, 'utf8', error => { if (error) this.stop(); });
    });
  }

  private startIdle(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.stop(), 5000);
    this.idle.unref();
    // End-of-input closes the interpreter if the host exits while idle. During
    // checks the request timer keeps the event loop alive until verification.
    this.child.unref();
    for (const stream of [this.child.stdin, this.child.stdout, this.child.stderr]) {
      (stream as typeof stream & { unref?: () => void }).unref?.();
    }
  }

  private stop(): void {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.idle);
    if (inspector === this) inspector = undefined;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(unavailable()); }
    this.pending.clear(); this.output = '';
    this.child.stdin.destroy(); this.child.stdout.destroy(); this.child.stderr.destroy();
    if (this.child.exitCode === null) this.child.kill();
  }
}

/** Internal Windows ACL transport; permission decisions are never cached. */
export function checkWindowsPrivateAcl(paths: readonly string[]): Promise<void> {
  if (paths.length > 64 || paths.some(path => typeof path !== 'string')
    || Buffer.byteLength(JSON.stringify(paths), 'utf8') > 256 * 1024 - 64) return Promise.reject(unavailable());
  inspector ??= new Inspector();
  return inspector.check(paths);
}
