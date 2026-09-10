import { expect, test } from 'vitest';
import * as model from './benchmark-model.js';

const def = {id:'first',lineage:'problem',version:'v1',title:'Bounded problem',problem:'Find the answer',sources:[{path:'Evidence.md',revision:'a'.repeat(64)}],rubric:[{id:'correct',description:'Correct answer',minimum:60}],deadline:'2026-10-01T00:00:00.000Z',allowedTools:['notes.read'],mode:'objective',answerKnown:true,grader:{kind:'exact'},reward:0,maxWinners:2,cap:0,qualityThreshold:60,participants:['alice','bob'],reviewers:['reviewer-one','reviewer-two','reviewer-three'],allowSameOwnerReview:true};
export const definition=()=>structuredClone(def) as model.BenchmarkDefinition;
test('definition is immutable bounded public data and unknown answers require peer mode',()=>{
 expect(model.validateBenchmarkDefinition(def)).toEqual(def);
 expect(()=>model.validateBenchmarkDefinition({...def,answerKnown:false})).toThrow(/peer/i);
 for(const changed of [{answer:'secret'},{grader:{kind:'regex',pattern:'.*'}},{reward:1},{sources:[{path:'../private.md',revision:'a'.repeat(64)}]},{sources:[{path:'nested/.git/config.md',revision:'a'.repeat(64)}]}])expect(()=>model.validateBenchmarkDefinition({...def,...changed})).toThrow();
});
test('fixed graders do not interpret code, commands, URLs or regular expressions',()=>{
 expect(model.gradeBenchmark({kind:'exact'},'https://example.test/$()','https://example.test/$()')).toBe('pass');
 expect(model.gradeBenchmark({kind:'exact'},'.*','something')).toBe('fail');
 expect(model.gradeBenchmark({kind:'structured_json'},'{"b":[2],"a":1}','{"a":1,"b":[2]}')).toBe('pass');
 expect(model.gradeBenchmark({kind:'structured_json'},'{"a":1,"a":2}','{"a":2}')).toBe('indeterminate');
 expect(model.gradeBenchmark({kind:'numeric',absoluteTolerance:0.1},'2','2.09')).toBe('pass');
 expect(model.gradeBenchmark({kind:'numeric',absoluteTolerance:0.1},'Infinity','1')).toBe('indeterminate');
 expect(model.gradeBenchmark({kind:'numeric',absoluteTolerance:0.1},'2','invalid')).toBe('fail');
 expect(model.gradeBenchmark({kind:'exact'},'x'.repeat(20000),'a')).toBe('indeterminate');
});

test.each([
 ['9007199254740992','9007199254740993',0,'fail'],
 ['9007199254740993','9007199254740992',0,'fail'],
 ['-9007199254740992','-9007199254740993',0,'fail'],
 ['9007199254740992','9007199254740993',0.5,'fail'],
 ['9007199254740992','9007199254740993',1,'pass'],
 ['1e-1000','0',0,'fail'],
 ['0','-1e-1000',0,'fail'],
 ['0','0.10000000000000000000000000001',0.1,'fail'],
 ['2','2.1',0.1,'pass'],
 ['-2','-2.1',0.1,'pass'],
 ['1.2300e+2','+123.0',0,'pass'],
 ['-.50','-5e-1',0,'pass'],
 ['-0','0.000',0,'pass'],
 ['1e-1000','1.0e-1000',0,'pass'],
 ['1e1000','10e999',0,'pass'],
 ['9'.repeat(100),'9'.repeat(99)+'8',0,'fail'],
 ['0','5.000000000000000000001e-324',Number.MIN_VALUE,'fail'],
] as const)('numeric grading compares exact decimal %s vs %s with tolerance %s', (answer,submission,absoluteTolerance,outcome)=>{
 expect(model.gradeBenchmark({kind:'numeric',absoluteTolerance},answer,submission)).toBe(outcome);
});

test.each([
 ['9007199254740992','9007199254740993','fail'],
 ['{"n":9007199254740992}','{"n":9007199254740993}','fail'],
 ['{"n":[1e-1000]}','{"n":[0]}','fail'],
 ['{"n":0.1}','{"n":0.10000000000000000000000000001}','fail'],
 ['{"b":[9007199254740993,1e-1000],"a":1.00}','{"a":1e0,"b":[9007199254740993.0,1.0e-1000]}','pass'],
 ['[0,-0,1e2,1e1000]','[-0,0,100,10e999]','pass'],
 ['1','"1e0"','fail'],
 ['1','{"coefficient":"1","exponent":0}','fail'],
 ['9'.repeat(100),'9'.repeat(99)+'8','fail'],
] as const)('structured JSON preserves numeric precision and value types: %s', (answer,submission,outcome)=>{
 expect(model.gradeBenchmark({kind:'structured_json'},answer,submission)).toBe(outcome);
});

