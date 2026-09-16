import {expect,test} from 'vitest';
import {allowedReviewedSkillRequest as allowed} from './skill-release-http-policy.js';
const call=(endpointId='skill.resolve',extra:Record<string,unknown>={})=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'call_endpoint',arguments:{endpointId,arguments:{skillId:'test',view:'metadata'},...extra}}});

test('permits only protocol setup and canonical skill-resource reads, never grants approval',()=>{
  for(const method of ['initialize','ping','tools/list','notifications/initialized','notifications/cancelled'])expect(allowed('POST',{jsonrpc:'2.0',method})).toBe(true);
  expect(allowed('POST',call())).toBe(true);
  expect(allowed('POST',call('skill.resolve',{accessToken:'synthetic-fixture',prettyPrint:false}))).toBe(true);
  // Access token, skill ID, view and permissions still require service validation.
  expect(allowed('POST',{...call(),params:{name:'call_endpoint',arguments:{endpointId:'skill.resolve'}}})).toBe(true);
});

test('rejects malformed requests, non-POST, unbounded batches and unrelated methods',()=>{
  for(const method of ['GET','HEAD','DELETE',undefined])expect(allowed(method,call())).toBe(false);
  for(const input of [undefined,null,{},[],1,'skill.resolve',{...call(),jsonrpc:'1.0'},Array.from({length:129},()=>call())])expect(allowed('POST',input)).toBe(false);
  expect(allowed('POST',{jsonrpc:'2.0',method:'resources/read',params:{uri:'secret'}})).toBe(false);
  expect(allowed('POST',{jsonrpc:'2.0',method:'prompts/get'})).toBe(false);
});

test('checks all batch entries and refuses aliases, URL dispatch and client profile claims',()=>{
  expect(allowed('POST',[call(),call('notes.write')])).toBe(false);
  for(const endpoint of ['notes.read','notes.write','auth.login','auth.register','resolve_skill'])expect(allowed('POST',call(endpoint))).toBe(false);
  for(const extra of [{url:'/api/notes/test'},{method:'POST'},{requestProfile:'unrestricted'},{arguments:[]}])expect(allowed('POST',call('skill.resolve',extra))).toBe(false);
  for(const name of ['write_note','search_capabilities','list_active_capabilities','orient_wiki','get_agent_pulse'])expect(allowed('POST',{...call(),params:{...call().params,name}})).toBe(false);
});

test('procedure search needs explicit host opt-in and cannot become ordinary search',()=>{
  const search=(args:Record<string,unknown>={})=>call('wiki.search',{arguments:{query:'검토 review',resultKind:'procedures',...args}});
  expect(allowed('POST',search())).toBe(false);
  expect(allowed('POST',search(),true)).toBe(true);
  expect(allowed('POST',search({resultKind:'notes'}),true)).toBe(false);
  expect(allowed('POST',search({resultKind:undefined}),true)).toBe(false);
  for(const args of [{url:'/api/notes'}, {pathPrefix:'Community'}, {allowProcedureDiscovery:true}, {principal:{accountId:'operator'}}]){
    expect(allowed('POST',search(args),true)).toBe(false);
  }
  expect(allowed('POST',[search(),call('notes.write')],true)).toBe(false);
  expect(allowed('POST',call('wiki.search',{arguments:{query:'review'}}),true)).toBe(false);
  expect(allowed('POST',call('skill.resolve',{allowProcedureDiscovery:true}))).toBe(false);
});
