import {createHash} from 'node:crypto';
import {parseSkillDescriptor,type SkillDescriptor} from './skill-descriptor.js';
import type {SkillReleaseResource} from './skill-release-manifest.js';

/** Only the distinct, registered derivative descriptor. Never source evidence or
 * host review artifacts. Parsing conveys no execution or legal/policy clearance. */
export function parseReleaseDescriptor(resource:SkillReleaseResource,bytes:Buffer):SkillDescriptor{
  if(resource.kind!=='descriptor'||!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>32768
    ||bytes.length!==resource.bytes||createHash('sha256').update(bytes).digest('hex')!==resource.blob)
    throw Error('Reviewed skill descriptor unavailable');
  return parseSkillDescriptor(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
}
