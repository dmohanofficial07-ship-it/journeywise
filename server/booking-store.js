import {ApiError} from './errors.js';
export function bookingStore(db){
  const query=async fn=>{try{return await fn()}catch{throw new ApiError(503,'BOOKING_STORAGE_UNAVAILABLE','Booking records are temporarily unavailable. Check the booking status before trying again.')}};
  return {
    get: id=>query(()=>db.prepare('SELECT * FROM booking_attempts WHERE intent_id = ?').bind(id).first()),
    claim: (p,now)=>query(async()=>{const r=await db.prepare('INSERT INTO booking_attempts (offer_id,intent_id,state,created_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING').bind(p.id,p.intent,'pending',now).run();return r.meta.changes===1}),
    save:(id,state,receipt=null)=>query(()=>db.prepare("UPDATE booking_attempts SET state = ?, receipt = ? WHERE intent_id = ? AND state != 'confirmed'").bind(state,receipt?JSON.stringify(receipt):null,id).run())
  };
}
