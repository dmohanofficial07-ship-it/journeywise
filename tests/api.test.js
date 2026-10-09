import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.js';
import {normalizeDuffelOffer,minorAmount} from '../server/providers/duffel.js';
import {signReference,verifyReference} from '../server/offer-reference.js';
import {indiaToday,addDays} from '../public/engine.js';
const now=Date.now();
const query={from:'Bengaluru',to:'Chennai',date:addDays(indiaToday(),1),travellers:2,source:'duffel'};
const env={DUFFEL_ACCESS_TOKEN:'fixture-token-never-live',DUFFEL_MODE:'sandbox',OFFER_SIGNING_SECRET:'fixture-only-signing-key-with-at-least-32-characters'};
function offer(overrides={}){
  return {id:'off_fixture1',live_mode:false,total_currency:'INR',total_amount:'6800.50',base_currency:'INR',base_amount:'6000.00',tax_currency:'INR',tax_amount:'800.50',expires_at:new Date(now+1800000).toISOString(),passengers:[{type:'adult'},{type:'adult'}],conditions:{refund_before_departure:{allowed:true,penalty_amount:'1000.00',penalty_currency:'INR'}},slices:[{duration:'PT1H5M',segments:[{origin:{iata_code:'BLR',time_zone:'Asia/Kolkata'},destination:{iata_code:'MAA',time_zone:'Asia/Kolkata'},departing_at:query.date+'T08:00:00',arriving_at:query.date+'T09:05:00',operating_carrier:{name:'Fixture Airways',iata_code:'FA'},operating_carrier_flight_number:'101',passengers:[{cabin_class:'economy',baggages:[{type:'checked',quantity:1}]},{cabin_class:'economy',baggages:[]}]}]}],...overrides};
}
function request(path,body,headers={}){return new Request('http://localhost'+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});}
const response=data=>new Response(JSON.stringify({data}),{headers:{'Content-Type':'application/json'}});
function appWithOffers(offers=[offer()]){return createApp({now:()=>now,fetchImpl:async()=>response({live_mode:false,offers})});}
test('provider totals are already for the whole group; preserve paise and operating carrier',()=>{
  const {offer:o}=normalizeDuffelOffer(offer(),query,'sandbox',now);
  assert.equal(o.totalMinor,680050);assert.equal(o.total,6800.50);assert.equal(o.travellers,2);assert.equal(o.provider,'Fixture Airways');
  assert.equal(o.dataMode,'sandbox');assert.equal(o.priceComplete,false);assert.equal(o.bookingEnabled,false);
  assert.equal(o.baggageAllowances[1].allowances.length,0);assert.equal(o.departingAt,query.date+'T08:00:00+05:30');
});
test('monetary parsing does not invent conversions or lose precision',()=>{
  assert.equal(minorAmount('10.05','INR'),1005);assert.equal(minorAmount('10.005','INR'),null);
  assert.equal(minorAmount('10.005','KWD'),10005);assert.equal(minorAmount('100','JPY'),100);
  assert.equal(minorAmount('-1','INR'),null);assert.equal(minorAmount('5','XXX'),null);assert.equal(minorAmount('Infinity','INR'),null);
});
test('expiry, wrong passengers, routes and currency are excluded',()=>{
  assert.equal(normalizeDuffelOffer(offer({expires_at:new Date(now-1).toISOString()}),query,'sandbox',now).reason,'expired');
  assert.equal(normalizeDuffelOffer(offer({passengers:[{type:'adult'}]}),query,'sandbox',now).reason,'passenger_mismatch');
  assert.equal(normalizeDuffelOffer(offer({total_currency:'XXX'}),query,'sandbox',now).reason,'unsupported_currency');
  const wrong=offer();wrong.slices[0].segments[0].origin.iata_code='BOM';
  assert.equal(normalizeDuffelOffer(wrong,query,'sandbox',now).reason,'route_mismatch');
});
test('incomplete breakdown is explicit; supplier total remains authoritative',()=>{
  const o=normalizeDuffelOffer(offer({base_amount:null,tax_amount:null}),query,'sandbox',now).offer;
  assert.equal(o.base,null);assert.equal(o.tax,null);assert.equal(o.breakdownReconciled,false);assert.equal(o.total,6800.5);
});
test('provider mode mismatch fails closed',()=>{
  assert.throws(()=>normalizeDuffelOffer(offer({live_mode:true}),query,'sandbox',now),e=>e.code==='PROVIDER_MODE_MISMATCH');
});
test('missing credentials never call provider or return sample fares',async()=>{
  let calls=0;const app=createApp({fetchImpl:async()=>{calls++;throw Error('unexpected')}});
  const res=await app.fetch(request('/api/search',query),{});const body=await res.json();
  assert.equal(res.status,503);assert.equal(body.error.code,'PROVIDER_NOT_CONFIGURED');assert.equal(calls,0);assert.equal(body.offers,undefined);
});
test('live searches need an explicit enable flag',async()=>{
  const res=await createApp().fetch(request('/api/search',query),{...env,DUFFEL_MODE:'live'});assert.equal(res.status,503);
});
test('sample mode is served by API and never calls provider',async()=>{
  const app=createApp({fetchImpl:async()=>{throw Error('unexpected')}});
  const res=await app.fetch(request('/api/search',{...query,source:'sample'}));const data=await res.json();
  assert.equal(res.status,200);assert.equal(data.dataMode,'sample');assert.equal(data.offers.find(o=>o.id==='rail-saver').total,1048);
  assert.ok(data.offers.every(o=>o.dataMode==='sample'));
});
test('query rejects unexpected fields, invalid dates, passenger coercion and identical cities',async()=>{
  const app=createApp();
  for(const body of [{...query,apiKey:'oops'},{...query,travellers:'2'},{...query,to:query.from},{...query,date:'2027-02-30'},{...query,source:'unknown'},null]){
    const res=await app.fetch(request('/api/search',body));assert.equal(res.status,400);
  }
});
test('provider request is fixed to approved endpoint and uses server-side authorization',async()=>{
  let received;const app=createApp({now:()=>now,fetchImpl:async(url,init)=>{received={url,init};return response({live_mode:false,offers:[offer()]});}});
  const res=await app.fetch(request('/api/search',query),env);const body=await res.json();
  assert.equal(res.status,200);assert.equal(received.url,'https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=12000');
  assert.equal(received.init.headers.Authorization,'Bearer '+env.DUFFEL_ACCESS_TOKEN);
  const submitted=JSON.parse(received.init.body).data;assert.equal(submitted.slices[0].origin,'BLR');assert.equal(submitted.passengers.length,2);assert.equal(submitted.max_connections,0);
  assert.equal(body.offers[0].total,6800.5);assert.ok(body.offers[0].reference);assert.ok(!JSON.stringify(body).includes(env.DUFFEL_ACCESS_TOKEN));
});
test('provider failure, malformed JSON and timeout are surfaced without secrets',async()=>{
  for(const [status,code] of [[401,'PROVIDER_ACCESS_ERROR'],[429,'PROVIDER_BUSY'],[500,'PROVIDER_ERROR']]){
    const app=createApp({fetchImpl:async()=>new Response('secret-provider-diagnostic',{status})});const res=await app.fetch(request('/api/search',query),env);const text=await res.text();assert.equal(JSON.parse(text).error.code,code);assert.ok(!text.includes('secret-provider'));
  }
  const malformed=createApp({fetchImpl:async()=>new Response('not-json')});assert.equal((await malformed.fetch(request('/api/search',query),env)).status,502);
  const timed=createApp({timeoutMs:5,fetchImpl:async(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))))});
  const res=await timed.fetch(request('/api/search',query),env);assert.equal(res.status,504);assert.equal((await res.json()).error.code,'PROVIDER_TIMEOUT');
});
test('invalid and expired offers produce truthful exclusions, not fabricated replacements',async()=>{
  const app=appWithOffers([offer({expires_at:new Date(now-1).toISOString()}),offer({id:'off_other',total_currency:'XXX'})]);
  const body=await(await app.fetch(request('/api/search',query),env)).json();assert.equal(body.offers.length,0);assert.equal(body.excluded.expired,1);assert.equal(body.excluded.unsupported_currency,1);
});
test('quote references reject tampering and expiry',async()=>{
  const payload={v:1,id:'off_fixture1',query,mode:'sandbox',expires:now+1000,totalMinor:680050,currency:'INR'};
  const ref=await signReference(payload,env.OFFER_SIGNING_SECRET);
  assert.equal((await verifyReference(ref,env.OFFER_SIGNING_SECRET,now)).id,payload.id);
  await assert.rejects(verifyReference(ref+'x',env.OFFER_SIGNING_SECRET,now),e=>e.code==='INVALID_OFFER_REFERENCE');
  await assert.rejects(verifyReference(ref,env.OFFER_SIGNING_SECRET,now+1001),e=>e.code==='OFFER_EXPIRED');
});
test('refresh checks server-signed offer, detects changed amount, and never orders tickets',async()=>{
  const calls=[];const app=createApp({now:()=>now,fetchImpl:async(url)=>{calls.push(url);return url.includes('offer_requests')?response({live_mode:false,offers:[offer()]}):response(offer({total_amount:'7000.50',base_amount:'6200.00'}));}});
  const searched=await(await app.fetch(request('/api/search',query),env)).json();
  const res=await app.fetch(request('/api/offers/refresh',{reference:searched.offers[0].reference}),env);const refreshed=await res.json();
  assert.equal(res.status,200);assert.equal(refreshed.changed,true);assert.equal(refreshed.offer.total,7000.5);
  assert.ok(calls[1].endsWith('/air/offers/off_fixture1?return_available_services=true'));assert.ok(calls.every(url=>!url.includes('/orders')));
  const bad=await app.fetch(request('/api/offers/refresh',{reference:searched.offers[0].reference,total:1}),env);assert.equal(bad.status,400);assert.equal(calls.length,2);
});
test('HTTP boundaries: same-origin, content type, methods and body size',async()=>{
  const app=createApp();
  assert.equal((await app.fetch(request('/api/search',query,{Origin:'https://evil.example'}))).status,403);
  assert.equal((await app.fetch(new Request('http://localhost/api/search'))).status,405);
  assert.equal((await app.fetch(new Request('http://localhost/api/search',{method:'POST',body:'{}'}))).status,415);
  assert.equal((await app.fetch(request('/api/search',{...query,large:'a'.repeat(10000)}))).status,413);
  assert.equal((await app.fetch(request('/api/book',{}))).status,404);
});
test('burst limit bounds upstream work; status never exposes secret values',async()=>{
  const app=createApp({rateLimit:1});await app.fetch(request('/api/search',{...query,source:'sample'}));const res=await app.fetch(request('/api/search',{...query,source:'sample'}));assert.equal(res.status,429);assert.equal(res.headers.get('Retry-After'),'60');
  const status=await app.fetch(new Request('http://localhost/api/providers'),env);const text=await status.text();assert.ok(!text.includes(env.DUFFEL_ACCESS_TOKEN));assert.ok(!text.includes(env.OFFER_SIGNING_SECRET));assert.equal(JSON.parse(text).providers[1].enabled,true);
});
