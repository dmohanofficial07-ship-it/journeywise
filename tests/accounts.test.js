import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalDB} from '../server/local-db.js';
import {createLocalAuth} from '../server/local-auth.js';
import {hostedIdentity} from '../server/accounts.js';
const details={name:'Alice Test',email:'alice@example.com',password:'test account password long enough'};
const req=(action,body,cookie='',origin='http://localhost')=>new Request('http://localhost/api/auth/'+action,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},body:JSON.stringify(body)});
const sessionCookie=r=>r.headers.get('set-cookie').split(';')[0];
async function setup(t){const db=await openLocalDB(':memory:');t.after(()=>db.close());return {db,auth:createLocalAuth(db)}}
test('registration hashes passwords, sets an HttpOnly session and never returns credentials',async t=>{
 const {db,auth}=await setup(t),r=await auth.route(req('register',details));assert.equal(r.status,201);const text=await r.text();assert.ok(!text.includes(details.password));assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
 const saved=await db.prepare('SELECT * FROM local_credentials WHERE email=?').bind(details.email).first();assert.notEqual(saved.password_hash,details.password);assert.equal(saved.password_hash.length,64);assert.equal(saved.salt.length,32);
 const session=await db.prepare('SELECT * FROM local_sessions WHERE account_id=?').bind(saved.account_id).first();assert.ok(!sessionCookie(r).includes(session.token_hash));
 assert.equal((await auth.identity(req('login',{},sessionCookie(r)))).user.email,details.email);
});
test('sign-in normalizes email, rotates sessions, rejects bad passwords and logout revokes access',async t=>{
 const {auth}=await setup(t),registered=await auth.route(req('register',details)),old=sessionCookie(registered);
 const wrong=await auth.route(req('login',{email:details.email,password:'incorrect password'}));assert.equal(wrong.status,401);
 const unknown=await auth.route(req('login',{email:'missing@example.com',password:'incorrect password'}));assert.equal(await wrong.text(),await unknown.text());
 const signedIn=await auth.route(req('login',{email:' ALICE@EXAMPLE.COM ',password:details.password},old));assert.equal(signedIn.status,200);const current=sessionCookie(signedIn);assert.notEqual(current,old);
 assert.equal((await auth.identity(req('login',{},old))).user,null);
 const logout=await auth.route(req('logout',{},current));assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);assert.equal((await auth.identity(req('login',{},current))).user,null);
});
test('duplicate and weak registrations, cross-origin requests and identity injection are rejected',async t=>{
 const {db,auth}=await setup(t);
 assert.equal((await auth.route(req('register',{...details,password:'short'}))).status,400);
 assert.equal((await auth.route(req('register',details,'','https://evil.example'))).status,403);
 assert.equal((await auth.route(req('register',{...details,id:'someone-else'}))).status,400);
 assert.equal((await auth.route(req('register',details))).status,201);
 assert.equal((await auth.route(req('register',details))).status,409);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM accounts').bind().first()).n,1);
 const forged=req('login',{});forged.headers.set('oai-authenticated-user-id','forged');assert.equal((await auth.identity(forged)).user,null);
});
test('expired sessions and forged cookie values never authenticate',async t=>{
 const {db,auth}=await setup(t);const r=await auth.route(req('register',details));const late=createLocalAuth(db,{now:()=>Date.now()+8*86400000});assert.equal((await late.identity(req('login',{},sessionCookie(r)))).user,null);assert.equal((await auth.identity(req('login',{},'rev_local_session=forged'))).user,null);
});
test('authentication throttling persists across auth service restarts',async t=>{
 const {db,auth}=await setup(t);
 for(let i=0;i<10;i++)assert.equal((await auth.route(req('login',{email:details.email,password:'incorrect'}))).status,401);
 const next=createLocalAuth(db);assert.equal((await next.route(req('login',{email:details.email,password:'incorrect'}))).status,429);
});
test('hosted identity uses a stable namespaced ID and safely decodes names',()=>{
 const request=new Request('https://example.test',{headers:{'oai-authenticated-user-id':'user-id','oai-authenticated-user-email':'person@example.com','oai-authenticated-user-full-name':'Mohan%20Test','oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8'}});
 assert.deepEqual(hostedIdentity(request),{mode:'chatgpt',user:{id:'chatgpt:user-id',provider:'chatgpt',email:'person@example.com',name:'Mohan Test'}});
 request.headers.delete('oai-authenticated-user-email');assert.equal(hostedIdentity(request).user,null);
});
