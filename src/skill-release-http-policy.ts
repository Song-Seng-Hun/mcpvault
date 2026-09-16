const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const protocolMethods=new Set(['initialize','ping','tools/list','notifications/initialized','notifications/cancelled']);

/** Transport-owned restriction, never an authorization claim from JSON/headers.
 * This supplementary listener accepts canonical approved-resource reads. Host
 * opt-in may additionally admit procedure-only discovery, never ordinary search.
 * Login stays on the existing authenticated channel; no account endpoint, generic
 * catalog/pulse, alias, URL dispatch or mutation is enabled here. Approval, current
 * account/source/owner checks still run in the ordinary read service. */
export function allowedReviewedSkillRequest(method:string|undefined,value:unknown,allowProcedureDiscovery=false):boolean{
  if(method!=='POST')return false;
  const batch=Array.isArray(value)?value:[value];
  if(!batch.length||batch.length>128)return false;
  return batch.every(item=>{
    if(!record(item)||item.jsonrpc!=='2.0'||typeof item.method!=='string')return false;
    if(protocolMethods.has(item.method))return true;
    if(item.method!=='tools/call'||!record(item.params)||item.params.name!=='call_endpoint'||!record(item.params.arguments))return false;
    const args=item.params.arguments;
    if(!Object.keys(args).every(key=>['endpointId','arguments','accessToken','prettyPrint'].includes(key))
      ||args.arguments!==undefined&&!record(args.arguments))return false;
    if(args.endpointId==='skill.resolve')return true;
    return allowProcedureDiscovery===true&&args.endpointId==='wiki.search'&&record(args.arguments)
      &&args.arguments.resultKind==='procedures'
      &&Object.keys(args.arguments).every(key=>['query','resultKind','limit','maxChars','accessToken','prettyPrint'].includes(key));
  });
}
