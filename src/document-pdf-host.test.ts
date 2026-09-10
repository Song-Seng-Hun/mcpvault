import { describe, expect, it } from 'vitest';
import { validatePdfHostConfig, validatePdfWorkerOutput, pdfWorkerArguments, pdfHostEnvironment } from './document-pdf-host.js';
describe('PDF host admission', () => {
  const root = 'E:/private/pdf-host-v1';
  const config = () => ({ version: 1, boundaryRoot: root, python: root+'/runtime/python.exe', worker: root+'/runtime/document_pdf_worker.py',
    sandboxHost: root+'/pdf-appcontainer-host.exe', aclHelper: root+'/pdf-job-acl.ps1', powershell: 'C:/Program Files/PowerShell/7/pwsh.exe' });
  it('validates only fixed local host configuration, never request-selected commands', () => {
    expect(validatePdfHostConfig(config()).version).toBe(1);
    expect(() => validatePdfHostConfig({ ...config(), python: 'C:/Users/user/anaconda/python.exe' })).toThrow();
    expect(() => validatePdfHostConfig({ ...config(), boundaryRoot: '//server/share' })).toThrow();
    expect(() => validatePdfHostConfig({ ...config(), worker: root+'/runtime/../payload.py' })).toThrow();
    expect(() => validatePdfHostConfig({ ...config(), shell: true })).toThrow();
  });
  it('rejects truncation, UTF8 errors, nonmatching exit status and unbounded output', () => {
    expect(() => validatePdfWorkerOutput(Buffer.from('{'), 0, 'a'.repeat(64))).toThrow();
    expect(() => validatePdfWorkerOutput(Buffer.from([0xff]), 0, 'a'.repeat(64))).toThrow();
    expect(() => validatePdfWorkerOutput(Buffer.from(JSON.stringify({ metrics: { exitCode: 4 } })), 0, 'a'.repeat(64))).toThrow();
    expect(() => validatePdfWorkerOutput(Buffer.alloc(16*1024*1024+1), 0, 'a'.repeat(64))).toThrow();
  });
  it('passes the same dedicated root for nested Python and keeps native helper execution synchronous', () => {
    const c = validatePdfHostConfig({ ...config(), python: root+'/runtime/venv/Scripts/python.exe' });
    const args = pdfWorkerArguments(c, 'mcpvault-pdf-v1-'+'a'.repeat(32), root+'/jobs/job-x', root+'/jobs/job-x/source.pdf', 'a'.repeat(64));
    expect(args[args.indexOf('--runtime-root')+1]).toBe('E:\\private\\pdf-host-v1\\runtime');
    const env = pdfHostEnvironment(c.powershell);
    expect(env.PATHEXT).toBe('.EXE');
    expect(Object.keys(env).sort()).toEqual(['PATH','PATHEXT','POWERSHELL_TELEMETRY_OPTOUT','SystemRoot'].sort());
  });
});
