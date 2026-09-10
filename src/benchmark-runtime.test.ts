import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,mkdir,rm,chmod,readdir,readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir,userInfo} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {acquireBenchmarkWriter} from './benchmark-runtime.js';
import type {LoadedBenchmarkHostConfig} from './benchmark-host.js';
const roots:string[]=[];vi.setConfig({testTimeout:30000});
afterEach(async()=>{for(const r of roots.splice(0))await rm(r,{recursive:true,force:true});});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'benchmark-writer-'));roots.push(root);const hostPath=join(root,'host'),vaultPath=join(root,'vault');await mkdir(hostPath,{mode:0o700});await mkdir(vaultPath);
 if(process.platform==='win32')await promisify(execFile)('icacls.exe',[hostPath,'/inheritance:r','/grant:r',`${userInfo().username}:(OI)(CI)F`],{windowsHide:true});else await chmod(hostPath,0o700);
 return {enabled:true,hostPath,vaultPath,accountProfiles:async()=>({})} as LoadedBenchmarkHostConfig;}
test('only one local runtime or host CLI writer owns a configured Vault at a time',async()=>{
 const f=await fixture(),writer=await acquireBenchmarkWriter(f);try{await writer.assertHeld();await expect(acquireBenchmarkWriter(f)).rejects.toThrow(/writer|lock/i);}finally{await writer.close();}
 const next=await acquireBenchmarkWriter(f);await next.close();await next.close();expect(await readdir(f.hostPath)).toEqual([]);
});
test('a separate process cannot acquire the active runtime writer and does not steal a stale lock',async()=>{
 const f=await fixture(),writer=await acquireBenchmarkWriter(f);const moduleUrl=pathToFileURL(join(process.cwd(),'src/benchmark-runtime.ts')).href;
 const script=`import {acquireBenchmarkWriter} from ${JSON.stringify(moduleUrl)}; const options=JSON.parse(process.argv[1]); try { const writer=await acquireBenchmarkWriter({...options,accountProfiles:async()=>({})}); await writer.close(); process.exitCode=3; } catch { process.stdout.write('refused'); }`;
 const run=()=>promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','-e',script,JSON.stringify({enabled:true,hostPath:f.hostPath,vaultPath:f.vaultPath})],{windowsHide:true,timeout:15000});
 try{expect((await run()).stdout).toBe('refused');}finally{await writer.close();}
 const stale=join(f.hostPath,'benchmark-stale.writer.lock');await writeFile(stale,'manual recovery required',{mode:0o600});
 // Copy a syntactically valid dead-owner marker to the actual lock name.
 const second=await acquireBenchmarkWriter(f);const lock=(await readdir(f.hostPath)).find(n=>n.endsWith('.writer.lock')&&!n.includes('stale'))!;
 const marker=JSON.parse(await readFile(join(f.hostPath,lock),'utf8'));await second.close();await writeFile(join(f.hostPath,lock),JSON.stringify({...marker,pid:2147483647}),{mode:0o600});
 expect((await run()).stdout).toBe('refused');expect(await readFile(join(f.hostPath,lock),'utf8')).toContain('2147483647');
});
test('close cannot remove another owner marker and disabled configurations create no lock',async()=>{
 const f=await fixture();await (await acquireBenchmarkWriter({...f,enabled:false})).close();expect(await readdir(f.hostPath)).toEqual([]);
 const writer=await acquireBenchmarkWriter(f),lock=(await readdir(f.hostPath))[0]!;const marker=JSON.parse(await readFile(join(f.hostPath,lock),'utf8'));
 await writeFile(join(f.hostPath,lock),JSON.stringify({...marker,nonce:'another-owner'}));
 await expect(writer.assertHeld()).rejects.toThrow(/ownership|fenc|changed/i);await expect(writer.close()).rejects.toThrow(/ownership|fenc|changed/i);
 expect(await readFile(join(f.hostPath,lock),'utf8')).toContain('another-owner');
});
