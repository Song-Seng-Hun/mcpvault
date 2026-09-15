import { createHash } from 'node:crypto';
import { parseSkillDescriptor } from './skill-descriptor.js';
/** Only the distinct, registered derivative descriptor. Never source evidence or
 * host review artifacts. Parsing conveys no execution or legal/policy clearance. */
export function parseReleaseDescriptor(resource, bytes) {
    if (resource.kind !== 'descriptor' || !Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 32768
        || bytes.length !== resource.bytes || createHash('sha256').update(bytes).digest('hex') !== resource.blob)
        throw Error('Reviewed skill descriptor unavailable');
    return parseSkillDescriptor(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}
