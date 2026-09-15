import {expect,test} from 'vitest';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

// Build first: fixed owned CLI only. No skill code, listener or Vault mutation.
test('compiled CLI rejects reviewed mode before opening a store without both explicit gates',()=>{
  for(const extra of [[],['--quarantine-skills']]){
    const child=spawnSync(process.execPath,[resolve('dist/server.js'),process.cwd(),'--reviewed-skills-config=missing.json',...extra],{
      windowsHide:true,timeout:15000,maxBuffer:65536,encoding:'utf8',
      env:{...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),...(process.env.TEMP?{TEMP:process.env.TEMP}:{}),...(process.env.TMP?{TMP:process.env.TMP}:{})},
    });
    expect(child.error).toBeUndefined();expect(child.status).not.toBe(0);
    expect(child.stderr).toContain('Reviewed skills require explicit quarantine and skill-evolution feature selection');
    expect(child.stderr).not.toContain('listener on');
  }
},35000);