test.each(['1e-1001','1e1001','1e9999999999999999999999999999','1'.repeat(101),'NaN','Infinity'])('numeric budget or syntax error distinguishes invalid host answer from invalid submission: %s', invalid=>{
 const grader={kind:'numeric' as const,absoluteTolerance:0};
 expect(model.gradeBenchmark(grader,invalid,invalid)).toBe('indeterminate');
 expect(model.gradeBenchmark(grader,'0',invalid)).toBe('fail');
});

test.each(['1e-1001','1e1001','1'.repeat(101),'NaN','{"a":1,"a":2}','{"__proto__":1}'])('JSON number budget and parser failures hold a bad host answer but fail a bad submission: %s', invalid=>{
 expect(model.gradeBenchmark({kind:'structured_json'},invalid,invalid)).toBe('indeterminate');
 expect(model.gradeBenchmark({kind:'structured_json'},'0',invalid)).toBe('fail');
});

test.each(['\u00a0','\ufeff','\v','\f','\u2028','\u2029'])('structured JSON rejects non-JSON whitespace outside strings: %j', whitespace=>{
 const grader={kind:'structured_json' as const};
 expect(model.gradeBenchmark(grader,`${whitespace}{"n":1}`,'{"n":1}')).toBe('indeterminate');
 expect(model.gradeBenchmark(grader,'{"n":1}',`{"n":${whitespace}1}`)).toBe('fail');
 expect(model.gradeBenchmark(grader,'{"n":1}',`{"n":1}${whitespace}`)).toBe('fail');
 expect(model.gradeBenchmark(grader,JSON.stringify({s:whitespace}),JSON.stringify({s:whitespace}))).toBe('pass');
});

test('structured JSON accepts only its four whitespace characters between tokens',()=>{
 expect(model.gradeBenchmark({kind:'structured_json'},' \t\r\n{ "n" : [1, true, null] }\n','{"n":[1,true,null]}')).toBe('pass');
});
const review=(id:string, family:string, score:number,evidence:'supported'|'contradicted'='supported',resolutionOf:string[]=[])=>({id,account:id,modelFamily:family,owner:'same',entryId:'entry-one',criteria:[{criterion:'correct',score,reason:'Checked the source',sources:def.sources,uncertainty:'Limited to this source',evidence}],resolutionOf});
test('peer conflict is held until an additional independent-family review explicitly resolves it',()=>{
 const d={...definition(),mode:'peer' as const,answerKnown:false};delete d.grader;
 const first=review('r1','family-one',90),second=review('r2','family-two',20,'contradicted');
 expect(model.evaluateBenchmarkPeer(d,[first,second]).state).toBe('held');
 expect(model.evaluateBenchmarkPeer(d,[first,second,review('r3','family-three',80,'supported',['r1','r2'])])).toMatchObject({state:'pass',scores:[80]});
 expect(model.evaluateBenchmarkPeer(d,[first,{...second,modelFamily:'family-one'}]).state).toBe('held');
});
test('passing scores against explicitly contradicted evidence are held instead of minting',()=>{
 const d={...definition(),mode:'peer' as const,answerKnown:false};delete d.grader;
 expect(model.evaluateBenchmarkPeer(d,[review('r1','one',90,'contradicted'),review('r2','two',90,'contradicted')]).state).toBe('held');
});
test('top N uses threshold, declared criterion order then final submission sequence',()=>{
 const d={...definition(),maxWinners:1,rubric:[{id:'a',description:'a',minimum:0},{id:'b',description:'b',minimum:0}]};
 expect(model.rankBenchmark(d,[{entryId:'early',sequence:1,scores:[60,100]},{entryId:'late',sequence:2,scores:[100,60]}])).toEqual(['late']);
 expect(model.rankBenchmark(d,[{entryId:'early',sequence:1,scores:[80,80]},{entryId:'late',sequence:2,scores:[80,80]}])).toEqual(['early']);
 expect(model.rankBenchmark(d,[{entryId:'low',sequence:1,scores:[1,1]}])).toEqual([]);
});
