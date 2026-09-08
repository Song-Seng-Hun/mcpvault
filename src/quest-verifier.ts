import { guidanceError } from './guidance-runtime.js';
import { buildMarkdownLiteralMask } from './backlinks.js';
import { FrontmatterHandler } from './frontmatter.js';

/** A deliberately narrow objective contract, not an LLM quality/claim evaluator.
 * No user-supplied program, regex, executable, URL fetch, or template is run. */
export function validateMarkdownContract(version:string,criteria:string[]):void {
  if(version!=='markdown-literal-v1')throw guidanceError(new Error('Unknown trusted verifier version'), 'guid-9cf92a0faae29aa3');
  if(!Array.isArray(criteria)||!criteria.length||criteria.length>12||criteria.some(c=>typeof c!=='string'||!c.startsWith('literal:')||!c.slice(8).trim()||c.length>500))throw guidanceError(new Error('Mechanical criteria must be bounded literal: phrases'), 'guid-0a23bf2a5a8af914');
}
export function verifyMarkdownContract(version:string,criteria:string[],bodies:string[]):boolean {
  validateMarkdownContract(version,criteria);
  if(!bodies.length||bodies.length>8||bodies.some(s=>typeof s!=='string'||s.length>100000))throw guidanceError(new Error('Verifier input budget exceeded; this is not a failed-work judgment'), 'guid-2d61343dfa11def0');
  const parser=new FrontmatterHandler();
  const prose=bodies.map(raw=>{
    const body=parser.parse(raw).content,mask=buildMarkdownLiteralMask(body);
    return body.split('').map((ch,i)=>mask[i]?' ':ch).join('');
  });
  return criteria.every(c=>prose.some(body=>body.includes(c.slice(8).trim())));
}
