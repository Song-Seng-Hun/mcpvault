/** Data-only worked shapes. Replace examples with observed evidence, never
 * submit an example as proof. Validators remain authoritative. */
export function workshopInputExample(step:string,account='your-account',source={path:'Evidence.md',revision:'0'.repeat(64)}):Record<string,unknown> {
 const ownIdea=`idea-${account}-1`;
 const idea=(id=ownIdea,parent?:string)=>({ideaId:id,origin:'Observed problem or exact source',...(parent?{parentIdeaId:parent,extension:'Explain the change'}:{})});
 const ownerAction={accountId:account,value:'One bounded follow-up'};
 const cases:Record<string,Record<string,unknown>>={
  'page-led-frame':{purpose:'Bounded purpose',scope:'Allowed scope',outcome:'Expected result',questions:['Open question'],sourceRevisions:[source]},
  'page-led-read':{acknowledgement:{...source,accountId:account}},
  'page-led-discuss':{observations:['Observed condition'],extension:'Proposed extension',challenge:'Unresolved counterexample'},
  'how-might-we-observe':{observations:['Observed problem'],evidence:['Exact public evidence']},
  'how-might-we-question':{questions:['How might we address the observed problem?']},
  'how-might-we-refine':{questions:['Bounded open question'],challenge:'Check solution bias'},
  'brainwriting-independent':{variant:'async',ideaIds:[idea()]},
  'brainwriting-build':{ideaIds:[idea(`idea-${account}-2`,ownIdea)],extension:'Change with reason',parentIdeaIds:[ownIdea]},
  'six-hats-setup':{questions:['What should change?'],constraints:['Preserve current safety']},
  'six-hats-information':{evidence:['Observed evidence'],uncertainty:['Not measured']},
  'six-hats-alternatives':{ideaIds:[idea()]},
  'six-hats-benefits':{benefits:[{alternativeId:'idea-1',value:'Conditional benefit'}]},
  'six-hats-risks':{risks:[{alternativeId:'idea-1',value:'Potential failure'}],challenge:'What disproves it?'},
  'six-hats-intuition':{preferences:['Tentative preference, not human emotion'],uncertainty:['Not evidence']},
  'six-hats-synthesis':{adopted:['Conditional choice'],rejected:['Alternative and reason'],minority:['Competing view'],uncertainty:['Unknown'],revisit:'After measurement'},
  'crazy8s-eight':{ideaIds:Array.from({length:8},(_,i)=>idea(`idea-${i+1}`))},
  'crazy8s-select':{ranking:[{alternativeId:'idea-1',rank:1}],criteria:['Fit to constraint'],reason:'Conditional preference'},
  '1-2-4-all-one':{ideaIds:[idea()]},
  '1-2-4-all-two':{extensions:['Review of individual proposals'],participantAccounts:[account],reducedVariant:'Only one account available; not independent consensus'},
  '1-2-4-all-four':{synthesis:'Combine actual proposals',participantAccounts:[account],reducedVariant:'Only one account available; not independent consensus'},
  '1-2-4-all-all':{synthesis:'Bounded conclusion',minority:['Unresolved view'],uncertainty:['Unverified'],participantAccounts:[account],reducedVariant:'Single-account review'},
  'affinity-kj-collect':{ideaIds:[idea()]},
  'affinity-kj-group':{groups:[{id:`group-${account}`,members:[ownIdea]}],unassignedIdeaIds:[]},
  'affinity-kj-name':{names:[{id:`group-${account}`,name:'Shared condition',members:[ownIdea]}],uncertainty:['Overlap is permitted']},
  'mind-map-root':{questions:['Central question']},
  'mind-map-branches':{mapNodes:[{id:`root-${account}`,type:'question',label:'Central question'},{id:`option-${account}`,type:'alternative',label:'Proposed direction'}]},
  'mind-map-crosslinks':{mapEdges:[{fromId:`root-${account}`,toId:`option-${account}`,reason:'Addresses the question; not proof'}]},
  'ngt-independent':{ideaIds:[idea()]},
  'ngt-roundrobin':{ideaIds:[idea()],account},
  'ngt-clarify':{questions:['What assumption?'],clarifications:['Condition remains unverified']},
  'ngt-rank':{ballot:[{alternativeId:'idea-1',rank:1}],ranking:'Preferred for review',reason:'Fits stated criterion'},
  'dot-voting-freeze':{alternatives:[{id:'idea-1',label:'Proposed direction'}],criteria:['Fit to scope']},
  'dot-voting-vote':{ballot:[{alternativeId:'idea-1',rank:1}],ranking:'Review preference; not approval'},
  'daci-roles':{roles:{driver:account,approver:account,contributors:[account],informed:[account]}},
  'daci-alternatives':{alternatives:[{id:'idea-1',label:'Direction'}],evidence:['Public source locator']},
  'daci-reason':{reason:'Conditional selection',uncertainty:['Unmeasured'],minority:['Retain alternative']},
  'daci-review':{reviewConditions:['After new evidence'],revisit:'Before execution'},
  'premortem-failure':{failureScenario:'Assume the intended outcome failed'},
  'premortem-causes':{causes:['Contributing condition'],evidence:['Observed precursor']},
  'premortem-prioritize':{ranking:[{riskId:'risk-1',rank:1}],risks:[{riskId:'risk-1',value:'Conditional risk'}],reason:'Impact and uncertainty'},
  'premortem-mitigate':{mitigation:'Small protective measure',earlySignal:'Observable threshold',ownerAction},
  'retrospective-observe':{retrospectiveVariant:'start-stop-continue',observations:['start','stop','continue'].map(category=>({category,value:'Observed experience with context'}))},
  'retrospective-experiment':{experiment:'One testable change',ownerAction,reviewConditions:['After one bounded trial']},
  'blameless-postmortem-timeline':{timeline:[{id:'event-1',value:'Known event time or explicit time unknown'}],impact:'Observed impact, not blame'},
  'blameless-postmortem-factors':{contributingFactors:['System condition'],helpfulResponse:['Observed helpful action']},
  'blameless-postmortem-prevention':{prevention:'Testable prevention',ownerAction,reviewConditions:['Verify the prevention']},
 };
 if(step.startsWith('checklist-'))return {checks:[{itemId:'check-1',status:'unknown',actor:account,evidence:'Not yet inspected',reason:'Await evidence'}],...(step==='checklist-close'?{unresolvedExceptions:['Await evidence; not complete']}:{})};
 if(step.startsWith('scamper-'))return {operator:step.slice('scamper-'.length),ideaIds:[idea(`idea-${account}-${step.slice('scamper-'.length)}`,ownIdea)],parentIdeaIds:[ownIdea]};
 const result=cases[step];if(!result)throw new Error('Unknown workshop step');return result;
}

function shape(value:unknown):Record<string,unknown> {
 if(Array.isArray(value))return {type:'array',maxItems:16,items:value.length?shape(value[0]):{type:'string',maxLength:500}};
 if(typeof value==='number')return {type:'integer',minimum:1,maximum:16};
 if(value&&typeof value==='object')return {type:'object',properties:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,shape(v)])),required:Object.keys(value).filter(k=>!['reducedVariant','repairs','unresolvedExceptions'].includes(k))};
 return {type:'string',maxLength:500};
}
export function workshopInputGuide(step:string,account?:string,source?:{path:string;revision:string}) {
 const example=workshopInputExample(step,account,source);
 return {example,inputSchema:shape(example),notice:'Shape example only. Replace with actual observations. Optional method variants and cross-field checks are validated by the server. Unknown never means pass.'};
}
