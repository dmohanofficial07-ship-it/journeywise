export function initBooking({api,showDialog,dialog,esc,money,getFare,getProvider,onOffer}){
  const $=id=>document.getElementById(id);
  let flow=null,busy=false;
  const recoveryKey='rev.sandbox.booking';
  let recovery=null;try{recovery=sessionStorage.getItem(recoveryKey)}catch{}
  function remember(token){recovery=token;try{sessionStorage.setItem(recoveryKey,token)}catch{}$('recover-booking').hidden=false}
  function forget(){recovery=null;try{sessionStorage.removeItem(recoveryKey)}catch{}$('recover-booking').hidden=true}
  $('recover-booking').hidden=!recovery;
  function header(step){return '<span class="booking-tag">SANDBOX · NO REAL PAYMENT</span><h2>'+step+'</h2><p class="dialog-subtitle">Test passengers only. No card details are needed.</p>'}
  function itinerary(f){const arrivalDate=f.arrivingAt?.slice(0,10),departureDate=f.departingAt?.slice(0,10);return '<div class="booking-trip"><strong>'+esc(f.from)+' → '+esc(f.to)+'</strong><p>'+esc(f.date||departureDate)+' · '+esc(f.operatingCarrier||f.provider)+' · '+esc(f.flightNumber)+'</p><p>'+esc(f.departingAt?.slice(11,16))+' – '+esc(f.arrivingAt?.slice(11,16))+' IST'+(arrivalDate!==departureDate?' · arrives '+esc(arrivalDate):'')+' · '+f.travellers+' adult'+(f.travellers>1?'s':'')+'</p></div>'}
  function fields(p,i){const input=(key,label,type='text',extra='')=>'<label>'+label+'<input name="'+key+'_'+i+'" type="'+type+'" value="'+esc(p?.[key]||'')+'" required '+extra+'></label>';const select=(key,label,options)=>'<label>'+label+'<select name="'+key+'_'+i+'" required><option value="">Choose</option>'+options.map(([v,t])=>'<option value="'+v+'" '+(p?.[key]===v?'selected':'')+'>'+t+'</option>').join('')+'</select></label>';return '<fieldset><legend>Adult '+(i+1)+'</legend><div class="passenger-grid">'+select('title','Title',[['mr','Mr'],['ms','Ms'],['mrs','Mrs'],['miss','Miss'],['dr','Dr']])+select('gender','Gender on travel document',[['m','Male'],['f','Female']])+input('given_name','Given name','text','maxlength="80"')+input('family_name','Family name','text','maxlength="80"')+input('born_on','Date of birth','date')+input('email','Passenger email','email','maxlength="254"')+input('phone_number','Phone with country code','tel','placeholder="+12025550100" pattern="\\+[1-9][0-9]{7,14}"')+'</div></fieldset>'}
  function passengerForm(message=''){
    showDialog(header('1. Passenger details')+itinerary(flow.offer)+'<p class="dialog-subtitle">Adults must be at least 18 on departure. This test form supports the document gender values currently accepted by the provider.</p><form id="passenger-form" autocomplete="off">'+Array.from({length:flow.offer.travellers},(_,i)=>fields(flow.passengers?.[i],i)).join('')+'<div class="booking-actions"><button type="button" class="secondary" id="fill-test-passengers">Fill test details</button><button class="primary" type="submit">Review test booking</button></div><p id="booking-message" role="alert">'+esc(message)+'</p></form>');
  }
  function readPassengers(form){return Array.from({length:flow.offer.travellers},(_,i)=>Object.fromEntries(['title','gender','given_name','family_name','born_on','email','phone_number'].map(k=>[k,form.elements[k+'_'+i].value.trim()])))}
  function review(){
    const f=flow.offer;showDialog(header('2. Review your test booking')+itinerary(f)+(flow.changed?'<p class="booking-warning" role="status">The price changed. Review the updated total below.</p>':'')+'<ul class="dialog-list">'+flow.passengers.map(p=>'<li><strong>'+esc(p.given_name+' '+p.family_name)+'</strong><br>'+esc(p.born_on)+' · '+esc(p.email)+' · '+esc(p.phone_number)+'</li>').join('')+'</ul><ul class="dialog-list">'+f.baggageAllowances.map(p=>'<li>Adult '+p.adult+' baggage: '+(p.allowances.length?p.allowances.map(b=>b.quantity+' '+b.type.replace('_',' ')+' bag(s)').join(', '):'not supplied')+'</li>').join('')+'<li>Cancellation: '+(f.cancellationRule?f.cancellationRule.allowed?'permitted; '+(f.cancellationRule.penaltyAmount?esc(f.cancellationRule.penaltyAmount+' '+f.cancellationRule.penaltyCurrency)+' penalty':'fee not supplied'):'not permitted':'terms not supplied')+'</li></ul><div class="fare-row fare-total"><span>Test booking total</span><strong>'+money(f.total,f.currency)+'</strong></div><p class="dialog-subtitle">Includes supplier taxes for all passengers. No optional extras are selected. Uses Duffel’s simulated balance; no card is charged.</p><p class="dialog-subtitle">Review valid until '+esc(new Date(flow.expiresAt).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'}))+' IST. We check the price again when you confirm.</p><form id="confirm-booking-form"><label class="booking-consent"><input type="checkbox" id="test-consent" required> I have reviewed these details and want to create a test booking. The passenger details will be sent to Duffel’s sandbox.</label><div class="booking-actions"><button type="button" class="secondary" id="edit-passengers">Edit details</button><button type="submit" class="primary">Confirm test booking</button></div><p id="booking-message" role="alert"></p></form>');
  }
  function outcome(data){
    if(data.status==='confirmed'){
      const r=data.receipt;showDialog(header('Test booking confirmed')+'<div class="booking-confirmation"><span>Booking reference</span><strong id="booking-reference">'+esc(r.bookingReference)+'</strong></div>'+itinerary({...r.itinerary,travellers:r.travellers})+'<div class="fare-row fare-total"><span>Simulated total</span><strong>'+money(r.total,r.currency)+'</strong></div><p class="dialog-note">This is a sandbox confirmation. It cannot be used to travel. No real payment was made.</p><p class="dialog-subtitle">Duffel order: '+esc(r.orderId)+'</p><div class="booking-actions"><button class="primary" id="booking-done">Done</button></div>');flow=null;return;
    }
    const unknown=data.status==='unknown';
    showDialog(header(unknown?'Booking status not confirmed':data.status==='not_submitted'?'No booking was submitted':'Test booking was declined')+'<p class="dialog-note">'+(unknown?'Duffel has not returned a confirmed result yet. Check the status below. Do not make another booking for this journey while the result is uncertain.':data.status==='not_submitted'?'The server has no submitted attempt for this review. You can return to the flight and review it again.':'The provider declined this attempt. No confirmed booking was returned. Start a new search to try again.')+'</p><p class="dialog-subtitle">Attempt: '+esc(data.attemptId||'unavailable')+'</p><div class="booking-actions">'+(unknown?'<button class="primary" id="check-booking-status">Check booking status</button>':'<button class="primary" id="booking-done">Done</button>')+'</div><p id="booking-message" role="alert"></p>');
  }
  function lock(value){busy=value;$('close-dialog').disabled=value;dialog.querySelectorAll('form button,form input,form select,.booking-actions button').forEach(x=>x.disabled=value)}
  async function check(){
    if(busy||!recovery)return;lock(true);
    try{const data=await api('/api/bookings/status',{checkoutToken:recovery});outcome(data)}
    catch(e){const message=$('booking-message');if(message)message.textContent=e.message;else showDialog(header('Booking status unavailable')+'<p role="alert">'+esc(e.message)+'</p><button class="primary" id="check-booking-status">Check again</button><p id="booking-message" role="alert"></p>')}
    finally{lock(false)}
  }
  $('recover-booking').addEventListener('click',check);
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault()});
  dialog.addEventListener('close',()=>{if(!busy)flow=null});
  $('dialog-content').addEventListener('click',e=>{
    if(busy)return;
    if(e.target.id==='start-test-booking'){if(recovery){check();return}const offer=getFare(e.target.dataset.id);if(!offer||offer.dataMode!=='sandbox'||!getProvider()?.sandboxBookingEnabled)return;flow={offer,passengers:null};passengerForm()}
    if(e.target.id==='fill-test-passengers'){flow.passengers=Array.from({length:flow.offer.travellers},(_,i)=>({title:'ms',gender:'f',given_name:'Test',family_name:['Travellerone','Travellertwo','Travellerthree','Travellerfour','Travellerfive','Travellersix'][i],born_on:'1990-01-01',email:'traveller'+(i+1)+'@example.com',phone_number:'+1202555010'+i}));passengerForm()}
    if(e.target.id==='edit-passengers')passengerForm();
    if(e.target.id==='booking-done'){forget();dialog.close()}
    if(e.target.id==='check-booking-status')check();
  });
  $('dialog-content').addEventListener('submit',async e=>{
    if(!['passenger-form','confirm-booking-form'].includes(e.target.id))return;e.preventDefault();if(busy)return;
    if(e.target.id==='passenger-form'){
      flow.passengers=readPassengers(e.target);lock(true);$('booking-message').textContent='Checking the latest price…';
      try{const data=await api('/api/bookings/prepare',{reference:flow.offer.reference,passengers:flow.passengers});flow={...flow,...data};onOffer(data.offer);review()}
      catch(err){$('booking-message').textContent=err.message}finally{lock(false)}return;
    }
    remember(flow.checkoutToken);lock(true);$('booking-message').textContent='Creating your test booking. Please keep this window open…';
    try{const data=await api('/api/bookings/confirm',{checkoutToken:flow.checkoutToken,passengers:flow.passengers,confirmed:true});outcome(data)}
    catch(err){
      if(['QUOTE_CHANGED','CHECKOUT_EXPIRED','PASSENGERS_CHANGED'].includes(err.code)){forget();passengerForm(err.message)}
      else if(err.code&&['SANDBOX_BOOKING_DISABLED','INVALID_PASSENGERS','INVALID_CHECKOUT','CONFIRMATION_REQUIRED','UNSUPPORTED_BOOKING','OFFER_UNAVAILABLE','OFFER_EXPIRED'].includes(err.code)){$('booking-message').textContent=err.message}
      else outcome({status:'unknown'});
    }finally{lock(false)}
  });
  return {isBusy:()=>busy};
}
