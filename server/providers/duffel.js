import {ApiError,readJson} from '../errors.js';
import {airports,requireProvider} from '../query.js';
const API='https://api.duffel.com';
const CURRENCIES={INR:2,USD:2,GBP:2,EUR:2,AUD:2,CAD:2,SGD:2,AED:2,JPY:0,KWD:3};
export function minorAmount(value,currency){
  const digits=CURRENCIES[currency];
  if(digits===undefined||typeof value!=='string'||!/^\d+(?:\.\d+)?$/.test(value))return null;
  const [whole,fraction='']=value.split('.');if(fraction.length>digits && /[1-9]/.test(fraction.slice(digits)))return null;
  const result=Number(whole)*10**digits+Number(fraction.slice(0,digits).padEnd(digits,'0'));
  return Number.isSafeInteger(result)&&result>=0?result:null;
}
function durationMinutes(value){const m=typeof value==='string'&&value.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);if(!m)return null;return Number(m[1]||0)*1440+Number(m[2]||0)*60+Number(m[3]||0)+Math.ceil(Number(m[4]||0)/60);}
function localTime(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'Z'))?value:null;}
export function normalizeDuffelOffer(raw,query,mode,now=Date.now()){
  if(!raw||raw.live_mode!==(mode==='live'))throw new ApiError(502,'PROVIDER_MODE_MISMATCH','Provider environment does not match the configured search mode.');
  const reject=reason=>({offer:null,reason});
  if(typeof raw.id!=='string'||!/^off_[A-Za-z0-9]+$/.test(raw.id))return reject('invalid');
  const expiry=Date.parse(raw.expires_at);if(!Number.isFinite(expiry)||expiry<=now)return reject('expired');
  const slices=raw.slices;if(!Array.isArray(slices)||slices.length!==1)return reject('unsupported_itinerary');
  const segments=slices[0]?.segments;if(!Array.isArray(segments)||segments.length!==1)return reject('unsupported_itinerary');
  const segment=segments[0];
  if(segment.origin?.iata_code!==airports[query.from]||segment.destination?.iata_code!==airports[query.to])return reject('route_mismatch');
  const departure=localTime(segment.departing_at),arrival=localTime(segment.arriving_at);
  if(!departure||!arrival||departure.slice(0,10)!==query.date||Date.parse(arrival+'Z')<=Date.parse(departure+'Z'))return reject('invalid');
  if(segment.origin?.time_zone!=='Asia/Kolkata'||segment.destination?.time_zone!=='Asia/Kolkata')return reject('unsupported_itinerary');
  if(!Array.isArray(raw.passengers)||raw.passengers.length!==query.travellers||raw.passengers.some(p=>p.type!=='adult'))return reject('passenger_mismatch');
  if(!Array.isArray(segment.passengers)||segment.passengers.length!==query.travellers||segment.passengers.some(p=>p.cabin_class!=='economy'))return reject('passenger_mismatch');
  const currency=raw.total_currency,totalMinor=minorAmount(raw.total_amount,currency);
  if(totalMinor===null)return reject('unsupported_currency');
  const baseMinor=raw.base_currency===currency?minorAmount(raw.base_amount,currency):null;
  const taxMinor=raw.tax_currency===currency?minorAmount(raw.tax_amount,currency):null;
  const duration=durationMinutes(slices[0].duration)||durationMinutes(segment.duration);
  if(!duration||duration<1)return reject('invalid');
  const factor=10**CURRENCIES[currency];
  const carrier=segment.operating_carrier?.name;
  if(typeof carrier!=='string'||!carrier.trim())return reject('invalid');
  const baggage=segment.passengers.map((p,index)=>({adult:index+1,allowances:(Array.isArray(p.baggages)?p.baggages:[]).filter(b=>['checked','carry_on'].includes(b.type)&&Number.isInteger(b.quantity)&&b.quantity>=0).map(b=>({type:b.type,quantity:b.quantity}))}));
  const cancellation=raw.conditions?.refund_before_departure;
  const cancelRule=cancellation&&typeof cancellation.allowed==='boolean'?{allowed:cancellation.allowed,penaltyAmount:typeof cancellation.penalty_amount==='string'?cancellation.penalty_amount:null,penaltyCurrency:typeof cancellation.penalty_currency==='string'?cancellation.penalty_currency:null}:null;
  const depart=Number(departure.slice(11,13))*60+Number(departure.slice(14,16));
  const arrivalMinute=Number(arrival.slice(11,13))*60+Number(arrival.slice(14,16));
  return {offer:{id:raw.id,mode:'flight',provider:carrier.slice(0,180),sourceProvider:'Duffel',service:'Nonstop · Economy',from:query.from,to:query.to,date:query.date,travellers:query.travellers,depart,duration,arrivalMinute,arrivalDate:arrival.slice(0,10),departingAt:departure+'+05:30',arrivingAt:arrival+'+05:30',originCode:segment.origin.iata_code,destinationCode:segment.destination.iata_code,operatingCarrier:carrier.slice(0,180),flightNumber:[segment.operating_carrier?.iata_code,segment.operating_carrier_flight_number].filter(Boolean).join(' ').slice(0,30),currency,total:totalMinor/factor,totalMinor,base:baseMinor===null?null:baseMinor/factor,tax:taxMinor===null?null:taxMinor/factor,fee:null,status:'offered',isSample:false,dataMode:mode,priceBasis:'all travellers',priceStatus:'supplier_quote',priceComplete:false,breakdownReconciled:baseMinor!==null&&taxMinor!==null&&baseMinor+taxMinor===totalMinor,baggageAllowances:baggage,cancellationRule:cancelRule,checkedAt:new Date(now).toISOString(),expiresAt:new Date(expiry).toISOString(),bookingEnabled:false,notes:['Supplier total includes taxes for all adults.','Baggage extras, payment surcharges and transfers are not included.','Availability and final payable price must be checked before booking.']},reason:null};
}
export function createDuffel(env,{fetchImpl=fetch,now=()=>Date.now(),timeoutMs=18000}={}){
  async function request(path,body){
    const config=requireProvider(env);const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetchImpl(API+path,{method:body?'POST':'GET',redirect:'error',headers:{Accept:'application/json','Content-Type':'application/json','Duffel-Version':'v2',Authorization:'Bearer '+env.DUFFEL_ACCESS_TOKEN},body:body?JSON.stringify({data:body}):undefined,signal:controller.signal});
      if(response.status===404||response.status===410)throw new ApiError(410,'OFFER_UNAVAILABLE','This offer is no longer available. Search again.');
      if(response.status===429)throw new ApiError(503,'PROVIDER_BUSY','The flight provider is busy. Please try again shortly.');
      if(response.status===401||response.status===403)throw new ApiError(503,'PROVIDER_ACCESS_ERROR','The flight provider could not authorize this connection.');
      if(!response.ok)throw new ApiError(502,'PROVIDER_ERROR','The flight provider could not complete this request.');
      let json;try{json=await readJson(response,8*1024*1024);}catch{throw new ApiError(502,'PROVIDER_INVALID_RESPONSE','The flight provider returned an invalid response.');}
      if(!json.data||typeof json.data!=='object')throw new ApiError(502,'PROVIDER_INVALID_RESPONSE','The flight provider returned an incomplete response.');
      if(json.data.live_mode!==(config.mode==='live'))throw new ApiError(502,'PROVIDER_MODE_MISMATCH','Provider environment does not match the configured search mode.');
      return json.data;
    }catch(e){if(controller.signal.aborted)throw new ApiError(504,'PROVIDER_TIMEOUT','The flight provider timed out. Try again; no booking was made.');if(e instanceof ApiError)throw e;throw new ApiError(502,'PROVIDER_UNREACHABLE','The flight provider is currently unavailable.');}
    finally{clearTimeout(timer);}
  }
  return {
    async search(query){const config=requireProvider(env);const data=await request('/air/offer_requests?return_offers=true&supplier_timeout=12000',{slices:[{origin:airports[query.from],destination:airports[query.to],departure_date:query.date}],passengers:Array.from({length:query.travellers},()=>({type:'adult'})),cabin_class:'economy',max_connections:0});
      if(!Array.isArray(data.offers))throw new ApiError(502,'PROVIDER_INVALID_RESPONSE','The provider returned an incomplete offer list.');
      const offers=[],excluded={};const seen=new Set();const checked=now();
      for(const raw of data.offers.slice(0,500)){const result=normalizeDuffelOffer(raw,query,config.mode,checked);if(result.offer&&!seen.has(result.offer.id)){seen.add(result.offer.id);offers.push(result.offer);}else if(result.reason){excluded[result.reason]=(excluded[result.reason]||0)+1;}}
      if(data.offers.length>500)excluded.limit=data.offers.length-500;
      return {offers,excluded,checkedAt:new Date(checked).toISOString(),dataMode:config.mode};
    },
    async refresh(id,query){if(!/^off_[A-Za-z0-9]+$/.test(id))throw new ApiError(400,'INVALID_OFFER_REFERENCE','Invalid offer reference.');const config=requireProvider(env);const data=await request('/air/offers/'+encodeURIComponent(id)+'?return_available_services=true');if(data.id!==id)throw new ApiError(502,'PROVIDER_INVALID_RESPONSE','The provider returned a different offer.');const result=normalizeDuffelOffer(data,query,config.mode,now());if(!result.offer)throw new ApiError(410,'OFFER_UNAVAILABLE','This offer is no longer suitable or has expired. Search again.');return result.offer;}
  };
}
