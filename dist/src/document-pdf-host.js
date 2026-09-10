import { guidanceError } from './guidance-runtime.js';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, lstat, open, rm, unlink, access } from 'node:fs/promises';
import { win32 } from 'node:path';
import { pdfDocumentStructure } from './document-pdf.js';
const fail = (message = 'Local PDF host unavailable or invalid configuration') => { throw new Error(message); };
function local(value) {
    if (typeof value !== 'string' || value.length > 240 || !/^[a-z]:[\\/]/i.test(value))
        return fail();
    const path = value.replace(/\//g, '\\');
    if (path.slice(3).split('\\').some(p => !p || p === '.' || p === '..' || /[\x00-\x1f<>:"|?*~]/.test(p) || /[. ]$/.test(p)))
        return fail();
    return path;
}
const within = (child, parent) => child.toLowerCase().startsWith(parent.toLowerCase() + '\\');
export async function assertNoPdfHostLinks(path) {
    const normalized = local(path), segments = normalized.slice(3).split('\\');
    let current = normalized.slice(0, 3);
    for (let i = 0; i < segments.length; i++) {
        current = win32.join(current, segments[i]);
        const info = await lstat(current);
        if (info.isSymbolicLink() || (i < segments.length - 1 && !info.isDirectory()))
            return fail('PDF host paths cannot use links');
    }
}
class PdfProcessExitUnconfirmed extends Error {
}
export function validatePdfHostConfig(input) {
    const fields = ['version', 'boundaryRoot', 'python', 'worker', 'sandboxHost', 'aclHelper', 'powershell', 'modelManifest', 'ocr', 'layout'];
    if (!input || input.version !== 1 || Object.keys(input).some(k => !fields.includes(k)))
        return fail();
    const boundaryRoot = local(input.boundaryRoot), runtime = win32.join(boundaryRoot, 'runtime');
    if (boundaryRoot.slice(3).split('\\').length < 2)
        return fail();
    const config = { version: 1, boundaryRoot, python: local(input.python), worker: local(input.worker),
        sandboxHost: local(input.sandboxHost), aclHelper: local(input.aclHelper), powershell: local(input.powershell) };
    if (!within(config.python, runtime) || !within(config.worker, runtime) || !within(config.sandboxHost, boundaryRoot)
        || !within(config.aclHelper, boundaryRoot) || !config.python.endsWith('.exe') || !config.worker.endsWith('.py')
        || !config.sandboxHost.endsWith('.exe') || !config.aclHelper.endsWith('.ps1') || !config.powershell.endsWith('.exe'))
        return fail();
    if (input.ocr !== undefined) {
        if (!['off', 'rapidocr'].includes(input.ocr))
            return fail();
        config.ocr = input.ocr;
    }
    if (input.layout !== undefined) {
        if (typeof input.layout !== 'boolean')
            return fail();
        config.layout = input.layout;
    }
    if (input.modelManifest !== undefined) {
        config.modelManifest = local(input.modelManifest);
        if (!within(config.modelManifest, win32.join(boundaryRoot, 'models')))
            return fail();
    }
    if ((config.layout || config.ocr === 'rapidocr') && !config.modelManifest)
        return fail();
    return config;
}
export function validatePdfWorkerOutput(bytes, exitCode, revision) {
    if (!bytes.length || bytes.length > 16 * 1024 * 1024 || ![0, 2, 3, 4, 5].includes(exitCode))
        return fail('PDF sandbox extraction failed');
    let result;
    try {
        result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    }
    catch {
        return fail('Invalid PDF worker response');
    }
    if (result?.metrics?.exitCode !== exitCode || result.sourceSha256 !== revision)
        return fail('PDF worker revision or exit mismatch');
    if (exitCode === 2)
        return fail('Optional PDF dependencies or models unavailable');
    if (![0, 4].includes(exitCode))
        return fail('PDF worker rejected or failed the conversion');
    return result;
}
export function pdfHostEnvironment(executable) {
    // PATHEXT is essential: otherwise PowerShell may dispatch an .exe through
    // file association without waiting or reporting LASTEXITCODE.
    return { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows', PATH: win32.dirname(executable), PATHEXT: '.EXE', POWERSHELL_TELEMETRY_OPTOUT: '1' };
}
export function pdfWorkerArguments(c, profile, job, input, revision) {
    return ['--profile', profile, '--python', c.python, '--worker', c.worker, '--runtime-root', win32.join(c.boundaryRoot, 'runtime'), '--job-dir', job,
        '--max-memory-mb', '1024', '--timeout-seconds', '120', ...(c.modelManifest ? ['--models', win32.join(c.boundaryRoot, 'models')] : []),
        '--', '--input', input, '--expected-sha256', revision, '--output-json', 'stdout', '--max-pages', '200', '--timeout-seconds', '120',
        ...(c.layout ? ['--layout'] : []), ...(c.ocr ? ['--ocr', c.ocr] : []), ...(c.modelManifest ? ['--model-manifest', c.modelManifest] : [])];
}
/** Buffer-limited, hidden, argument-array execution. The C# host owns the Job
 * Object, so terminating it closes its only Job handle and kills the parser. */
async function run(executable, args, timeoutMs = 125000, ceiling = 16 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
            env: pdfHostEnvironment(executable) });
        const chunks = [];
        let length = 0, errorBytes = 0, failed = false, stderr = '';
        let exitTimer;
        const uncertain = () => { clearTimeout(timer); if (exitTimer)
            clearTimeout(exitTimer); reject(new PdfProcessExitUnconfirmed('PDF process exit unconfirmed; host recovery required')); };
        const abort = () => {
            if (failed)
                return;
            failed = true;
            try {
                if (!child.kill()) {
                    uncertain();
                    return;
                }
            }
            catch {
                uncertain();
                return;
            }
            exitTimer = setTimeout(uncertain, 5000);
        };
        const timer = setTimeout(abort, timeoutMs);
        child.stdout.on('data', (chunk) => { length += chunk.length; if (length > ceiling)
            abort();
        else if (!failed)
            chunks.push(chunk); });
        child.stderr.on('data', (chunk) => { errorBytes += chunk.length; if (errorBytes <= 1024)
            stderr += chunk.toString('ascii'); if (errorBytes > 65536)
            abort(); });
        child.on('error', () => {
            if (child.pid) {
                uncertain();
                return;
            }
            clearTimeout(timer);
            reject(guidanceError(new Error('PDF host process unavailable'), 'guid-06bd12959a15944e'));
        });
        child.on('close', code => {
            clearTimeout(timer);
            if (exitTimer)
                clearTimeout(exitTimer);
            if (failed || code === null)
                reject(guidanceError(new Error('PDF host timeout or output budget exceeded'), 'guid-308737e370565166'));
            else
                resolve({ bytes: Buffer.concat(chunks), code,
                    ...(/^[a-z0-9_]{1,80}\r?\n$/.test(stderr) && { diagnostic: stderr.trim() }) });
        });
    });
}
let queue = Promise.resolve();
let admitted = 0;
/** Optional Windows-only local provider. Each job uses a new OS identity;
 * setup through teardown is serialized, with a cross-process fail-closed lock.
 * Never falls back to unrestricted Python. Host config is not an endpoint input. */
export class LocalPdfProvider {
    config;
    blocked = false;
    hot;
    constructor(config) { this.config = validatePdfHostConfig(config); }
    async extract(snapshot) {
        if (process.platform !== 'win32' || this.blocked || snapshot.mediaType !== 'application/pdf')
            return fail();
        const key = createHash('sha256').update(`${snapshot.path}\0${snapshot.revision}`).digest('hex');
        if (this.hot?.key === key)
            return this.hot.document;
        if (admitted >= 2)
            return fail('PDF queue full; retry later');
        admitted++;
        const operation = queue.then(async () => {
            if (this.blocked)
                return fail();
            if (this.hot?.key === key)
                return this.hot.document;
            const document = await this.convert(snapshot);
            // One hot generation only. Source/scope are revalidated by DocumentIndex
            // before and after this call. Runtime maintenance requires provider restart.
            this.hot = { key, document };
            return document;
        });
        queue = operation.then(() => { }, () => { });
        try {
            return await operation;
        }
        finally {
            admitted--;
        }
    }
    async convert(snapshot) {
        const c = this.config, jobs = win32.join(c.boundaryRoot, 'jobs');
        // Check all existing ancestor components BEFORE mkdir or executing a trusted
        // host helper. Checking only a final lstat misses parent junctions.
        for (const path of [c.boundaryRoot, c.python, c.worker, c.sandboxHost, c.aclHelper, c.powershell,
            ...(c.modelManifest ? [c.modelManifest] : [])])
            await assertNoPdfHostLinks(path);
        try {
            await assertNoPdfHostLinks(jobs);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        await mkdir(jobs, { recursive: true });
        await assertNoPdfHostLinks(jobs);
        const lockPath = win32.join(c.boundaryRoot, 'provider.lock');
        let lock;
        try {
            lock = await open(lockPath, 'wx', 0o600);
        }
        catch {
            return fail('PDF host busy or requires stale-job recovery');
        }
        const id = randomUUID().replace(/-/g, ''), profile = `mcpvault-pdf-v1-${id}`, job = win32.join(jobs, `job-${id}`);
        // Durable, content-free recovery identity before any OS mutation. Never log
        // source paths, bodies or credentials. A crash cannot leave an unnamed SID.
        try {
            await lock.writeFile(JSON.stringify({ version: 1, profile, job, pid: process.pid }));
            await lock.sync();
        }
        catch (error) {
            this.blocked = true;
            await lock.close(); // Keep the failed ledger path for explicit recovery.
            throw error;
        }
        let exitUnconfirmed = false;
        let creationAttempted = false, clean = true, containerSid = '', runtimeTouched = false, modelsTouched = false;
        const cleanupFailures = [];
        const checked = async (exe, args) => {
            let result;
            try {
                result = await run(exe, args, 125000, 128 * 1024);
            }
            catch (error) {
                if (error instanceof PdfProcessExitUnconfirmed)
                    exitUnconfirmed = true;
                throw error;
            }
            if (result.code !== 0)
                return fail(`PDF sandbox setup or cleanup failed${result.diagnostic ? ': ' + result.diagnostic : ''}`);
            return JSON.parse(result.bytes.toString('utf8'));
        };
        try {
            await mkdir(job, { mode: 0o700 });
            creationAttempted = true;
            const creation = await checked(c.sandboxHost, ['--profile', profile, '--create-profile']);
            if (creation.profile !== profile || creation.profileCreated !== true)
                return fail();
            const plan = await checked(c.sandboxHost, ['--profile', profile, '--provision-job', job]);
            if (plan.version !== 1 || plan.profile !== profile || plan.applied !== false || plan.roots?.length !== 1
                || local(plan.roots[0].path).toLowerCase() !== job.toLowerCase() || !/^S-1-15-2-(\d+-){6}\d+$/.test(plan.containerSid))
                return fail();
            containerSid = plan.containerSid;
            const grant = async (kind, root) => checked(c.powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', c.aclHelper,
                '-Kind', kind, '-BoundaryRoot', c.boundaryRoot, '-Root', root, '-ContainerSid', plan.containerSid]);
            // Private ACL is established BEFORE any authorized source bytes are staged.
            await grant('job', job);
            const input = win32.join(job, 'source.pdf');
            await writeFile(input, snapshot.bytes, { flag: 'wx', mode: 0o600 });
            runtimeTouched = true;
            await grant('runtime', win32.join(c.boundaryRoot, 'runtime'));
            if (c.modelManifest) {
                modelsTouched = true;
                await grant('models', win32.join(c.boundaryRoot, 'models'));
            }
            const result = await run(c.sandboxHost, pdfWorkerArguments(c, profile, job, input, snapshot.revision));
            if (result.code >= 70)
                return fail(`PDF sandbox host failed (${result.code}${result.diagnostic ? ': ' + result.diagnostic : ''})`);
            return pdfDocumentStructure(snapshot.path, snapshot.revision, validatePdfWorkerOutput(result.bytes, result.code, snapshot.revision));
        }
        catch (error) {
            if (error instanceof PdfProcessExitUnconfirmed)
                exitUnconfirmed = true;
            throw error;
        }
        finally {
            const retainIfUnconfirmed = async () => {
                if (exitUnconfirmed) {
                    this.blocked = true;
                    this.hot = undefined;
                    await lock.close();
                    // Do not revoke or delete while any setup/parser process may still run.
                    throw new PdfProcessExitUnconfirmed('PDF process exit unconfirmed; host recovery required');
                }
            };
            await retainIfUnconfirmed();
            // Never recycle an identity. A teardown failure blocks this provider and
            // retains the lock for explicit host recovery, rather than crossing scopes.
            if (creationAttempted) {
                try {
                    const deletion = await checked(c.sandboxHost, ['--profile', profile, '--delete-profile']);
                    if (deletion.profile !== profile || deletion.profileDeleted !== true)
                        clean = false;
                }
                catch {
                    clean = false;
                    cleanupFailures.push('profile');
                }
                await retainIfUnconfirmed();
            }
            for (const kind of [...(runtimeTouched ? ['runtime'] : []), ...(modelsTouched ? ['models'] : [])]) {
                try {
                    await checked(c.powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', c.aclHelper, '-Operation', 'revoke',
                        '-Kind', kind, '-BoundaryRoot', c.boundaryRoot, '-Root', win32.join(c.boundaryRoot, kind), '-ContainerSid', containerSid]);
                }
                catch {
                    clean = false;
                    cleanupFailures.push(kind);
                }
                await retainIfUnconfirmed();
            }
            try {
                if (!within(job, jobs) || !/^job-[a-f0-9]{32}$/.test(win32.basename(job)))
                    throw new Error();
                await rm(job, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
                try {
                    await access(job);
                    clean = false;
                }
                catch (error) {
                    if (error.code !== 'ENOENT')
                        clean = false;
                }
            }
            catch {
                clean = false;
                cleanupFailures.push('job');
            }
            await lock.close();
            if (clean)
                await unlink(lockPath);
            else {
                this.blocked = true;
                this.hot = undefined;
                throw guidanceError(new Error(`PDF cleanup failed (${cleanupFailures.join(',')}); host recovery required`), 'guid-c370bf27449dcd3f');
            }
        }
    }
}
export async function loadPdfHostConfig(path) {
    await assertNoPdfHostLinks(path);
    const info = await lstat(local(path));
    if (info.isSymbolicLink() || !info.isFile() || info.size > 16384)
        return fail();
    const bytes = await readFile(local(path));
    if (bytes.length > 16384)
        return fail();
    return validatePdfHostConfig(JSON.parse(bytes.toString('utf8')));
}
export function configuredPdfProvider(path) {
    let provider;
    return { extract: async (snapshot) => {
            provider ??= loadPdfHostConfig(path).then(config => new LocalPdfProvider(config));
            return (await provider).extract(snapshot);
        } };
}
