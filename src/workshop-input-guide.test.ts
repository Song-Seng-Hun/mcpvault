import {expect,it} from 'vitest';
import {FACILITATION_METHODS,createFacilitation,validateFacilitationSubmission,advanceFacilitation,nextFacilitationAction} from './workshop-facilitation.js';
import {workshopInputExample,workshopInputGuide} from './workshop-input-guide.js';
const source={path:'Evidence.md',revision:'a'.repeat(64)};

it('uses account-relative placeholder IDs so chained method examples retain strict lineage',()=>{
 expect((workshopInputExample('brainwriting-independent','alex',source).ideaIds as any[])[0].ideaId).toBe('idea-alex-1');
 expect((workshopInputExample('brainwriting-build','alex',source).parentIdeaIds as string[])[0]).toBe('idea-alex-1');
 expect((workshopInputExample('affinity-kj-group','alex',source).groups as any[])[0]).toEqual({id:'group-alex',members:['idea-alex-1']});
 expect((workshopInputExample('mind-map-crosslinks','alex',source).mapEdges as any[])[0]).toMatchObject({fromId:'root-alex',toId:'option-alex'});
});

for(const method of FACILITATION_METHODS)it(`${method.methodId}: every public input shape can reach the terminal step with actual accounts`,()=>{
 let state=createFacilitation({version:1,methods:[method.methodId],purpose:'Test',scope:'Public',successCriteria:['Terminal'],sourceRevisions:[source],facilitatorAccountId:'one',participants:['one','two','three','four','five','six']});
 const submissions:Array<{accountId:string;stepId:string;structured:Record<string,unknown>}>=method.methodId==='scamper'
  ?state.participants.map(accountId=>({accountId,stepId:'brainwriting-independent',structured:{ideaIds:[{ideaId:`idea-${accountId}-1`,origin:'Prior bounded origin.'}]}}))
  :[];
 for(const step of method.steps){
  for(const accountId of state.participants){
   const structured=workshopInputExample(step.id,accountId,source);
   if(step.id==='affinity-kj-group') {
     structured.groups=[{id:'shared-group',members:state.participants.map(p=>`idea-${p}-1`)}];structured.unassignedIdeaIds=[];
   }
   if(step.id==='affinity-kj-name')structured.names=[{id:'shared-group',name:'Shared condition',members:state.participants.map(p=>`idea-${p}-1`)}];
   if(step.id.startsWith('checklist-'))(structured.checks as any[])[0].status='pass';
   const validated=validateFacilitationSubmission(state,{accountId,stepId:step.id,workshopRevision:source.revision,structured,existingSubmissions:submissions});
   submissions.push({accountId,stepId:step.id,structured:validated.structured});
  }
  const action=nextFacilitationAction(state,submissions);
  expect(action.kind).toBe(step===method.steps.at(-1)?'record_output':'advance');
  if(action.kind==='advance')state=advanceFacilitation(state,'Verified step');
  expect(JSON.stringify(workshopInputGuide(step.id)).length).toBeLessThan(6000);
 }
});
