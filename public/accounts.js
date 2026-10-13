export function initAccounts({api,esc,money,onUserChange,isBookingBusy}){
  const $=id=>document.getElementById(id),dialog=$('account-dialog'),content=$('account-content');
  let current={user:null,mode:null},loading=true,busy=false,page=0,history=[],nextCursor=null,loadSequence=0;
  const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('rev.accounts'):null;
  const announce=()=>channel?.postMessage('changed');
  function setUser(data){
    const previous=current.user?.id;current=data;loading=false;
    $('account-button').textContent=data.user?'My account':'Sign in';
    $('account-button').disabled=false;$('account-state').textContent=data.user?'Signed in as '+data.user.name:'';
    if(previous!==data.user?.id){page++;history=[];nextCursor=null;onUserChange(data.user);if(dialog.open)dialog.close();content.innerHTML='';}
  }
  async function refresh(){const run=++loadSequence;try{const data=await api('/api/account');if(run===loadSequence)setUser(data);return data}catch(e){if(run===loadSequence){loading=false;$('account-button').disabled=false;$('account-state').textContent='Account service unavailable.';}throw e}}
  function show(html){content.innerHTML=html;if(!dialog.open)dialog.showModal();dialog.scrollTop=0;const h=content.querySelector('h2');if(h){h.tabIndex=-1;h.focus()}}
  function close(){page++;dialog.close();content.innerHTML=''}
  function signIn(register=false,message=''){
    if(current.mode==='chatgpt'){show('<h2>Your travel account</h2><p>Sign in with ChatGPT to save bookings to your account.</p><a class="primary account-link" target="_top" href="/signin-with-chatgpt?return_to=%2F">Continue with ChatGPT</a>');return}
    show('<span class="booking-tag">LOCAL TEST ACCOUNT</span><h2>'+(register?'Create your account':'Welcome back')+'</h2><p class="dialog-subtitle">This account belongs to the app on this computer. The hosted site uses ChatGPT sign-in.</p><form id="account-form" data-action="'+(register?'register':'login')+'">'+(register?'<label>Your name<input name="name" autocomplete="name" maxlength="100" required></label>':'')+'<label>Email<input name="email" type="email" autocomplete="username" maxlength="254" required></label><label>Password<input name="password" type="password" autocomplete="'+(register?'new-password':'current-password')+'" '+(register?'minlength="15"':'')+' maxlength="128" required></label>'+(register?'<p class="dialog-subtitle">Use 15–128 characters. Local accounts do not send verification emails or offer email password recovery yet.</p>':'')+'<button class="primary" type="submit">'+(register?'Create account':'Sign in')+'</button><p id="account-message" role="alert">'+esc(message)+'</p></form><button class="text-button account-switch" id="'+(register?'show-login':'show-register')+'">'+(register?'Already have an account? Sign in':'New here? Create an account')+'</button>');
  }
  function profile(){show('<h2>Your account</h2><p class="account-name">'+esc(current.user.name)+'</p><p>'+esc(current.user.email)+'</p><p class="dialog-note">'+(current.mode==='local'?'Local test account. Your bookings stay in this app’s database.':'Signed in with ChatGPT. Your bookings are linked to this account.')+'</p><div class="booking-actions"><button class="primary" id="account-history">My bookings</button>'+(current.mode==='chatgpt'?'<a class="secondary account-link" target="_top" href="/signout-with-chatgpt?return_to=%2F">Sign out</a>':'<button class="secondary" id="account-logout">Sign out</button>')+'</div><p id="account-message" role="alert"></p>')}
  function renderHistory(message=''){
    const labels={confirmed:'Confirmed · test booking',unknown:'Needs a status check',rejected:'Declined'};
    show('<span class="booking-tag">YOUR SANDBOX JOURNEYS</span><h2>My bookings</h2><p class="dialog-subtitle">'+esc(current.user.name)+' · Only bookings made while signed in appear here.</p>'+(history.length?'<div class="booking-history">'+history.map(b=>{const r=b.receipt,j=b.journey||{},i=r?.itinerary;return '<article class="history-card"><span class="history-status '+esc(b.status)+'">'+esc(labels[b.status]||'Status unavailable')+'</span><h3>'+esc(j.from||i?.from)+' → '+esc(j.to||i?.to)+'</h3><p>'+esc(j.date||i?.departingAt?.slice(0,10))+' · '+Number(j.travellers||r?.travellers||0)+' adult(s)</p>'+(r?'<p>'+esc(i?.operatingCarrier)+' · '+esc(i?.flightNumber)+'</p><div class="history-total"><strong>'+money(r.total,r.currency)+'</strong><span>Reference <strong>'+esc(r.bookingReference)+'</strong></span></div>':'<p>No confirmed ticket has been returned.</p>')+'<button class="secondary" data-booking-status="'+esc(b.attemptId)+'">'+(b.status==='unknown'?'Check status':'View details')+'</button></article>'}).join('')+'</div>':'<div class="history-empty"><h3>No bookings yet</h3><p>Your next test booking will appear here. Choose a Duffel flight and complete its test booking.</p><button class="primary" id="history-search">Find a flight</button></div>')+'<p id="account-message" role="status">'+esc(message)+'</p><div class="booking-actions"><button class="secondary" id="refresh-history">Refresh history</button>'+(nextCursor?'<button class="secondary" id="more-history">Load more</button>':'')+'</div>');
  }
  async function showHistory(more=false){
    if(busy||isBookingBusy())return;
    if(!await ensureSignedIn())return;const run=++page,owner=current.user.id;busy=true;
    if(!more)show('<h2>My bookings</h2><p role="status">Loading your bookings…</p>');
    try{const data=await api('/api/bookings/history'+(more&&nextCursor?'?cursor='+encodeURIComponent(nextCursor):''));if(run!==page||owner!==current.user?.id)return;history=more?[...history,...data.bookings]:data.bookings;nextCursor=data.nextCursor;renderHistory()}
    catch(e){if(run===page){if(e.code==='SIGN_IN_REQUIRED'){await refresh();signIn(false,e.message)}else show('<h2>My bookings</h2><p role="alert">'+esc(e.message)+'</p><button class="secondary" id="refresh-history">Try again</button>')}}finally{busy=false}
  }
  function showResult(data){
    const r=data.receipt;
    if(!r){show('<h2>'+(data.status==='unknown'?'Booking status not confirmed':'Booking declined')+'</h2><p class="dialog-note">'+(data.status==='unknown'?'The provider has not confirmed this booking. Check again from your history; do not submit a duplicate booking.':'This attempt did not return a confirmed booking.')+'</p><button class="secondary" id="account-history">Back to my bookings</button>');return}
    const i=r.itinerary;show('<span class="booking-tag">SANDBOX · NO REAL TICKET</span><h2>Booking details</h2><div class="booking-confirmation"><span>Booking reference</span><strong>'+esc(r.bookingReference)+'</strong></div><div class="booking-trip"><strong>'+esc(i.from)+' → '+esc(i.to)+'</strong><p>'+esc(i.operatingCarrier)+' · '+esc(i.flightNumber)+'</p><p>Departure: '+esc(i.departingAt.replace('T',' '))+' IST</p><p>Arrival: '+esc(i.arrivingAt.replace('T',' '))+' IST</p></div><div class="fare-row fare-total"><span>Simulated total</span><strong>'+money(r.total,r.currency)+'</strong></div><p class="dialog-note">No real ticket or payment. '+r.travellers+' adult(s).</p><button class="secondary" id="account-history">Back to my bookings</button>');
  }
  async function ensureSignedIn(){try{await refresh()}catch{show('<h2>Account unavailable</h2><p>Please try signing in again shortly.</p>');return false}if(current.user)return true;signIn();return false}
  $('account-button').addEventListener('click',async()=>{if(busy||isBookingBusy())return;if(await ensureSignedIn())profile()});
  $('history-button').addEventListener('click',()=>showHistory());
  $('close-account').addEventListener('click',()=>{if(!busy)close()});
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault()});
  dialog.addEventListener('close',()=>{if(!dialog.open){page++;content.innerHTML=''}});
  content.addEventListener('click',async e=>{
    if(busy)return;const id=e.target.id;
    if(id==='show-login')signIn();if(id==='show-register')signIn(true);
    if(['account-history','refresh-history'].includes(id))showHistory();if(id==='more-history')showHistory(true);
    if(id==='history-search')close();
    if(id==='account-logout'){
      busy=true;try{await api('/api/auth/logout',{});await refresh();announce();signIn(false,'You have signed out.')}catch(err){$('account-message').textContent=err.message}finally{busy=false}
    }
    const button=e.target.closest('[data-booking-status]');
    if(button){busy=true;button.disabled=true;const run=page;try{const data=await api('/api/bookings/status',{attemptId:button.dataset.bookingStatus});if(run===page)showResult(data)}catch(err){if(run===page)$('account-message').textContent=err.message}finally{busy=false;button.disabled=false}}
  });
  content.addEventListener('submit',async e=>{
    if(e.target.id!=='account-form')return;e.preventDefault();if(busy)return;busy=true;
    const form=e.target,button=form.querySelector('button[type=submit]'),body=Object.fromEntries(new FormData(form));button.disabled=true;$('account-message').textContent='Please wait…';
    try{await api('/api/auth/'+form.dataset.action,body);form.elements.password.value='';await refresh();announce();profile()}
    catch(err){if($('account-message'))$('account-message').textContent=err.message}finally{busy=false;button.disabled=false}
  });
  window.addEventListener('focus',()=>refresh().catch(()=>{}));channel?.addEventListener('message',()=>refresh().catch(()=>{}));
  refresh().catch(()=>{});
  return {ensureSignedIn,refresh,getUser:()=>current.user,showHistory};
}
