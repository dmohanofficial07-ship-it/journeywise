import test from 'node:test';
import assert from 'node:assert/strict';
import {compareDemo,simulateBooking} from '../public/demo-engine.js';
import {indiaToday,addDays} from '../public/engine.js';
const query={from:'Bengaluru',to:'Chennai',date:addDays(indiaToday(),7),travellers:2,budget:2500,deadline:'13:00',priority:'cost'};
test('demo compares whole-group journey cost and explains excluded options',()=>{
  const r=compareDemo(query);assert.equal(r.recommended.id,'rail-saver');assert.equal(r.recommended.journeyTotal,1268);
  assert.ok(r.eligible.every(f=>f.journeyTotal<=2500&&f.arrival<=780&&f.status==='confirmed'));
  assert.ok(r.excluded.find(f=>f.id==='rail-wait').reasons.includes('Sample waitlist'));
  assert.ok(r.excluded.find(f=>f.id==='air-direct').reasons.includes('Over group budget'));
});
test('deadline, budget and time preference change recommendations without silently relaxing rules',()=>{
  assert.equal(compareDemo({...query,budget:500}).recommended,null);
  assert.equal(compareDemo({...query,deadline:'05:00'}).recommended,null);
  assert.equal(compareDemo({...query,priority:'time'}).recommended.id,'rail-fast');
  assert.ok(compareDemo({...query,budget:10000,deadline:'10:00'}).eligible.every(f=>f.arrival<=600));
  assert.ok(compareDemo({...query,budget:100000,deadline:'23:59'}).excluded.some(f=>f.id==='bus-sleeper'&&f.reasons.includes('Arrives after deadline')));
});
test('group transfer estimate and cab capacities remain explicit',()=>{
  const r=compareDemo({...query,travellers:6,budget:100000,deadline:'23:59'});
  assert.equal(r.eligible.find(f=>f.id==='rail-saver').transfer,440);
  assert.ok(![...r.eligible,...r.excluded].some(f=>f.id==='cab-sedan'));
  const cab=r.eligible.find(f=>f.id==='cab-suv');assert.equal(cab.journeyTotal,6435);assert.equal(cab.transfer,0);
});
test('simulation requires explicit approval and revalidates the chosen option',()=>{
  assert.throws(()=>simulateBooking(query,'rail-saver',false),/Approve/);
  assert.throws(()=>simulateBooking({...query,budget:500},'rail-saver',true),/no longer meets/);
  assert.throws(()=>simulateBooking(query,'air-direct',true),/no longer meets/);
  assert.equal(simulateBooking(query,'rail-saver',true).simulated,true);
  for(const patch of [{budget:0},{budget:NaN},{deadline:'25:00'},{priority:'unknown'}])assert.throws(()=>compareDemo({...query,...patch}));
});
