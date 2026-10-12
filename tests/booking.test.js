import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.js';
import {openLocalDB} from '../server/local-db.js';
import {signReference} from '../server/offer-reference.js';
import {indiaToday,addDays} from '../public/engine.js';
const time=Date.now(),query={from:'Bengaluru',to:'Chennai',date:addDays(indiaToday(),14),travellers:1,source:'duffel'};
const passenger={given_name:'Test',family_name:'Traveller',title:'ms',gender:'f',born_on:'1990-01-01',email:'test@example.com',phone_number:'+12025550100'};
const baseEnv={DUFFEL_ACCESS_TOKEN:'duffel_test_fixture',DUFFEL_MODE:'sandbox',OFFER_SIGNING_SECRET:'test-signing-secret-at-least-thirty-two-characters',ENABLE_SANDBOX_BOOKING:'true'};
function rawOffer(amount='50.00'){
 return {id:'off_fixture',live_mode:false,total_currency:'USD',total_amount:amount,base_currency:'USD',base_amount:amount,tax_currency:'USD',tax_amount:'0.00',expires_at:new Date(time+1800000).toISOString(),passengers:[{id:'pas_fixture',type:'adult'}],passenger_identity_documents_required:false,slices:[{duration:'PT1H',segments:[{origin:{iata_code:'BLR',time_zone:'Asia/Kolkata'},destination:{iata_code:'MAA',time_zone:'Asia/Kolkata'},departing_at:query.date+'T08:00:00',arriving_at:query.date+'T09:00:00',operating_carrier:{name:'Test Airways',iata_code:'TA'},operating_carrier_flight_number:'1',passengers:[{cabin_class:'economy',baggages:[]}]}]}]};
}
const res=data=>new Response(JSON.stringify({data}));
function req(path,body){return new Request('http://localhost/api/bookings/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}
async function setup(t,options={}){
 const DB=await openLocalDB(':memory:');t.after(()=>DB.close());const env={...baseEnv,DB};
 const state={posts:0,reads:0,amount:'50.00',order:null,requests:[]};
 const fetchImpl=async(url,init)=>{
   state.requests.push({url,init});
   if(url.includes('/air/offers/'))return res(rawOffer(state.amount));
   if(url.includes('/air/orders?')){state.reads++;return res(state.order?[state.order]:[])}
   state.posts++;const body=JSON.parse(init.body).data;state.order={id:'ord_fixture',offer_id:'off_fixture',booking_reference:'TEST42',live_mode:false,total_amount:state.amount,total_currency:'USD',metadata:body.metadata,slices:rawOffer().slices,payment_status:{awaiting_payment:false},cancellation:null};
   if(options.timeout)throw Error('network lost');
   if(options.rejected)return new Response('{}',{status:422});
   if(options.liveResponse)state.order.live_mode=true;
   return res(state.order);
 };
 const create=()=>createApp({now:()=>time,fetchImpl,bookingTimeoutMs:20});
 const app=create();const reference=await signReference({v:1,id:'off_fixture',query,mode:'sandbox',expires:time+600000,totalMinor:5000,currency:'USD'},env.OFFER_SIGNING_SECRET);
 const prepare=async(passengers=[passenger])=>app.fetch(req('prepare',{reference,passengers}),env);
 const review=await prepare();assert.equal(review.status,200);const data=await review.json();
 const payload={checkoutToken:data.checkoutToken,passengers:[passenger],confirmed:true};
 return {DB,env,state,app,prepare,data,payload,create,reference};
}
test('prepare shows refreshed total and does not create an order; token contains no passenger PII',async t=>{
 const c=await setup(t);assert.equal(c.state.posts,0);assert.equal(c.data.offer.total,50);
 const tokenBody=Buffer.from(c.data.checkoutToken.split('.')[0],'base64url').toString();assert.ok(!tokenBody.includes(passenger.email));assert.ok(!tokenBody.includes(passenger.born_on));
 c.state.amount='55.00';const r=await(await c.prepare()).json();assert.equal(r.changed,true);assert.equal(r.offer.total,55);
});
test('booking rejects live credentials, disabled flag, missing DB and live environment before upstream writes',async t=>{
 const c=await setup(t);
 for(const override of [{DUFFEL_ACCESS_TOKEN:'duffel_live_bad'},{DUFFEL_MODE:'live',ENABLE_LIVE_SEARCH:'true'},{ENABLE_SANDBOX_BOOKING:'false'},{DB:undefined}]){
  assert.equal((await c.app.fetch(req('confirm',c.payload),{...c.env,...override})).status,403);
 }assert.equal(c.state.posts,0);
});
test('passenger validation catches impossible dates, underage adults, duplicates, invalid contact and extra fields',async t=>{
 const c=await setup(t);
 const underage=(Number(query.date.slice(0,4))-17)+query.date.slice(4);
 for(const p of [{...passenger,born_on:underage},{...passenger,born_on:'1990-02-30'},{...passenger,phone_number:'123'},{...passenger,email:'invalid'},{...passenger,given_name:'<img>'},{...passenger,card_number:'123'}]){
  assert.equal((await c.prepare([p])).status,400);
 }assert.equal((await c.prepare([])).status,400);assert.equal(c.state.posts,0);
});
test('consent, passenger changes, tampering and expired reviews cannot place orders',async t=>{
 const c=await setup(t);
 assert.equal((await c.app.fetch(req('confirm',{...c.payload,confirmed:false}),c.env)).status,400);
 assert.equal((await c.app.fetch(req('confirm',{...c.payload,passengers:[{...passenger,given_name:'Other'}]}),c.env)).status,409);
 assert.equal((await c.app.fetch(req('confirm',{...c.payload,checkoutToken:c.payload.checkoutToken+'x'}),c.env)).status,400);
 const late=createApp({now:()=>time+600001,fetchImpl:async()=>{throw Error('must not call')}});
 assert.equal((await late.fetch(req('confirm',c.payload),c.env)).status,410);assert.equal(c.state.posts,0);
});
test('price changed after review requires a new review with no order submitted',async t=>{
 const c=await setup(t);c.state.amount='55.00';const r=await c.app.fetch(req('confirm',c.payload),c.env);assert.equal(r.status,409);assert.equal((await r.json()).error.code,'QUOTE_CHANGED');assert.equal(c.state.posts,0);
});
test('concurrent confirms create one order and use provider passenger IDs and exact amount',async t=>{
 const c=await setup(t);const responses=await Promise.all([c.app.fetch(req('confirm',c.payload),c.env),c.app.fetch(req('confirm',c.payload),c.env)]);assert.ok(responses.every(r=>[200,202].includes(r.status)));assert.equal(c.state.posts,1);
 const confirmation=await(await c.app.fetch(req('status',{checkoutToken:c.payload.checkoutToken}),c.env)).json();assert.equal(confirmation.status,'confirmed');assert.equal(confirmation.receipt.bookingReference,'TEST42');
 const posted=JSON.parse(c.state.requests.find(r=>r.url.endsWith('/orders')).init.body).data;assert.equal(posted.passengers[0].id,'pas_fixture');assert.deepEqual(posted.payments,[{type:'balance',currency:'USD',amount:'50.00'}]);
});
test('durable attempt survives a new app instance and expiry; does not resubmit',async t=>{
 const c=await setup(t);await c.app.fetch(req('confirm',c.payload),c.env);
 const another=c.create();const r=await another.fetch(req('confirm',c.payload),c.env);assert.equal((await r.json()).status,'confirmed');assert.equal(c.state.posts,1);
 const raw=await c.DB.prepare('SELECT * FROM booking_attempts WHERE intent_id = ?').bind(JSON.parse(Buffer.from(c.payload.checkoutToken.split('.')[0],'base64url')).intent).first();assert.ok(!JSON.stringify(raw).includes(passenger.email));
});
test('lost response reconciles by offer and metadata instead of reposting',async t=>{
 const c=await setup(t,{timeout:true});const r=await c.app.fetch(req('confirm',c.payload),c.env);assert.equal(r.status,202);assert.equal((await r.json()).status,'unknown');
 const recovered=await(await c.create().fetch(req('status',{checkoutToken:c.payload.checkoutToken}),c.env)).json();assert.equal(recovered.status,'confirmed');assert.equal(c.state.posts,1);assert.equal(c.state.reads,1);
});
test('unresolved timeout never retries an order and unrelated orders do not disclose a receipt',async t=>{
 const c=await setup(t,{timeout:true});await c.app.fetch(req('confirm',c.payload),c.env);c.state.order.metadata.rev_intent='someone-else';
 const recovered=await(await c.app.fetch(req('confirm',c.payload),c.env)).json();assert.equal(recovered.status,'unknown');assert.equal(recovered.receipt,null);assert.equal(c.state.posts,1);
});
test('definitive rejection remains rejected on repeated confirms',async t=>{
 const c=await setup(t,{rejected:true});assert.equal((await(await c.app.fetch(req('confirm',c.payload),c.env)).json()).status,'rejected');await c.app.fetch(req('confirm',c.payload),c.env);assert.equal(c.state.posts,1);
});
test('a live or unpaid provider response is never shown as confirmed',async t=>{
 const c=await setup(t,{liveResponse:true});const r=await(await c.app.fetch(req('confirm',c.payload),c.env)).json();assert.equal(r.status,'unknown');assert.equal(r.receipt,null);
});
test('storage failure prevents writes; cross-origin confirmation is rejected',async t=>{
 const c=await setup(t);const badEnv={...c.env,DB:{prepare(){throw Error('disk unavailable')}}};
 assert.equal((await c.app.fetch(req('confirm',c.payload),badEnv)).status,503);assert.equal(c.state.posts,0);
 const r=req('confirm',c.payload);r.headers.set('Origin','https://other.example');assert.equal((await c.app.fetch(r,c.env)).status,403);
});
