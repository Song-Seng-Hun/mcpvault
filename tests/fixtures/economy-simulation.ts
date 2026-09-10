import { guidanceError, guidanceText } from '../../src/guidance-runtime.js';
import { applyEconomyCommand, assertEconomyConservation, economyRevision, initialEconomy, type EconomyCommand, type EconomyPolicy, type EconomyState, type QuestTerms } from '../../src/economy-model.js';

export interface EconomyPilotSimulationOptions { runs: number }
export interface EconomyPilotSimulationReport {
  runs:number;
  abuse:{unapprovedAdmissions:number;sybilRejections:number;sameOwnerClaims:number;selfReviews:number};
  conservation:{issued:number;violations:number};
  liquidity:{completedCircles:number;minRewardSettlements:number;inactiveEscrow:number;ownerSpendable:number;treasurySpendable:number;escrow:number};
  safety:{concentrationRejections:number;absentRequesterPayments:number;absentWorkerPayments:number;absentReviewerPayments:number};
}

const policy:EconomyPolicy={
  version:1,revision:'deterministic-pilot',enabled:true,treasury:'treasury',operators:['operator'],
  owners:{treasury:'host',alice:'owner-a',bob:'owner-b',carol:'owner-c'},reviewers:['alice','bob','carol'],subjectiveReview:true,
  maxSupply:5000,minReward:10,maxReward:100,postingFee:2,reviewFee:5,dailySpend:107,dailyPosts:1,openContracts:2,
};
const at='2026-09-08T00:00:00.000Z';
const terms=(taskId:string,reward=100,kind:QuestTerms['kind']='research'):QuestTerms=>({taskId,taskRevision:'a'.repeat(64),title:'Deterministic counterexample',criteria:['Preserve uncertainty'],exclusions:['No external execution'],reward,kind,deadline:'2027-01-01T00:00:00.000Z',verifier:'independent-review-v1'});

/** A deterministic, model-free stress check. Each run varies the approved
 * fixed-supply pilot across independent circulation, inactivity, concentration,
 * and minimum-reward cases. It is evidence for invariants and liquidity shape,
 * never an operating forecast or permission to enable the economy. */
