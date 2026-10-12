import {ApiError,readJson} from './errors.js';
import {providerConfig,validateSearch} from './query.js';
import {signReference,verifyReference,verifySignedPayload} from './offer-reference.js';
import {createDuffel,minorAmount} from './providers/duffel.js';
import {bookingStore} from './booking-store.js';
const fail=(status,code,message)=>{throw new ApiError(status,code,message)};
export function sandboxBookingEnabled(env){return providerConfig(env).enabled&&env.DUFFEL_MODE==='sandbox'&&env.DUFFEL_ACCESS_TOKEN?.startsWith('duffel_test_')&&env.ENABLE_SANDBOX_BOOKING==='true'&&!!env.DB}
function guard(env){if(!sandboxBookingEnabled(env))fail(403,'SANDBOX_BOOKING_DISABLED','Test booking is unavailable. Only an enabled Duffel sandbox connection can create test bookings.')}
function fields(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail(400,'INVALID_BOOKING','Unexpected booking fields.')}
export function validatePassengers(value,query){
  if(!Array.isArray(value)||value.length!==query.travellers)fail(400,'INVALID_PASSENGERS','Enter details for every adult.');
  const names=new Set();
  return value.map(p=>{
    fields(p,['given_name','family_name','born_on','title','gender','email','phone_number']);
    const clean={};for(const key of ['given_name','family_name','born_on','title','gender','email','phone_number']){if(typeof p[key]!=='string')fail(400,'INVALID_PASSENGERS','Complete every passenger field.');clean[key]=p[key].trim()}
    for(const key of ['given_name','family_name'])if(!/^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,79}$/u.test(clean[key]))fail(400,'INVALID_PASSENGERS','Use passenger names containing letters, spaces, apostrophes or hyphens.');
    if(!['mr','ms','mrs','miss','dr'].includes(clean.title)||!['m','f'].includes(clean.gender))fail(400,'INVALID_PASSENGERS','Choose a supported title and document gender.');
    const dob=clean.born_on;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(dob)||!Number.isFinite(Date.parse(dob))||new Date(dob).toISOString().slice(0,10)!==dob)fail(400,'INVALID_PASSENGERS','Enter a valid date of birth.');
    const age=Number(query.date.slice(0,4))-Number(dob.slice(0,4))-(query.date.slice(5)<dob.slice(5)?1:0);
    if(age<18||age>120)fail(400,'INVALID_PASSENGERS','This flow supports adults aged 18 or older on departure, up to age 120.');
    if(clean.email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(clean.email))fail(400,'INVALID_PASSENGERS','Enter a valid passenger email address.');
    if(!/^\+[1-9]\d{7,14}$/.test(clean.phone_number))fail(400,'INVALID_PASSENGERS','Use an international phone number, such as +919876543210.');
    const name=(clean.given_name+' '+clean.family_name).toLowerCase();if(names.has(name))fail(400,'INVALID_PASSENGERS','Each passenger must have a distinct name.');names.add(name);
    return clean;
  });
}
async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('')}
const trip=offer=>({from:offer.from,to:offer.to,date:offer.date,departingAt:offer.departingAt,arrivingAt:offer.arrivingAt,operatingCarrier:offer.operatingCarrier,flightNumber:offer.flightNumber,travellers:offer.travellers,baggage:offer.baggageAllowances,cancellation:offer.cancellationRule});
async function token(value,env,now){const p=await verifySignedPayload(value,env.OFFER_SIGNING_SECRET);if(p.purpose!=='sandbox_booking'||p.mode!=='sandbox'||!/^off_[A-Za-z0-9]+$/.test(p.id)||typeof p.intent!=='string'||!p.query||!Number.isFinite(p.recoverUntil)||p.recoverUntil<now)fail(400,'INVALID_CHECKOUT','This booking session is invalid or too old.');return p}
function publicState(row){return {status:row.state==='pending'?'unknown':row.state,receipt:row.receipt?JSON.parse(row.receipt):null,attemptId:row.intent_id}}
function receipt(raw,p){
  if(raw?.live_mode!==false||raw.offer_id!==p.id||raw.metadata?.rev_intent!==p.intent||typeof raw.id!=='string'||!raw.id.startsWith('ord_')||typeof raw.booking_reference!=='string'||!raw.booking_reference||raw.cancellation||raw.cancelled_at||raw.payment_status?.awaiting_payment!==false)return null;
  if(minorAmount(raw.total_amount,raw.total_currency)!==p.totalMinor||raw.total_currency!==p.currency)return null;
  if(!Array.isArray(raw.slices)||raw.slices.length!==1||raw.slices[0]?.segments?.length!==1)return null;
  const s=raw.slices[0].segments[0];if(!s.operating_carrier?.name||!s.origin?.iata_code||!s.destination?.iata_code||!s.departing_at||!s.arriving_at)return null;
  return {dataMode:'sandbox',orderId:raw.id,bookingReference:raw.booking_reference,total:Number(raw.total_amount),currency:raw.total_currency,travellers:p.query.travellers,itinerary:{from:s.origin.iata_code,to:s.destination.iata_code,departingAt:s.departing_at,arrivingAt:s.arriving_at,operatingCarrier:s.operating_carrier.name,flightNumber:[s.operating_carrier.iata_code,s.operating_carrier_flight_number].filter(Boolean).join(' ')},message:'Test booking only. No real ticket or payment.'};
}
export function createBookingService(env,{fetchImpl=fetch,now=()=>Date.now(),timeoutMs=45000}={}){
  const provider=createDuffel(env,{fetchImpl,now});const store=()=>bookingStore(env.DB);
  async function orderRequest(path,body){
    guard(env);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{const r=await fetchImpl('https://api.duffel.com'+path,{method:body?'POST':'GET',redirect:'error',headers:{Accept:'application/json','Content-Type':'application/json','Duffel-Version':'v2',Authorization:'Bearer '+env.DUFFEL_ACCESS_TOKEN},body:body?JSON.stringify({data:body}):undefined,signal:controller.signal});let data;try{data=await readJson(r,8*1024*1024)}catch{return {status:r.status,data:null}}return {status:r.status,data:data.data}}
    catch{return {status:0,data:null}}finally{clearTimeout(timer)}
  }
  async function reconcile(row,p){
    if(['confirmed','rejected'].includes(row.state))return publicState(row);
    // A read can recover an ambiguous write; an empty result never permits resubmission.
    const r=await orderRequest('/air/orders?offer_id='+encodeURIComponent(p.id)+'&limit=200');
    const matching=Array.isArray(r.data)?r.data.filter(o=>o.metadata?.rev_intent===p.intent):[];
    const result=matching.length===1?receipt(matching[0],p):null;
    if(result){await store().save(p.intent,'confirmed',result);return {status:'confirmed',receipt:result,attemptId:p.intent}}
    return {status:'unknown',receipt:null,attemptId:p.intent};
  }
  return {
    async prepare(body){
      guard(env);fields(body,['reference','passengers']);
      const previous=await verifyReference(body.reference,env.OFFER_SIGNING_SECRET,now());
      if(previous.mode!=='sandbox'||previous.query.source!=='duffel')fail(403,'SANDBOX_ONLY','Only sandbox flight offers can be booked.');
      const query=validateSearch(previous.query,new Date(now()));const passengers=validatePassengers(body.passengers,query);
      const {offer,raw}=await provider.bookingOffer(previous.id,query);
      if(raw.passenger_identity_documents_required)fail(409,'UNSUPPORTED_BOOKING','This offer requires identity documents. Choose another test offer.');
      const p={v:1,purpose:'sandbox_booking',mode:'sandbox',id:offer.id,intent:crypto.randomUUID(),query,expires:Math.min(now()+5*60000,Date.parse(offer.expiresAt)),recoverUntil:now()+7*86400000,totalMinor:offer.totalMinor,currency:offer.currency,passengerHash:await digest(passengers),tripHash:await digest(trip(offer))};
      offer.reference=await signReference({v:1,id:offer.id,query,mode:'sandbox',expires:Date.parse(offer.expiresAt),totalMinor:offer.totalMinor,currency:offer.currency},env.OFFER_SIGNING_SECRET);
      return {checkoutToken:await signReference(p,env.OFFER_SIGNING_SECRET),offer,changed:previous.totalMinor!==offer.totalMinor||previous.currency!==offer.currency,expiresAt:new Date(p.expires).toISOString()};
    },
    async confirm(body){
      guard(env);fields(body,['checkoutToken','passengers','confirmed']);
      if(body.confirmed!==true)fail(400,'CONFIRMATION_REQUIRED','Review and explicitly confirm the test booking.');
      const p=await token(body.checkoutToken,env,now());const passengers=validatePassengers(body.passengers,p.query);
      if(await digest(passengers)!==p.passengerHash)fail(409,'PASSENGERS_CHANGED','Passenger details changed. Review the booking again.');
      const existing=await store().get(p.intent);if(existing)return reconcile(existing,p);
      if(p.expires<=now())fail(410,'CHECKOUT_EXPIRED','The review has expired. Review the latest quote again.');
      const {offer,raw}=await provider.bookingOffer(p.id,p.query);
      if(offer.totalMinor!==p.totalMinor||offer.currency!==p.currency||await digest(trip(offer))!==p.tripHash)fail(409,'QUOTE_CHANGED','The price, itinerary or fare conditions changed. Review the latest quote before confirming.');
      if(raw.passenger_identity_documents_required||raw.passengers.some(x=>typeof x.id!=='string'||!/^pas_[A-Za-z0-9]+$/.test(x.id)))fail(409,'UNSUPPORTED_BOOKING','This test offer cannot be booked in this flow.');
      if(!await store().claim(p,now())){const row=await store().get(p.intent);if(row)return reconcile(row,p);fail(409,'OFFER_ALREADY_ATTEMPTED','A booking was already attempted for this offer. Check its existing status in Duffel.')}
      // Claim is durable before sending; never retry this POST, including after a restart.
      const response=await orderRequest('/air/orders',{type:'instant',selected_offers:[p.id],passengers:passengers.map((x,i)=>({...x,id:raw.passengers[i].id})),payments:[{type:'balance',currency:raw.total_currency,amount:raw.total_amount}],metadata:{rev_intent:p.intent}});
      const result=response.status>=200&&response.status<300?receipt(response.data,p):null;
      const state=result?'confirmed':([400,401,403,404,422,429,503].includes(response.status)?'rejected':'unknown');
      await store().save(p.intent,state,result);
      return {status:state,receipt:result,attemptId:p.intent};
    },
    async status(body){
      guard(env);fields(body,['checkoutToken']);const p=await token(body.checkoutToken,env,now());const row=await store().get(p.intent);
      return row?reconcile(row,p):{status:'not_submitted',receipt:null,attemptId:p.intent};
    }
  };
}
