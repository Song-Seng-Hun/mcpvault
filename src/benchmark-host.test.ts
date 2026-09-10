import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile as fsWriteFile,rm,chmod} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {tmpdir,userInfo} from 'node:os';
import {loadBenchmarkHostConfig,createBenchmarkIntegrity,validateBenchmarkHostConfig} from './benchmark-host.js';
import * as hostExports from './benchmark-host.js';
import {acquireBenchmarkWriter} from './benchmark-runtime.js';
const roots:string[]=[];
test('host entrypoint reexports the same exclusive writer API for host CLI integration',()=>{
 expect((hostExports as Record<string,unknown>).acquireBenchmarkWriter).toBe(acquireBenchmarkWriter);
});
vi.setConfig({testTimeout:30000});
const writeFile=(path:string,data:string)=>fsWriteFile(path,data,{mode:0o600});
async function secureHost(path:string){if(process.platform==='win32')await promisify(execFile)('icacls.exe',[path,'/inheritance:r','/grant:r',`${userInfo().username}:(OI)(CI)F`],{windowsHide:true});else await chmod(path,0o700);}
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
test('host config has explicit opt-in and fails closed on unknown fields',()=>{
 expect(()=>validateBenchmarkHostConfig({version:1,enabled:true})).toThrow();
 expect(()=>validateBenchmarkHostConfig({version:1,enabled:false,vaultPath:'x',hostPath:'y',operators:['operator'],definitions:[],profiles:{},integrityKeyFile:'key.txt',answerFile:'answers.json',approveMint:true})).toThrow();
});
test('private HMAC authenticity rejects edited records without putting secrets in records',async()=>{
 const integrity=createBenchmarkIntegrity(Buffer.alloc(32,7));const record={submission:'private',winners:[]};
 const seal=await integrity.sign(record);expect(await integrity.verify(record,seal)).toBe(true);
 expect(await integrity.verify({...record,winners:['attacker']},seal)).toBe(false);
 expect(()=>createBenchmarkIntegrity(Buffer.alloc(8))).toThrow();
});
test('loader keeps expected answers outside vault/repository and suppresses private errors',async()=>{
 const root=await mkdtemp(join(tmpdir(),'benchmark-host-'));roots.push(root);const vault=join(root,'vault'),host=join(root,'host');await mkdir(vault);await mkdir(host);await secureHost(host);
 const raw={version:1,enabled:true,vaultPath:vault,hostPath:host,operators:['operator'],definitions:[],profiles:{},integrityKeyFile:'key.txt',answerFile:'answers.json'};
 const config=join(host,'config.json');await writeFile(config,JSON.stringify(raw));await writeFile(join(host,'key.txt'),'ab'.repeat(32));await writeFile(join(host,'answers.json'),JSON.stringify({first:'HOST-SECRET'}));
 const result=await loadBenchmarkHostConfig(config,vault);expect(await result.answerReader('first')).toBe('HOST-SECRET');expect(await result.accountProfiles()).toEqual({});
 await writeFile(join(host,'answers.json'),'MALFORMED-HOST-SECRET');await expect(result.answerReader('first')).rejects.toThrow(/^Benchmark host answer unavailable$/);
 await expect(result.accountProfiles()).rejects.toThrow(/changed|unavailable/i);
 await expect(result.assertHumanOperator('operator')).rejects.toThrow(/changed|unavailable/i);
 await writeFile(join(vault,'config.json'),JSON.stringify(raw));await expect(loadBenchmarkHostConfig(join(vault,'config.json'),vault)).rejects.toThrow(/private|outside|unavailable/i);
});
test('answer bindings survive restart but refuse regrading an existing sealed version after hidden answer drift',async()=>{
 const root=await mkdtemp(join(tmpdir(),'benchmark-host-'));roots.push(root);const vault=join(root,'vault'),host=join(root,'host');await mkdir(vault);await mkdir(host);await secureHost(host);
 const raw={version:1,enabled:true,vaultPath:vault,hostPath:host,operators:['operator'],definitions:[],profiles:{},integrityKeyFile:'key.txt',answerFile:'answers.json'};
 const config=join(host,'config.json');await writeFile(config,JSON.stringify(raw));await writeFile(join(host,'key.txt'),'ab'.repeat(32));await writeFile(join(host,'answers.json'),JSON.stringify({first:'secret-one'}));
 const a=await loadBenchmarkHostConfig(config,vault),record={versions:[{definition:{id:'first',mode:'objective'}}]};const seal=await a.integrity.sign(record);
 expect(await (await loadBenchmarkHostConfig(config,vault)).integrity.verify(record,seal)).toBe(true);
 await writeFile(join(host,'answers.json'),JSON.stringify({first:'secret-two'}));await expect(a.integrity.sign(record)).rejects.toThrow(/changed|unavailable/i);
 expect(await (await loadBenchmarkHostConfig(config,vault)).integrity.verify(record,seal)).toBe(false);
});
