import {createBookingService,sandboxBookingEnabled} from './booking.js';
import {ApiError,readJson} from './errors.js';
import {validateSearch,providerConfig,requireProvider,airports} from './query.js';
import {searchSampleFares} from '../public/engine.js';
import {createDuffel} from './providers/duffel.js';
import {signReference,verifyReference} from './offer-reference.js';
const security={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};
function json(value,status=200,headers={}){return new Response(JSON.stringify(value),{status,headers:{...security,...headers}});}
export function createApp({fetchImpl=fetch,now=()=>Date.now(),timeoutMs=18000,rateLimit=20,bookingTimeoutMs=45000}={}){
  // Per-instance burst protection. A public launch also requires a distributed gateway limit.
  const buckets=new Map();
  function limit(request){const id=request.headers.get('CF-Connecting-IP')||'local';const time=now();for(const [key,bucket] of buckets)if(bucket.until<=time)buckets.delete(key);if(!buckets.has(id)){if(buckets.size>=10000)throw new ApiError(429,'RATE_LIMITED','Too many requests. Please wait a minute.');buckets.set(id,{count:0,until:time+60000});}if(++buckets.get(id).count>rateLimit)throw new ApiError(429,'RATE_LIMITED','Too many requests. Please wait a minute.');}
  async function reference(offer,query,env){return signReference({v:1,id:offer.id,query,mode:offer.dataMode,expires:Math.min(Date.parse(offer.expiresAt),now()+10*60000),totalMinor:offer.totalMinor,currency:offer.currency},env.OFFER_SIGNING_SECRET);}
  return {async fetch(request,env={}){
    const requestId=crypto.randomUUID();
    try{
      const url=new URL(request.url);
      if(url.pathname==='/api/health'&&request.method==='GET')return json({status:'ok',service:'travel-search',version:'0.2.0'});
      if(url.pathname==='/api/providers'&&request.method==='GET')return json({providers:[{id:'sample',name:'Illustrative samples',enabled:true,mode:'sample',bookingEnabled:false},{...providerConfig(env),sandboxBookingEnabled:sandboxBookingEnabled(env)}],airports,bookingEnabled:false,sandboxBookingEnabled:sandboxBookingEnabled(env)});
      if(!['/api/search','/api/offers/refresh','/api/bookings/prepare','/api/bookings/confirm','/api/bookings/status'].includes(url.pathname))throw new ApiError(404,'NOT_FOUND','This endpoint does not exist.');
      if(request.method!=='POST')return json({error:{code:'METHOD_NOT_ALLOWED',message:'Use POST for this endpoint.'},requestId},405,{Allow:'POST'});
      if(request.headers.get('sec-fetch-site')==='cross-site'||(request.headers.get('origin')&&request.headers.get('origin')!==url.origin))throw new ApiError(403,'ORIGIN_NOT_ALLOWED','This request must come from the application.');
      if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw new ApiError(415,'UNSUPPORTED_CONTENT_TYPE','Use application/json.');
      limit(request);const body=await readJson(request);
      if(url.pathname.startsWith('/api/bookings/')){const service=createBookingService(env,{fetchImpl,now,timeoutMs:bookingTimeoutMs});const action=url.pathname.split('/').at(-1);const result=await service[action](body);return json({requestId,...result},result.status==='unknown'?202:200);}
      if(url.pathname==='/api/search'){
        const query=validateSearch(body,new Date(now()));const checkedAt=new Date(now()).toISOString();
        if(query.source==='sample'){const offers=searchSampleFares(query).map(o=>({...o,currency:'INR',totalMinor:o.total*100,dataMode:'sample',sourceProvider:'Sample data',checkedAt,expiresAt:null,bookingEnabled:false,priceComplete:true}));return json({requestId,query,dataMode:'sample',checkedAt,offers,providers:[{id:'sample',status:'ok',offerCount:offers.length}],excluded:{},warnings:['Illustrative fares and availability; no provider was contacted.']});}
        const config=requireProvider(env);const result=await createDuffel(env,{fetchImpl,now,timeoutMs}).search(query);
        const offers=await Promise.all(result.offers.map(async offer=>({...offer,reference:await reference(offer,query,env)})));
        return json({requestId,query,...result,offers,providers:[{id:'duffel',status:'ok',mode:config.mode,offerCount:offers.length}],warnings:[config.mode==='sandbox'?'Duffel test inventory. These are not live fares.':'One provider checked. This is not a search of every vendor.','Supplier quotes are not final checkout totals. Currency conversion is not performed.','Searches use an airline response timeout; coverage may be incomplete.',...(Object.keys(result.excluded).length?['Some expired, unsupported, or incomplete offers were excluded.']:[])]});
      }
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='reference'))throw new ApiError(400,'INVALID_OFFER_REFERENCE','Provide only the signed offer reference.');
      const config=requireProvider(env);const previous=await verifyReference(body.reference,env.OFFER_SIGNING_SECRET,now());
      if(previous.mode!==config.mode)throw new ApiError(409,'PROVIDER_MODE_MISMATCH','The provider environment changed. Search again.');
      const query=validateSearch(previous.query,new Date(now()));if(query.source!=='duffel')throw new ApiError(400,'INVALID_OFFER_REFERENCE','Invalid offer source.');
      const offer=await createDuffel(env,{fetchImpl,now,timeoutMs}).refresh(previous.id,query);
      return json({requestId,offer:{...offer,reference:await reference(offer,query,env)},changed:offer.totalMinor!==previous.totalMinor||offer.currency!==previous.currency,previous:{totalMinor:previous.totalMinor,currency:previous.currency},message:'Supplier quote refreshed. No booking or payment has been made.'});
    }catch(e){const known=e instanceof ApiError;return json({error:{code:known?e.code:'INTERNAL_ERROR',message:known?e.message:'Something went wrong. Please try again.'},requestId},known?e.status:500,e.status===429?{'Retry-After':'60'}:{});}
  }};
}
export default createApp();
