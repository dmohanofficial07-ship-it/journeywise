import {searchSampleFares,validateQuery} from './engine.js';

export const scenarioRoutes=[['Bengaluru','Chennai'],['Mumbai','Pune'],['Delhi','Jaipur'],['Bengaluru','Hyderabad']];
const assumptions={flight:{transfer:750,access:45,buffer:90,egress:45},train:{transfer:220,access:25,buffer:15,egress:20},bus:{transfer:180,access:20,buffer:15,egress:20},cab:{transfer:0,access:0,buffer:0,egress:0}};

export function compareDemo(input){
  validateQuery(input);
  if(!Number.isInteger(input.budget)||input.budget<1||input.budget>100000)throw Error('Set a whole-group budget between ₹1 and ₹1,00,000.');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.deadline))throw Error('Choose an arrival deadline.');
  if(!['cost','time'].includes(input.priority))throw Error('Choose lowest cost or shortest journey.');
  const [h,m]=input.deadline.split(':').map(Number),deadline=h*60+m;
  const options=searchSampleFares(input).map(f=>{
    const a=assumptions[f.mode],transfer=a.transfer*Math.ceil(input.travellers/4);
    const arrival=f.depart+f.duration+a.egress,total=f.total+transfer;
    const reasons=[];
    if(f.status!=='confirmed')reasons.push('Sample waitlist');
    if(total>input.budget)reasons.push('Over group budget');
    if(arrival>deadline)reasons.push('Arrives after deadline');
    return {...f,transfer,journeyTotal:total,doorDuration:f.duration+a.access+a.buffer+a.egress,pickup:f.depart-a.access-a.buffer,arrival,access:a.access,buffer:a.buffer,egress:a.egress,eligible:reasons.length===0,reasons};
  });
  const rank=(a,b)=>(input.priority==='cost'?a.journeyTotal-b.journeyTotal:a.doorDuration-b.doorDuration)||a.journeyTotal-b.journeyTotal||a.id.localeCompare(b.id);
  const eligible=options.filter(f=>f.eligible).sort(rank),excluded=options.filter(f=>!f.eligible).sort(rank);
  return {eligible,excluded,recommended:eligible[0]||null};
}

export function simulateBooking(input,offerId,consent){
  if(consent!==true)throw Error('Approve this simulation before continuing.');
  const offer=compareDemo(input).eligible.find(f=>f.id===offerId);
  if(!offer)throw Error('This option no longer meets your rules. Compare again.');
  return {offer,input:{...input},simulated:true};
}
