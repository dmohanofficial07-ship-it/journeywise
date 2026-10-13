import {ApiError} from './errors.js';

// Only the hosted Worker calls this, behind Sites' authenticated dispatch.
// Local HTTP requests are resolved from opaque sessions instead of these headers.
export function hostedIdentity(request){
  const id=request.headers.get('oai-authenticated-user-id');
  const email=request.headers.get('oai-authenticated-user-email');
  if(!id||!email)return {mode:'chatgpt',user:null};
  let name=email;
  if(request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8'){
    try{name=decodeURIComponent(request.headers.get('oai-authenticated-user-full-name')||'')||email}catch{}
  }
  return {mode:'chatgpt',user:{id:'chatgpt:'+id,provider:'chatgpt',email:email.slice(0,254),name:name.slice(0,100)}};
}

export async function requireAccount(identity,env,now=Date.now()){
  const user=identity?.user;
  if(!user?.id)throw new ApiError(401,'SIGN_IN_REQUIRED','Sign in to access your bookings.');
  if(!env.DB)throw new ApiError(503,'ACCOUNT_STORAGE_UNAVAILABLE','Accounts are temporarily unavailable.');
  try{
    await env.DB.prepare('INSERT INTO accounts (id,provider,email,name,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name')
      .bind(user.id,user.provider,user.email,user.name,now).run();
  }catch{throw new ApiError(503,'ACCOUNT_STORAGE_UNAVAILABLE','Accounts are temporarily unavailable.');}
  return {id:user.id,name:user.name,email:user.email};
}

export function authLinks(mode){
  return {mode,signInUrl:mode==='chatgpt'?'/signin-with-chatgpt?return_to=%2F':null,signOutUrl:mode==='chatgpt'?'/signout-with-chatgpt?return_to=%2F':null};
}
