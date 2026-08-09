import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source=fs.readFileSync(path.join(process.cwd(),'functions','index.js'),'utf8');
const start=source.indexOf('const MAX_PROOF_CHARS');
const end=source.indexOf('function portalRoleValue',start);
if(start<0||end<0)throw new Error('Payment-proof validation block not found');

class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
const sandbox={Buffer,HttpsError,process:{env:{}}};
vm.runInNewContext(`${source.slice(start,end)}\nresult={decodePaymentProof};`,sandbox);
const decode=sandbox.result.decodePaymentProof;

const jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10]).toString('base64');
const valid=decode(`data:image/jpeg;base64,${jpeg}`);
if(valid.contentType!=='image/jpeg'||valid.ext!=='jpg'||valid.bytes.length!==6)throw new Error('Valid JPEG proof was not decoded correctly');

let rejected=false;
try{decode(`data:image/jpeg;base64,${Buffer.from('not an image').toString('base64')}`);}catch(e){rejected=e.code==='invalid-argument';}
if(!rejected)throw new Error('Forged image payload was accepted');

rejected=false;
try{decode(`data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`);}catch(e){rejected=e.code==='invalid-argument';}
if(!rejected)throw new Error('Unsupported SVG proof was accepted');

rejected=false;
const oversized=Buffer.alloc(5000001);oversized[0]=0xff;oversized[1]=0xd8;oversized[2]=0xff;
try{decode(`data:image/jpeg;base64,${oversized.toString('base64')}`);}catch(e){rejected=e.code==='invalid-argument';}
if(!rejected)throw new Error('Oversized proof was accepted');

console.log('PASS: payment-proof type, signature, and size validation passed.');
