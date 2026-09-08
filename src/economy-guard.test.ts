import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertEconomyConfigured } from './economy-ledger.js';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
test('omitting economy configuration cannot downgrade an existing paid vault to free task mutations',async()=>{
 const root=await mkdtemp(join(tmpdir(),'economy-guard-'));roots.push(root);
 await expect(assertEconomyConfigured(root,false)).resolves.toBeUndefined();
 await mkdir(join(root,'.mcpvault-economy'));
 await expect(assertEconomyConfigured(root,false)).rejects.toThrow(/configuration|host/);
 await expect(assertEconomyConfigured(root,true)).resolves.toBeUndefined();
});