export function runDeterministicEconomyPilotSimulation(options:EconomyPilotSimulationOptions):EconomyPilotSimulationReport {
  if(!Number.isSafeInteger(options.runs)||options.runs!==1000)throw guidanceError(new Error('Pilot simulation requires exactly 1,000 deterministic runs'), 'guid-2ee0e8cc56664a44');
  let unapprovedAdmissions=0,sybilRejections=0,sameOwnerClaims=0,selfReviews=0,violations=0,completedCircles=0,minRewardSettlements=0,inactiveEscrow=0,concentrationRejections=0,absentRequesterPayments=0,absentWorkerPayments=0,absentReviewerPayments=0;
  let ending:EconomyState|undefined;
  for(let run=0;run<options.runs;run++) {
    let state=initialEconomy();
    const apply=(command:EconomyCommand)=>{state=applyEconomyCommand(state,command,policy,at).state;};
    const accepted=(command:EconomyCommand)=>{const before=state;try{apply(command);return state!==before;}catch{return false;}};
    const command=(contractId:string,op:EconomyCommand['op'],actor:string,extra:Partial<EconomyCommand>={})=>({op,actor,requestId:`${contractId}-${op}-${actor}`,contractId,expectedRevision:state.contracts[contractId]?economyRevision(state.contracts[contractId]):'missing',expectedGeneration:state.contracts[contractId]?.generation??0,...extra} as EconomyCommand);
    const draftAndFund=(contractId:string,requester:string,questTerms:QuestTerms)=>{apply(command(contractId,'draft',requester,{terms:questTerms}));apply(command(contractId,'fund',requester));};
    apply({op:'issue',actor:'operator',requestId:'issue',amount:5000,reason:guidanceText('guid-cd921f2af78aded0', 'approved fixed supply')});
    for(const account of ['alice','bob','carol'])apply({op:'allocate',actor:'operator',requestId:`allocate-${account}`,account,amount:200,reason:guidanceText('guid-e940f63bbcba522e', 'approved pilot budget')});
    if(accepted(command(`sybil-${run}`,'draft',`newcomer-${run}`,{terms:terms(`sybil-task-${run}`)})))unapprovedAdmissions++;else sybilRejections++;
    if(run%4===0) {
      const peers=['alice','bob','carol'];
      for(let index=0;index<peers.length;index++) {
        const requester=peers[index]!,worker=peers[(index+1)%peers.length]!,reviewer=peers[(index+2)%peers.length]!,contractId=`circle-${run}-${index}`;
        draftAndFund(contractId,requester,terms(`circle-task-${run}-${index}`));
        if(accepted(command(contractId,'claim',requester)))sameOwnerClaims++;
        apply(command(contractId,'claim',worker));apply(command(contractId,'submit',worker,{artifacts:[{path:`Knowledge/result-${run}-${index}.md`,revision:'b'.repeat(64)}]}));
        const basis=state.contracts[contractId]!.submission!.basis!;
        if(accepted(command(contractId,'review',worker,{verdict:'approve',basis,reason:guidanceText('guid-ed9116786b830430', 'self review attempt'),reviewArtifact:{path:`Knowledge/review-${run}-${index}.md`,revision:'c'.repeat(64)}})))selfReviews++;
        apply(command(contractId,'review',reviewer,{verdict:'approve',basis,reason:guidanceText('guid-83ab30b1e0b6285b', 'independent fixed review'),reviewArtifact:{path:`Knowledge/review-${run}-${index}.md`,revision:'c'.repeat(64)}}));
      }
      completedCircles++;
    } else if(run%4===1) {
      draftAndFund(`inactive-${run}`,'alice',terms(`inactive-task-${run}`));
      inactiveEscrow+=state.contracts[`inactive-${run}`]!.escrow;
    } else if(run%4===2) {
      draftAndFund(`concentrated-${run}`,'alice',terms(`concentrated-task-${run}`));
      apply(command(`concentrated-second-${run}`,'draft','alice',{terms:terms(`concentrated-second-task-${run}`)}));
      if(!accepted(command(`concentrated-second-${run}`,'fund','alice')))concentrationRejections++;
      if(accepted(command(`concentrated-${run}`,'claim','alice')))sameOwnerClaims++;
    } else {
      if(accepted(command(`below-minimum-${run}`,'draft','alice',{terms:terms(`below-minimum-task-${run}`,9)})))throw guidanceError(new Error('Minimum reward rejection unexpectedly changed state'), 'guid-056e92e1aebf22ac');
      const min=`minimum-${run}`;draftAndFund(min,'alice',terms(`minimum-task-${run}`,10,'mechanical'));apply(command(min,'claim','bob'));apply(command(min,'submit','bob',{artifacts:[{path:`Knowledge/minimum-${run}.md`,revision:'b'.repeat(64)}]}));
      apply(command(min,'resolve','operator',{amount:10,reason:guidanceText('guid-e8034eeaa77d1de9', 'explicit operator settlement')}));minRewardSettlements++;
      if(accepted(command(`missing-${run}`,'fund','bob')))absentRequesterPayments++;
      const absent=`absent-${run}`;draftAndFund(absent,'bob',terms(`absent-task-${run}`,10,'mechanical'));
      if(accepted(command(absent,'resolve','operator',{amount:0,reason:guidanceText('guid-2960cd2821cb60bd', 'worker absent')})))absentWorkerPayments++;
      apply(command(absent,'claim','carol'));apply(command(absent,'submit','carol',{artifacts:[{path:`Knowledge/absent-${run}.md`,revision:'b'.repeat(64)}]}));
      const basis=state.contracts[absent]!.submission!.basis!;
      if(accepted(command(absent,'review','alice',{verdict:'approve',basis,reason:guidanceText('guid-ef5005a84d7356ed', 'no assigned reviewer'),reviewArtifact:{path:`Knowledge/absent-review-${run}.md`,revision:'c'.repeat(64)}})))absentReviewerPayments++;
    }
    try {assertEconomyConservation(state);}catch{violations++;}
    ending=state;
  }
  const balances=ending!.balances;
  return {runs:options.runs,abuse:{unapprovedAdmissions,sybilRejections,sameOwnerClaims,selfReviews},conservation:{issued:ending!.issued,violations},liquidity:{completedCircles,minRewardSettlements,inactiveEscrow,ownerSpendable:(balances.alice||0)+(balances.bob||0)+(balances.carol||0),treasurySpendable:balances.treasury||0,escrow:Object.values(ending!.contracts).reduce((sum,contract)=>sum+contract.escrow,0)},safety:{concentrationRejections,absentRequesterPayments,absentWorkerPayments,absentReviewerPayments}};
}
