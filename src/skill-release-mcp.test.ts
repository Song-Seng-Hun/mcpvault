import {afterEach,expect,test} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Client,InMemoryTransport} from '@modelcontextprotocol/client';
import {createServer} from './createServer.js';
import {ScopeAuthService} from './scope-auth.js';
import {OwnerActivityPolicy} from './owner-activity.js';
import {createSkillSourceInspector} from './skill-release-source.js';
const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
const hash=(s:Buffer|string)=>createHash('sha256').update(s).digest('hex');
test('quarantined MCP reads use only the approved branch; originals and mutations stay unavailable',async()=>{
  const root=await mkdtemp(join(tmpdir(),'skill-release-mcp-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'Community','Skills','test-skill'),{recursive:true});
  await writeFile(join(root,'Community','Skills','test-skill','SKILL.md'),'# Unreviewed original marker\n');
  const auth=new ScopeAuthService(root);await auth.register({accountId:'operator',modelId:'test',password:'synthetic-test-password'});
  const source=createSkillSourceInspector(root);cleanup.push(async()=>source.close());
  const snapshot=await source.inspect('test-skill');expect(snapshot?.visible).toBe(true);
  const body=Buffer.from('# Approved limited procedure\nKeep exact source conditions.\n');
  const manifest={version:1,skillId:'test-skill',sourceFingerprint:snapshot!.inventory.fingerprint,metadataEvidenceHash:hash('metadata'),policyRevision:'review-v1',mode:'procedural_reference',mainResource:'main',
    resources:[{id:'main',blob:hash(body),bytes:body.length,title:'Procedure',kind:'procedure'}],retainedFunctions:['Review source.'],limitations:['No bundled execution.'],useWhen:['Authorized task.'],avoidWhen:['Missing source.'],
    review:{reviewer:'main',evidenceHashes:[hash('e')],normalCaseHashes:['n1','n2','n3'].map(hash),adversarialCaseHashes:['a1','a2','a3','a4'].map(hash)}};
  const bytes=Buffer.from(JSON.stringify(manifest)),blobs=new Map([[hash(body),body],[hash(bytes),bytes]]);let admitted=true;
  let race=false,bodyRead=false,postBodyRefreshes=0;
  // Admission evidence is synthetic here; artifact validation has a separate suite.
  const host={async candidates(){return ['test-skill'];},async entry(){return admitted?{releaseHash:hash(bytes),generation:'1',sourceName:'test-skill'}:undefined;},assertFresh(){if(!admitted)throw Error('revoked');},
    async readBlob(h:string){if(h===hash(body))bodyRead=true;return blobs.get(h)!;},async sourceFingerprint(){return snapshot!.inventory.fingerprint;},async verifyEvidence(){return true;}};
  const policy=new OwnerActivityPolicy({version:1,owners:{operator:'owner'},grants:[{id:'read-skills',ownerId:'owner',accountIds:['operator'],activities:['skill-evolution'],actions:['discover','read'],dataPrefixes:['Community/Skills'],executionTargets:['fixture-host'],expiresAt:'2999-01-01T00:00:00.000Z'}]});
  const server=createServer(root,{readOnly:true,quarantineSkills:true,features:{version:1,selected:['wiki-core','skill-evolution']},reviewedSkills:{host,source},
    ownerActivity:{refresh:async()=>{if(race&&bodyRead&&++postBodyRefreshes===2)admitted=false;},policy:()=>policy,execution:p=>p?{accountId:p.accountId,executionTarget:'fixture-host'}:undefined}});
  const client=new Client({name:'reviewed-skill-fixture',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
  cleanup.push(async()=>{await client.close();await server.close();});await Promise.all([client.connect(a),server.connect(b)]);
  const call=(endpointId:string,args:Record<string,unknown>)=>client.callTool({name:'call_endpoint',arguments:{endpointId,arguments:args}});
  const login=await call('auth.login',{accountId:'operator',password:'synthetic-test-password'});expect(login.isError).toBeFalsy();
  const accessToken=JSON.parse((login.content[0] as {text:string}).text).accessToken;
  const reply=await call('skill.resolve',{skillId:'test-skill',accessToken});expect(reply.isError,JSON.stringify(reply)).toBeFalsy();
  expect(JSON.parse((reply.content[0] as {text:string}).text)).toMatchObject({status:'reviewed_limited',content:body.toString(),executionAuthorized:false});
  const card=await call('skill.resolve',{skillId:'test-skill',view:'metadata',accessToken});expect(card.isError,JSON.stringify(card)).toBeFalsy();
  const cardData=JSON.parse((card.content[0] as {text:string}).text);
  expect(cardData).toMatchObject({view:'metadata',status:'reviewed_limited',card:{functions:['Review source.']},executionAuthorized:false});
  expect(cardData.content).toBeUndefined();expect(JSON.stringify(cardData)).not.toContain('Unreviewed original marker');
  const discovery=await call('wiki.search',{query:'Review',resultKind:'procedures',accessToken});
  expect(discovery.isError,JSON.stringify(discovery)).toBeFalsy();
  const discovered=JSON.parse((discovery.content[0] as {text:string}).text);
  expect(discovered.kind).toBe('reviewed_procedures');expect(discovered.cards).toHaveLength(1);
  expect(discovered.cards[0].nextAction.endpointId).toBe('skill.resolve');
  expect(JSON.stringify(discovery)).not.toMatch(/Unreviewed original marker|Community\/Skills/);
  const defaultSearch=await call('wiki.search',{query:'Review',accessToken});
  expect(Array.isArray(JSON.parse((defaultSearch.content[0] as {text:string}).text))).toBe(true);
  for(const constraint of [{query:'Review -source'},{pathPrefix:'Public'},{excludePaths:['Community']},{caseSensitive:true}]){
    const constrained=await call('wiki.search',{query:'Review',resultKind:'procedures',accessToken,...constraint});
    expect(constrained.isError,JSON.stringify(constrained)).toBeFalsy();
    expect(JSON.parse((constrained.content[0] as {text:string}).text).cards).toEqual([]);
  }
  const small=await call('wiki.search',{query:'Review',resultKind:'procedures',maxChars:512,prettyPrint:true,accessToken});
  expect(small.isError).toBeFalsy();expect((small.content[0] as {text:string}).text.length).toBeLessThanOrEqual(512);
  expect(JSON.parse((small.content[0] as {text:string}).text).cards).toEqual([]);
  expect((await call('wiki.search',{query:'Review',resultKind:'procedures'})).isError).toBe(true);
  expect((await client.listTools()).tools).toHaveLength(5);
  const raw=await call('notes.read',{path:'Community/Skills/test-skill/SKILL.md',accessToken});expect(raw.isError).toBe(true);expect(JSON.stringify(raw)).not.toContain('Unreviewed original marker');
  const anonymous=await call('skill.resolve',{skillId:'test-skill'});expect(anonymous.isError).toBe(true);
  race=true;bodyRead=false;postBodyRefreshes=0;
  const raced=await call('skill.resolve',{skillId:'test-skill',accessToken});
  expect(postBodyRefreshes).toBeGreaterThanOrEqual(2);
  expect(raced.isError,'revocation during the outer dispatcher refresh must discard approved bytes').toBe(true);
  expect(JSON.stringify(raced)).not.toContain('Approved limited procedure');race=false;
  admitted=true;race=true;bodyRead=false;postBodyRefreshes=0;
  const racedSearch=await call('wiki.search',{query:'Review',resultKind:'procedures',accessToken});
  expect(JSON.stringify(racedSearch)).not.toContain('Review source.');race=false;
  admitted=false;expect((await call('skill.resolve',{skillId:'test-skill',accessToken})).isError).toBe(true);
  expect((await call('skill.candidate',{skillId:'test-skill',op:'create',accessToken})).isError).toBe(true);
},30000);
