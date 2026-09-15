import {expect,test} from 'vitest';
import {parseSkillDescriptor} from './skill-descriptor.js';
import {skillPotentialImpact} from './skill-impact.js';
import {SkillUsageTelemetry} from './skill-usage.js';
import {SKILL_EFFECTS,IMPACT_AXES} from './skill-descriptor.js';
import {skillPassport} from './skill-passport.js';
const version=(id:string)=>({skillId:id,path:`Community/Skills/${id}/SKILL.md`,revision:id.padEnd(64,'0')});
test('declared connections compose consequences; claims cannot lower potential impact',()=>{
  const d=parseSkillDescriptor({version:1,kind:'tool',domains:['finance'],purpose:'Authorized service.',effects:['read_credentials'],
    connections:[{kind:'api',target:'https://example.com',effects:['network_send']}],
    impactClaims:[{axis:'accounts',level:'low',scenario:'A sandbox may limit damage.'}]});
  const r=skillPotentialImpact(d);
  expect(r.axes.accounts.level).toBe('critical');expect(r.axes.data.level).toBe('critical');
  expect(r.axes.domain.level).toBe('unknown');expect(r.axes.legal.level).toBe('unknown');
  expect(r.residualRisk).toBe('not_assessed');expect(r.permissionGranted).toBe(false);
});
test('missing effects never prove no potential harm or license a domain',()=>{
  const r=skillPotentialImpact(parseSkillDescriptor({version:1,kind:'procedure',purpose:'Reference.',domains:['finance']}));
  expect(Object.values(r.axes).every(a=>a.level==='unknown')).toBe(true);
  expect(skillPotentialImpact().coverage).toBe('unknown');
});
test('usage bounds preserve deduplication and do not invent complete counts',()=>{
  const u=new SkillUsageTelemetry(1),a=version('a'),b=version('b');
  u.reported('actor',a,'receipt','task','success');u.reported('actor',a,'receipt','task','success');
  u.resolved('actor',b);
  expect(u.snapshot('actor',a)).toMatchObject({coverage:'partial',reportedApplications:1,reportedSuccesses:1,verifiedApplications:null});
  expect(u.snapshot('actor',b).reportedApplications).toBeNull();
  expect(u.snapshot('other',a).reportedApplications).toBeNull();
});
test('co-use truncation is explicit and never counts a retried task twice',()=>{
  const u=new SkillUsageTelemetry(100),a=version('a');
  for(let n=0;n<35;n++){
    u.reported('actor',a,`a-${n}`,`task-${n}`,'success');
    u.reported('actor',version(`b${n}`),`b-${n}`,`task-${n}`,'success');
  }
  u.reported('actor',a,'retry','task-0','success');
  const r=u.snapshot('actor',a);
  expect(r.coUsed).toHaveLength(32);expect(r.coverage).toBe('partial');
  expect(r.coUsed[0]!.tasks).toBe(1);
});
test('maximum impact sections expand by axis instead of repeating an impossible read',()=>{
  const declaration=parseSkillDescriptor({version:1,kind:'tool',purpose:'x',effects:SKILL_EFFECTS,
    impactClaims:IMPACT_AXES.map(axis=>({axis,level:'critical',scenario:'s'.repeat(512),assumptions:['a'.repeat(200),'b'.repeat(200)]}))});
  const source={path:'Community/Skills/x/SKILL.md',revision:'a'.repeat(64)},b={source,...source,sourceGuards:[source],status:'original',declaration};
  const r:any=skillPassport('x',b,'impact',null,12000);
  expect(r.partial).toBe(true);expect(r.requiredReads.map((a:any)=>a.arguments.axis)).toEqual([...IMPACT_AXES]);
  for(const a of r.requiredReads){
    const detail:any=skillPassport('x',b,'impact',null,12000,a.arguments.axis);
    expect(detail.partial).toBe(false);expect(Object.keys(detail.impact.axes)).toEqual([a.arguments.axis]);
    expect(JSON.stringify(detail).length).toBeLessThanOrEqual(12000);
  }
});
test('bounded co-use identifiers fit a full metadata read without repeating host paths',()=>{
  const u=new SkillUsageTelemetry(100),a=version('a');
  for(let n=0;n<32;n++){
    u.reported('actor',a,`a-${n}`,`t-${n}`,'success');
    const peer=version(`b${n}`.padEnd(100,'x'));peer.revision='b'.repeat(64);
    u.reported('actor',peer,`b-${n}`,`t-${n}`,'success');
  }
  const source={path:a.path,revision:a.revision},b={source,...source,sourceGuards:[source],status:'original'};
  const r:any=skillPassport('a',b,'usage',u.snapshot('actor',a),12000);
  expect(r.partial).toBe(false);expect(r.usage.coUsed).toHaveLength(32);
  expect(JSON.stringify(r).length).toBeLessThanOrEqual(12000);
});
