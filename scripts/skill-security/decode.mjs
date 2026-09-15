// Inspection views only. Never return these as instructions or replace source bytes.
const invisible=/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD]/gu;
const lookalikes={'а':'a','е':'e','о':'o','р':'p','с':'c','у':'y','х':'x','і':'i','ј':'j','ѕ':'s','ӏ':'l','ο':'o','Α':'A','Β':'B','Ε':'E','Ι':'I','Κ':'K','Μ':'M','Ν':'N','Ο':'O','Ρ':'P','Τ':'T','Χ':'X'};
export function normalizeView(text) {
  return text.normalize('NFKC').replace(invisible,'').replace(/[аеорсухіјѕӏοΑΒΕΙΚΜΝΟΡΤΧ]/gu,c=>lookalikes[c]);
}
function printable(bytes) {
  try { const s=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    return s && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s) ? s : undefined;
  } catch { return undefined; }
}
export function inspectionViews(text,add) {
  const values=[], seen=new Set(), queue=[{text,depth:0}], maxViews=24, maxBytes=524288;
  let decodedBytes=0;
  const push=(value,depth)=>{
    if (!value || seen.has(normalizeView(value))) return;
    if(depth>4){add('DECODE_DEPTH','HIGH',true);return;}
    if(queue.length>=maxViews || (decodedBytes+=Buffer.byteLength(value))>maxBytes){add('DECODE_BUDGET','HIGH',true);return;}
    queue.push({text:value,depth});
  };
  for(let i=0;i<queue.length;i++) {
    const {text:raw,depth}=queue[i], value=normalizeView(raw);
    if(seen.has(value))continue; seen.add(value);
    if (raw.match(invisible)) add('INVISIBLE_CONTROLS','HIGH');
    if (/[\u{E0000}-\u{E007F}]/u.test(raw)) add('UNICODE_TAGS','HIGH');
    values.push(raw); if(value!==raw)values.push(value);
    if(/\\[xu][0-9a-f]/i.test(value)) push(value.replace(/\\x([0-9a-f]{2})|\\u([0-9a-f]{4})/gi,(_,a,b)=>String.fromCharCode(parseInt(a||b,16))),depth+1);
    if(/&#(?:x[0-9a-f]+|[0-9]+);/i.test(value)) push(value.replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(m,n)=>{
      const c=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);
      return c<=0x10ffff && !(c>=0xd800&&c<=0xdfff)?String.fromCodePoint(c):m;
    }),depth+1);
    if(/%[0-9a-f]{2}/i.test(value)) {
      try {push(decodeURIComponent(value),depth+1);} catch {add('UNDECODABLE_SEQUENCE','MEDIUM',true);}
    }
    let matches=0;
    for(const match of value.matchAll(/\b[A-Za-z0-9+/_-]{16,}={0,2}(?![A-Za-z0-9+/_=-])/g)) {
      if(++matches>64){add('DECODE_BUDGET','HIGH',true);break;}
      const token=match[0];
      if(/^[a-f0-9]{16,}$/i.test(token) && token.length%2===0) push(printable(Buffer.from(token,'hex')),depth+1);
      const bytes=Buffer.from(token,'base64');
      if(bytes.toString('base64').replace(/=+$/,'')===token.replace(/-/g,'+').replace(/_/g,'/').replace(/=+$/,'')) push(printable(bytes),depth+1);
    }
    for(const match of value.matchAll(/\b(?:[01]{8}[\s,]+){4,}[01]{8}\b/g)) {
      if(++matches>64){add('DECODE_BUDGET','HIGH',true);break;}
      push(printable(Buffer.from(match[0].split(/[\s,]+/).map(bits=>parseInt(bits,2)))),depth+1);
    }
    // One ROT13 view per decoded layer. Seen-set prevents inverse-transform loops.
    if(value.length<=65536) push(value.replace(/[a-z]/gi,c=>String.fromCharCode(c.charCodeAt(0)+(c.toLowerCase()<='m'?13:-13))),depth+1);
    else add('DECODE_BUDGET','HIGH',true);
  }
  return values;
}
