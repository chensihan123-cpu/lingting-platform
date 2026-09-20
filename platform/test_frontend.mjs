// DOM-level checks, deliberately independent of a real user's browser/microphone.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
const {document,window}=parseHTML(await readFile(new URL('./web/index.html',import.meta.url),'utf8'));
const source=await readFile(new URL('./web/app.js',import.meta.url),'utf8');
for(const d of document.querySelectorAll('dialog')){d.showModal=()=>{d.open=true;};d.close=()=>{d.open=false;};}
const location={hash:'#overview'};
const fixture={devices:[{id:'real',name:'真实站点',simulated:0,online:true,last_seen:new Date().toISOString(),lat:30,lon:120,battery:50,storage:10},{id:'sim',name:'模拟站点',simulated:1,online:false,lat:31,lon:121,battery:null,storage:null}],
  recordings:[{id:'abc',name:'<img src=x onerror=alert(1)>.wav',device_id:'sim',captured_at:new Date().toISOString(),duration:1,source:'模拟',simulated:1,status:'done'}],
  events:[{id:'event1',recording_id:'abc',recording_name:'<script>alert(1)</script>',device_id:'sim',captured_at:new Date().toISOString(),start:0,duration:1,label:'Knock',score:.8,review:'pending',alert:'访客提醒',alert_status:'open',simulated:1,source:'测试',predictions:[{label:'Knock',score:.8}],assignee:'',note:''}],audit:[],inference_status:'AST 已就绪'};
const fetchStub=async()=>({ok:true,json:async()=>fixture});
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const exports=await new AsyncFunction('document','window','location','fetch','setInterval','setTimeout','clearTimeout',source+`
return {render,showEvent,showRecording,wavEncode,scope,filteredEvents,
 setSim(value){includeSim=value;},setDate(value){dateFilter=value;}};`)(document,window,location,fetchStub,()=>0,()=>0,()=>{});
assert.equal(document.querySelector('#title').textContent,'监测总览');
assert.ok(document.querySelector('#content').textContent.includes('暂无符合条件的识别事件'));
exports.setSim(true);
for(const [hash,title] of Object.entries({overview:'监测总览',devices:'设备地图',archive:'音频档案',review:'识别与复核',trends:'趋势分析',alerts:'告警处理'})){
  location.hash='#'+hash;exports.render();
  assert.equal(document.querySelector('#title').textContent,title);
  assert.ok(document.querySelector('#content').textContent.length>100,hash);
  assert.equal(document.querySelector('#content script'),null,'Untrusted names must stay text');
  assert.equal(document.querySelector('#content img'),null,'Untrusted filenames must stay text');
  console.log(`PASS page: ${hash}`);
}
exports.showEvent('event1');assert.ok(document.querySelector('#review-form'));
assert.ok(document.querySelector('#alert-form'));assert.equal(document.querySelector('#detail-content script'),null);
assert.ok(document.querySelector('audio').getAttribute('src').includes('#t=0,1'));
exports.showRecording('abc');assert.equal(document.querySelector('#detail-content img'),null);
exports.setSim(false);assert.equal(exports.filteredEvents().length,0);
exports.setSim(true);exports.setDate('2000-01-01');assert.equal(exports.filteredEvents().length,0);
const wav=Buffer.from(exports.wavEncode(new Float32Array([0,-1,1,.5])),'base64');
assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),16000);
assert.equal(wav.readInt16LE(46),-32768);assert.equal(wav.readInt16LE(48),32767);
console.log('PASS details, escaping, simulation/date isolation and WAV encoding');
