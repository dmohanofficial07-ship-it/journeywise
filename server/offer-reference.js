import {ApiError} from './errors.js';
const encoder=new TextEncoder();
const encode=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const decode=text=>Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
async function key(secret){return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function signReference(payload,secret){const body=encode(encoder.encode(JSON.stringify(payload)));const signature=await crypto.subtle.sign('HMAC',await key(secret),encoder.encode(body));return body+'.'+encode(new Uint8Array(signature));}
export async function verifyReference(reference,secret,now=Date.now()){
  const invalid=()=>new ApiError(400,'INVALID_OFFER_REFERENCE','The offer reference is invalid. Search again.');
  if(typeof reference!=='string'||reference.length>4096||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(reference))throw invalid();
  try{const [body,signature]=reference.split('.');if(!await crypto.subtle.verify('HMAC',await key(secret),decode(signature),encoder.encode(body)))throw invalid();const p=JSON.parse(new TextDecoder().decode(decode(body)));
    if(p.v!==1||typeof p.id!=='string'||!/^off_[A-Za-z0-9]+$/.test(p.id)||!p.query||!['sandbox','live'].includes(p.mode)||!Number.isFinite(p.expires)||!Number.isSafeInteger(p.totalMinor)||typeof p.currency!=='string')throw invalid();
    if(p.expires<=now)throw new ApiError(410,'OFFER_EXPIRED','This quote has expired. Search again for current fares.');
    return p;
  }catch(e){if(e instanceof ApiError)throw e;throw invalid();}
}
