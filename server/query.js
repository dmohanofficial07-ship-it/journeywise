import {ApiError} from './errors.js';
import {indiaToday,addDays,validateQuery} from '../public/engine.js';
export const airports={Bengaluru:'BLR',Chennai:'MAA',Mumbai:'BOM',Pune:'PNQ',Delhi:'DEL',Jaipur:'JAI',Hyderabad:'HYD'};
export function validateSearch(value, now=new Date()) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(400,'INVALID_QUERY','Provide a journey object.');
  const fields=['from','to','date','travellers','source'];
  if(Object.keys(value).some(k=>!fields.includes(k)))throw new ApiError(400,'INVALID_QUERY','Unexpected search fields.');
  if(!['sample','duffel'].includes(value.source))throw new ApiError(400,'INVALID_SOURCE','Choose sample or Duffel search.');
  const q={from:value.from,to:value.to,date:value.date,travellers:value.travellers};
  try{validateQuery(q);}catch(e){throw new ApiError(400,'INVALID_QUERY',e.message);}
  if(q.date>addDays(indiaToday(now),330))throw new ApiError(400,'INVALID_QUERY','Search within the next 330 days.');
  return {...q,source:value.source};
}
export function providerConfig(env) {
  const mode=env.DUFFEL_MODE||'sandbox';
  const configured=Boolean(env.DUFFEL_ACCESS_TOKEN && typeof env.OFFER_SIGNING_SECRET==='string' && env.OFFER_SIGNING_SECRET.length>=32 && ['sandbox','live'].includes(mode));
  const enabled=configured&&(mode==='sandbox'||env.ENABLE_LIVE_SEARCH==='true');
  return {id:'duffel',name:'Duffel',mode,configured,enabled,status:enabled?'ready':'not_configured',bookingEnabled:false,modes:['flight'],scope:'One-way, economy, nonstop flights; 1–6 adults.'};
}
export function requireProvider(env){const c=providerConfig(env);if(!c.enabled)throw new ApiError(503,'PROVIDER_NOT_CONFIGURED','Flight search is not connected yet. Try sample mode while provider access is being configured.');return c;}
