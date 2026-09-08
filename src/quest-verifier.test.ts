import { expect,test } from 'vitest';
import { verifyMarkdownContract, validateMarkdownContract } from './quest-verifier.js';

test('versioned literal verifier checks only contracted text and is not a truth judge',()=>{
 const criteria=['literal:Reproduction steps','literal:Known limitations'];
 expect(verifyMarkdownContract('markdown-literal-v1',criteria,['# Reproduction steps\nKnown limitations: not general proof.'])).toBe(true);
 expect(verifyMarkdownContract('markdown-literal-v1',criteria,['Reproduction steps only'])).toBe(false);
 expect(()=>validateMarkdownContract('arbitrary-js',criteria)).toThrow(/version/);
 expect(()=>validateMarkdownContract('markdown-literal-v1',['Run shell command now'])).toThrow(/literal/);
});
test('code-fenced and YAML examples are not counted as required delivered prose',()=>{
 expect(verifyMarkdownContract('markdown-literal-v1',['literal:Verified output'],['```md\nVerified output\n```'])).toBe(false);
 expect(verifyMarkdownContract('markdown-literal-v1',['literal:Verified output'],['~~~\nVerified output\n~~~'])).toBe(false);
});
