import { expect, test } from 'vitest';
import { coordinate } from './work-model.js';

test('a paid operation can bridge existing Work under one coordinator without deadlock',async()=>{
 const events:string[]=[];
 const result=await Promise.race([
   coordinate(async()=>{events.push('outer');await coordinate(async()=>{events.push('inner');});return 'done';}),
   new Promise(resolve=>setTimeout(()=>resolve('blocked'),100)),
 ]);
 expect(result).toBe('done');expect(events).toEqual(['outer','inner']);
});
test('separate request contexts still serialize their critical sections',async()=>{
 let active=0,peak=0;
 await Promise.all(Array.from({length:5},()=>coordinate(async()=>{active++;peak=Math.max(active,peak);await new Promise(r=>setTimeout(r,2));active--;})));
 expect(peak).toBe(1);
});

test('nested siblings serialize and rejection drains admitted children before releasing the root',async()=>{
 const events:string[]=[];let active=0,peak=0;
 const section=async(name:string,fail=false)=>{active++;peak=Math.max(peak,active);events.push(name);await new Promise(r=>setTimeout(r,5));active--;if(fail)throw new Error('expected');};
 const root=coordinate(async()=>Promise.all([
   coordinate(()=>section('failure',true)),coordinate(()=>section('slow')),
 ]));
 const outside=coordinate(()=>section('outside'));
 await expect(root).rejects.toThrow('expected');await outside;
 expect(peak).toBe(1);expect(events).toEqual(['failure','slow','outside']);
});
