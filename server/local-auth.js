// Local-only test accounts. This module is never imported by the hosted Worker.
import {randomBytes,randomUUID,scrypt,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {ApiError,readJson} from './errors.js';
const derive=promisify(scrypt),cookieName='rev_local_session',lifetime=7*86400000;
const hash=value=>createHash('sha256').update(value).digest('hex');
const cookieToken=request=>request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
const headers={'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const response=(data,status=200,cookie)=>new Response(JSON.stringify(data),{status,headers:{...headers,...(cookie?{'Set-Cookie':cookie}:{})}});
const passwordHash=(password,salt)=>derive(password,salt,32,{N:32768,r:8,p:3,maxmem:64*1024*1024});
const cookie=(token,maxAge)=>`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
function validate(body,register){
  const allowed=register?['email','password','name']:['email','password'];
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))throw new ApiError(400,'INVALID_ACCOUNT','Unexpected account fields.');
  const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))throw new ApiError(400,'INVALID_ACCOUNT','Enter a valid email address.');
  if(typeof body.password!=='string'||body.password.length>128||body.password.length<(register?15:1))throw new ApiError(400,'INVALID_ACCOUNT','Use a password between 15 and 128 characters.');
  const name=typeof body.name==='string'?body.name.trim():'';
  if(register&&(!name||name.length>100||/[\x00-\x1f\x7f]/.test(name)))throw new ApiError(400,'INVALID_ACCOUNT','Enter a name of up to 100 characters.');
  return {email,password:body.password,name};
}
export function createLocalAuth(db,{now=()=>Date.now()}={}){
  async function throttle(key,max){
    const time=now();
    const row=await db.prepare('INSERT INTO local_auth_limits (key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING attempts')
      .bind(key,time+15*60000,time,time).first();
    if(row.attempts>max)throw new ApiError(429,'AUTH_RATE_LIMITED','Too many sign-in attempts. Try again in 15 minutes.');
  }
  async function identity(request){
    const token=cookieToken(request);if(!/^[a-f0-9]{64}$/.test(token))return {mode:'local',user:null};
    const user=await db.prepare('SELECT a.id,a.name,a.email,a.provider FROM local_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?').bind(hash(token),now()).first();
    return {mode:'local',user:user||null};
  }
  async function route(request,ip='local'){
    const path=new URL(request.url).pathname;
    if(!['/api/auth/register','/api/auth/login','/api/auth/logout'].includes(path))return null;
    try{
      if(request.method!=='POST')return response({error:{code:'METHOD_NOT_ALLOWED',message:'Use POST.'}},405);
      if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')throw new ApiError(403,'ORIGIN_NOT_ALLOWED','Use the account form on this app.');
      if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new ApiError(415,'UNSUPPORTED_CONTENT_TYPE','Use application/json.');
      const body=await readJson(request);
      if(path.endsWith('/logout')){
        await db.prepare('DELETE FROM local_sessions WHERE token_hash=?').bind(hash(cookieToken(request))).run();
        return response({signedOut:true},200,cookie('',0));
      }
      await throttle('ip:'+hash(ip),30);
      const registering=path.endsWith('/register'),value=validate(body,registering);
      await throttle('email:'+hash(value.email),10);
      let accountId;
      if(registering){
        const salt=randomBytes(16).toString('hex'),derived=(await passwordHash(value.password,salt)).toString('hex');
        accountId='local:'+randomUUID();
        if(await db.prepare('SELECT account_id FROM local_credentials WHERE email=?').bind(value.email).first())throw new ApiError(409,'ACCOUNT_EXISTS','Unable to create this account. Try signing in with this email.');
        try{await db.batch([
          db.prepare('INSERT INTO accounts (id,provider,email,name,created_at) VALUES (?,?,?,?,?)').bind(accountId,'local',value.email,value.name,now()),
          db.prepare('INSERT INTO local_credentials (email,account_id,password_hash,salt) VALUES (?,?,?,?)').bind(value.email,accountId,derived,salt)
        ])}catch{throw new ApiError(409,'ACCOUNT_EXISTS','Unable to create this account. Try signing in with this email.');}
      }else{
        const saved=await db.prepare('SELECT * FROM local_credentials WHERE email=?').bind(value.email).first();
        const derived=await passwordHash(value.password,saved?.salt||'00000000000000000000000000000000');
        if(!timingSafeEqual(derived,Buffer.from(saved?.password_hash||'0'.repeat(64),'hex'))||!saved)throw new ApiError(401,'INVALID_CREDENTIALS','Email or password is incorrect.');
        accountId=saved.account_id;
      }
      const token=randomBytes(32).toString('hex');
      await db.batch([
        db.prepare('DELETE FROM local_sessions WHERE token_hash=? OR expires_at<=?').bind(hash(cookieToken(request)),now()),
        db.prepare('INSERT INTO local_sessions (token_hash,account_id,expires_at) VALUES (?,?,?)').bind(hash(token),accountId,now()+lifetime)
      ]);
      const user=await db.prepare('SELECT id,name,email FROM accounts WHERE id=?').bind(accountId).first();
      return response({user,mode:'local'},registering?201:200,cookie(token,lifetime/1000));
    }catch(e){return response({error:{code:e instanceof ApiError?e.code:'AUTH_UNAVAILABLE',message:e instanceof ApiError?e.message:'Sign-in is temporarily unavailable. Try again.'}},e instanceof ApiError?e.status:503);}
  }
  return {identity,route};
}
