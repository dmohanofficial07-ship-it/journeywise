import {ApiError} from './errors.js';
export function bookingStore(db){
  const query=async fn=>{try{return await fn()}catch(e){if(e instanceof ApiError)throw e;throw new ApiError(503,'BOOKING_STORAGE_UNAVAILABLE','Booking records are temporarily unavailable. Check the booking status before trying again.')}};
  return {
    get: (id,ownerId)=>query(()=>db.prepare('SELECT * FROM booking_attempts WHERE intent_id = ? AND owner_id = ?').bind(id,ownerId).first()),
    claim: (p,now)=>query(async()=>{const r=await db.prepare('INSERT INTO booking_attempts (offer_id,intent_id,state,created_at,owner_id,context) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(p.id,p.intent,'pending',now,p.ownerId,JSON.stringify(p)).run();return r.meta.changes===1}),
    list: (ownerId,cursor)=>query(async()=>{
      let time=Number.MAX_SAFE_INTEGER,id='~';
      if(cursor){const match=/^(\d{1,16}):([a-f0-9-]{36})$/.exec(cursor);if(!match)throw new ApiError(400,'INVALID_CURSOR','Invalid booking history page.');time=Number(match[1]);id=match[2];}
      const data=await db.prepare('SELECT intent_id,state,receipt,created_at,context FROM booking_attempts WHERE owner_id=? AND (created_at<? OR (created_at=? AND intent_id<?)) ORDER BY created_at DESC,intent_id DESC LIMIT 21').bind(ownerId,time,time,id).all();
      const rows=data.results.slice(0,20),last=rows.at(-1);
      return {bookings:rows.map(r=>({attemptId:r.intent_id,status:r.state==='pending'?'unknown':r.state,createdAt:new Date(r.created_at).toISOString(),receipt:r.receipt?JSON.parse(r.receipt):null,journey:r.context?JSON.parse(r.context).query:null})),nextCursor:data.results.length>20?last.created_at+':'+last.intent_id:null};
    }),
    save:(id,state,receipt=null)=>query(()=>db.prepare("UPDATE booking_attempts SET state = ?, receipt = ? WHERE intent_id = ? AND state != 'confirmed'").bind(state,receipt?JSON.stringify(receipt):null,id).run())
  };
}
