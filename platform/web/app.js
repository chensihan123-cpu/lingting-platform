const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const pages = {
  overview: ['◫', '监测总览', 'OBSERVATION OVERVIEW', '从声音出发，持续观察每一处环境的变化。'],
  devices: ['⌖', '设备地图', 'FIELD STATIONS', '管理监测点位，掌握终端连接与采集状态。'],
  archive: ['▤', '音频档案', 'SOUND ARCHIVE', '保留每一段原始声音，让识别结果可以回溯。'],
  review: ['◎', '识别与复核', 'REVIEW WORKSPACE', '机器发现线索，由人工确认声音的意义。'],
  trends: ['▥', '趋势分析', 'ACOUSTIC PATTERNS', '按有效录音时长观察活动变化，避免将离线误作安静。'],
  alerts: ['⚑', '告警处理', 'EVENT RESPONSE', '发现、确认、派单与结案，形成完整处理记录。'],
};
const labels = { 'Meow':'猫叫', 'Cat':'猫', 'Animal':'动物', 'Domestic animals, pets':'家养动物', 'Silence':'静音', 'Speech':'人声', 'Bird':'鸟鸣', 'Bird vocalization, bird call, bird song':'鸟鸣', 'Dog':'狗', 'Bark':'犬吠', 'Clapping':'拍手', 'Cough':'咳嗽', 'Knock':'敲门', 'Doorbell':'门铃', 'Siren':'警笛', 'Music':'音乐', 'Rain':'雨声', 'Wind':'风声', 'Water':'水声', 'Whistling':'口哨' };
const statusNames = { queued:'排队中', processing:'识别中', done:'已归档', failed:'识别失败', pending:'待复核', confirmed:'已确认', corrected:'已纠正', rejected:'已驳回', open:'待处理', assigned:'已派单', resolved:'已结案', dismissed:'已标误报' };
let state = {devices:[],recordings:[],events:[],audit:[]};
let current = 'overview';
let includeSim = false;
let deviceFilter = '', search = '', dateFilter = '', reviewFilter = '';
let selectedDevice = '';
let recording = null, uploadBusy = false;
const fmtTime = t => t ? new Date(t).toLocaleString('zh-CN', {hour12:false}) : '尚未上报';
const localDay = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const tag = (text, cls='') => `<span class="tag ${cls}">${esc(text)}</span>`;
const nameOf = id => state.devices.find(d=>d.id===id)?.name || id;
const translated = label => labels[label] || label;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(()=>$('#toast').hidden=true,5500); }
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
async function refresh(renderPage=true) {
  try {
    state = await api('/api/state');
    $('#connection').textContent = '● 平台已连接';
    $('#model-status').textContent = `AST / 527 类 · ${state.inference_status}`;
    if (renderPage) render();
  } catch (error) { $('#connection').textContent='平台连接失败'; if (renderPage) toast(error.message); }
}
function scope(row) {
  return (includeSim || !row.simulated) && (!deviceFilter || row.device_id === deviceFilter) &&
    (!dateFilter || localDay(row.captured_at)===dateFilter);
}
function filteredEvents() {
  return state.events.filter(e=>scope(e) && (!reviewFilter || e.review===reviewFilter) &&
    `${e.label} ${translated(e.label)} ${e.reviewed_label||''} ${e.recording_name} ${nameOf(e.device_id)}`.toLowerCase().includes(search.toLowerCase()));
}
function toolbar(extra='') {
  return `<div class="toolbar"><label class="inline"><input type="checkbox" id="include-sim" ${includeSim?'checked':''}>包含模拟数据</label><select id="device-filter" aria-label="按终端筛选"><option value="">全部终端</option>${state.devices.map(d=>`<option value="${esc(d.id)}" ${deviceFilter===d.id?'selected':''}>${esc(d.name)}</option>`).join('')}</select><input type="date" id="date-filter" aria-label="按采集日期筛选" value="${esc(dateFilter)}">${extra}</div>`;
}
function stat(label, number, note, mark) { return `<div class="stat"><div class="stat-label">${label}<span>${mark}</span></div><div class="stat-number">${number}</div><small>${note}</small></div>`; }
function panel(title, body, note='') { return `<section class="panel"><div class="panel-head"><h2>${title}</h2><small>${note}</small></div>${body}</section>`; }
function empty(text) { return `<div class="empty">${text}</div>`; }
function mapDevices() {
  return state.devices.filter(d=>Number.isFinite(d.lat) && Number.isFinite(d.lon) && (includeSim || !d.simulated) && (!deviceFilter || d.id===deviceFilter));
}
function renderMap() {
  return `<div id="map-slot">${renderOfflineMap()}</div>`;
}
function renderOfflineMap() {
  const devices = mapDevices();
  if (!devices.length) return `<div class="map">${empty('暂无带坐标的真实终端<br>登记终端，或勾选“包含模拟数据”查看示例点位')}</div>`;
  const lats=devices.map(d=>d.lat), lons=devices.map(d=>d.lon);
  const minLat=Math.min(...lats)-0.008,maxLat=Math.max(...lats)+0.008,minLon=Math.min(...lons)-0.008,maxLon=Math.max(...lons)+0.008;
  const points=devices.map(d=>{
    const x=65+(d.lon-minLon)/(maxLon-minLon)*570, y=285-(d.lat-minLat)/(maxLat-minLat)*230;
    const count=state.events.filter(e=>e.device_id===d.id&&scope(e)).length;
    return `<g class="map-point" data-device="${esc(d.id)}" tabindex="0" role="button" aria-label="${esc(d.name)}"><circle cx="${x}" cy="${y}" r="${15+Math.min(count,10)}" fill="${d.simulated?'#baa274':'#7a9b65'}" opacity=".18"/><circle cx="${x}" cy="${y}" r="7" fill="${d.online?'#397251':'#9caa93'}" stroke="white" stroke-width="3"/><text x="${x+14}" y="${y-9}">${esc(d.name)}</text><text x="${x+14}" y="${y+9}" style="font-size:9px;fill:#839079">${count} 个识别片段${d.simulated?' · 模拟点位':''}</text></g>`;
  }).join('');
  return `<div class="map"><svg viewBox="0 0 760 340" aria-label="终端经纬度分布图"><defs><pattern id="grid" width="38" height="34" patternUnits="userSpaceOnUse"><path d="M 38 0 L 0 0 0 34" fill="none" stroke="#d6dfcf" stroke-width=".8"/></pattern></defs><rect width="760" height="340" fill="url(#grid)"/><text x="20" y="27" fill="#698064" font-size="12">N ↑</text><path d="M55 45 V295 H700" fill="none" stroke="#aebda4"/><text x="56" y="320" fill="#7d9070" font-size="10">${minLon.toFixed(3)}° E</text><text x="630" y="320" fill="#7d9070" font-size="10">${maxLon.toFixed(3)}° E</text><text x="58" y="43" fill="#7d9070" font-size="10">${maxLat.toFixed(3)}° N</text>${points}</svg><span class="map-key">● 心跳90秒内在线 · 点大小表示片段数</span><span class="map-label">经纬度点位图 · 无地理底图 · 设备位置不等于声源位置</span></div>`;
}
function eventTable(events, compact=false) {
  if (!events.length) return empty('暂无符合条件的识别事件<br>上传录音后会在这里显示真实模型结果');
  return `<div class="table-wrap"><table><thead><tr><th>声音事件 / 采集时间</th><th>监测终端</th><th>模型得分</th>${compact?'':'<th>复核 / 告警</th>'}<th></th></tr></thead><tbody>${events.map(e=>`<tr><td><b>${esc(translated(e.review==='corrected'?e.reviewed_label:e.label))}</b><small>${fmtTime(e.captured_at)} · ${e.start.toFixed(0)}s</small></td><td>${esc(nameOf(e.device_id))}<small>${e.simulated?'模拟终端':'真实采集'} · ${esc(e.source)}</small></td><td>${(e.score*100).toFixed(1)}%</td>${compact?'':`<td>${tag(statusNames[e.review],e.review==='pending'?'warn':'')}${e.alert?`<small>${esc(e.alert)} · ${statusNames[e.alert_status]}</small>`:''}</td>`}<td><button data-event="${e.id}">查看</button></td></tr>`).join('')}</tbody></table></div>`;
}
function overview() {
  const events = state.events.filter(scope), recordings = state.recordings.filter(scope);
  const today = events.filter(e=>localDay(e.captured_at)===localDay(new Date()));
  const devices = state.devices.filter(d=>(includeSim||!d.simulated)&&(!deviceFilter||d.id===deviceFilter));
  const pending=events.filter(e=>e.alert&&['open','assigned'].includes(e.alert_status));
  return `${toolbar()}<div class="stats">${stat('在线监测终端',`${devices.filter(d=>d.online).length}<span style="font-size:15px;color:#9eab9c"> / ${devices.length}</span>`,'以最近一次心跳或上传为准','⌖')}${stat('今日识别片段',today.length,'按采集日期统计 · 非动物个体数','◎')}${stat('待处理告警',pending.length,'阈值命中后进入人工确认','⚑')}${stat('累计归档时长',`${(recordings.reduce((n,r)=>n+r.duration,0)/60).toFixed(1)}<span style="font-size:14px"> 分钟</span>`,`${recordings.length} 条音频 · 可回放与追溯`,'▤')}</div>
  <div class="grid">${panel('监测点位',renderMap(),'SPATIAL OBSERVATION')}${panel('终端动态',`<div class="panel-body"><div class="device-list">${devices.map(d=>`<div class="device-row"><div><b>${esc(d.name)}</b><small>${esc(d.id)} · ${d.simulated?'模拟设备':'真实设备'}</small><small>${fmtTime(d.last_seen)}</small></div>${tag(d.online?'在线':'离线 / 未连接',d.online?'':'gray')}</div>`).join('')||empty('暂无设备')}</div><div class="dialog-section"><h3>开始第一条观测</h3><p class="muted">上传实际录音，或让模拟终端发送内置猫叫样例。样例同样经过真实 AST 推理。</p><button data-action="demo">运行模拟终端样例 ↗</button></div></div>`,'DEVICE HEALTH')}</div>
  <div class="grid">${panel('最近声音事件',eventTable(events.slice(0,5),true),'LATEST DETECTIONS')}${panel('从采集到行动',`<div class="panel-body"><div class="flow">${[['01','采集归档','保留音频与时间'],['02','模型识别','AST 真实推理'],['03','人工复核','确认或纠正'],['04','事件处理','派单并记录']].map(x=>`<div class="flow-item"><span>${x[0]}</span><b>${x[1]}</b><small>${x[2]}</small></div>`).join('')}</div><p class="muted" style="margin-top:20px">当前识别的是环境声音类别。具体鸟种、两栖物种识别与无人机联动尚未接入。</p><a href="#trends" style="font-size:12px">查看活动趋势 →</a></div>`,'WORKFLOW')}</div>`;
}
function devicesPage() {
  const devices=state.devices.filter(d=>includeSim||!d.simulated);
  const chosen=state.devices.find(d=>d.id===selectedDevice);
  return `${toolbar('<button id="add-device" class="push">＋ 登记终端</button>')}<div class="notice">模拟终端坐标仅用于演示。设备登记后需上报心跳或录音才会显示在线；电量和存储必须由硬件上报。</div>${panel('点位分布',renderMap(),'点击点位查看终端')}${chosen?`<div class="notice" style="margin-top:16px">已选择：${esc(chosen.name)} · ${chosen.lat??'未设纬度'}, ${chosen.lon??'未设经度'} · <a href="#archive" data-filter-device="${esc(chosen.id)}">查看该终端音频 →</a></div>`:''}<div style="height:22px"></div>${panel('终端清单',`<div class="table-wrap"><table><thead><tr><th>终端</th><th>连接</th><th>坐标</th><th>电量 / 存储已用</th><th>最近上报</th></tr></thead><tbody>${devices.map(d=>`<tr><td><b>${esc(d.name)}</b><small>${esc(d.id)} ${d.simulated?'· 模拟':''}</small></td><td>${tag(d.online?'在线':'离线',d.online?'':'gray')}</td><td>${d.lat??'—'}, ${d.lon??'—'}</td><td>${d.battery===null?'未知':d.battery+'%'} / ${d.storage===null?'未知':d.storage+'%'}</td><td>${fmtTime(d.last_seen)}</td></tr>`).join('')}</tbody></table></div>`,'HEARTBEAT / 90s')}`;
}
function archivePage() {
  const recordings=state.recordings.filter(r=>scope(r)&&`${r.name} ${nameOf(r.device_id)}`.toLowerCase().includes(search.toLowerCase()));
  return `${toolbar(`<input id="search" placeholder="搜索文件 / 终端" value="${esc(search)}"><button id="export" class="push">导出全部记录 JSON</button>`)}${panel('录音文件',recordings.length?`<div class="table-wrap"><table><thead><tr><th>录音 / 来源</th><th>终端</th><th>采集时间</th><th>时长</th><th>处理状态</th><th></th></tr></thead><tbody>${recordings.map(r=>`<tr><td><b>${esc(r.name)}</b><small>${esc(r.source)}${r.simulated?' · 模拟':''}</small>${r.error?`<small class="error">${esc(r.error)}</small>`:''}</td><td>${esc(nameOf(r.device_id))}</td><td>${fmtTime(r.captured_at)}</td><td>${r.duration.toFixed(1)}s</td><td>${tag(statusNames[r.status],r.status==='failed'?'bad':r.status==='done'?'':'warn')}</td><td><button data-recording="${r.id}">回放 / 详情</button>${r.status==='failed'?` <button data-retry="${r.id}">重试</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:empty('还没有音频档案，点击右上角上传一段录音'),'RAW AUDIO + METADATA')}`;
}
function reviewPage() {
  return `${toolbar(`<select id="review-filter" aria-label="复核状态"><option value="">全部复核状态</option>${['pending','confirmed','corrected','rejected'].map(s=>`<option value="${s}" ${reviewFilter===s?'selected':''}>${statusNames[s]}</option>`).join('')}</select><input id="search" placeholder="搜索声音类别" value="${esc(search)}">`)}<div class="notice">每个识别片段最长10秒。置信度是模型得分，不能当作正确率；请回放后确认。人工纠正不会自动训练模型，也不会自动解除告警。</div>${panel('待验证的声音线索',eventTable(filteredEvents()),'HUMAN IN THE LOOP')}`;
}
function bars(values, keys, height=150) {
  const max=Math.max(1,...values);
  return `<div class="bars">${values.map((n,i)=>`<div class="bar-col" title="${esc(keys[i])}: ${n}"><span>${n||''}</span><div class="bar" style="height:${n/max*height}px"></div><small>${esc(keys[i])}</small></div>`).join('')}</div>`;
}
function trendsPage() {
  const recordings=state.recordings.filter(r=>scope(r)&&r.status==='done');
  const ids=new Set(recordings.map(r=>r.id));
  const events=state.events.filter(e=>ids.has(e.recording_id)&&e.review!=='rejected');
  const hours=Array(24).fill(0); events.forEach(e=>hours[new Date(new Date(e.captured_at).getTime()+e.start*1000).getHours()]++);
  const daily=new Map(); recordings.forEach(r=>{const key=localDay(r.captured_at); const x=daily.get(key)||{seconds:0,count:0};x.seconds+=r.duration;daily.set(key,x);});
  events.forEach(e=>{const x=daily.get(localDay(e.captured_at)); if(x)x.count++;});
  const days=[...daily.keys()].sort();
  const counts=new Map(); events.forEach(e=>{const label=e.review==='corrected'?e.reviewed_label:e.label;counts.set(label,(counts.get(label)||0)+1);});
  const ranks=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,8),max=Math.max(1,...ranks.map(r=>r[1]));
  return `${toolbar()}<div class="notice">统计对象是识别片段，已排除人工驳回结果。未复核预测仍可能误判；图表不能直接说明动物数量或生态恢复。没有采集的日期属于缺测，不记作零活动。</div><div class="grid">${panel('昼夜声音分布',`<div class="panel-body">${events.length?bars(hours,Array.from({length:24},(_,i)=>i%3===0?String(i).padStart(2,'0'):'') ):empty('尚无可统计的识别结果')}<p class="chart-summary">本机时区 · 每小时的识别片段数</p></div>`,'00:00 — 23:59')}${panel('声音类别构成',`<div class="panel-body">${ranks.map(([label,n])=>`<div class="rank"><div><span>${esc(translated(label))}</span><span>${n} 个片段</span></div><div class="rank-track"><i style="width:${n/max*100}%"></i></div></div>`).join('')||empty('等待声音数据')}</div>`,'TOP CLASSES')}</div>${panel('逐日采集与活动强度',days.length?`<div class="table-wrap"><table><thead><tr><th>采集日期</th><th>已分析录音时长</th><th>有效识别片段</th><th>片段 / 录音小时</th></tr></thead><tbody>${days.map(day=>{const d=daily.get(day);return `<tr><td>${day}</td><td>${(d.seconds/60).toFixed(2)} 分钟</td><td>${d.count}</td><td>${(d.count/(d.seconds/3600)).toFixed(1)}</td></tr>`;}).join('')}</tbody></table></div><div class="table-caption">短录音归一化后数值可能很大，此指标仅用于展示采样强度，不等于生态活动率。</div>`:empty('持续采集后，这里会形成时间序列'))}<div style="height:22px"></div>${panel('点位对比',`<div class="table-wrap"><table><thead><tr><th>终端</th><th>有效录音时长</th><th>识别片段</th><th>已复核片段</th></tr></thead><tbody>${state.devices.filter(d=>includeSim||!d.simulated).map(d=>{const rs=recordings.filter(r=>r.device_id===d.id),es=events.filter(e=>e.device_id===d.id);return `<tr><td>${esc(d.name)}</td><td>${(rs.reduce((s,r)=>s+r.duration,0)/60).toFixed(2)} 分钟</td><td>${es.length}</td><td>${es.filter(e=>e.review!=='pending').length}</td></tr>`;}).join('')}</tbody></table></div>`)}`;
}
function alertsPage() {
  const events=state.events.filter(e=>scope(e)&&e.alert);
  return `${toolbar()}<div class="notice">告警来自预设声音类别与阈值规则，须人工确认。派单目前保存负责人和处理记录，不会自动发送通知，也不会调度无人机。</div>${panel('声音告警',events.length?`<div class="table-wrap"><table><thead><tr><th>类型 / 声音</th><th>终端</th><th>采集时间</th><th>处理状态</th><th>负责人</th><th></th></tr></thead><tbody>${events.map(e=>`<tr><td><b>${esc(e.alert)}</b><small>${esc(translated(e.label))} · ${(e.score*100).toFixed(1)}%</small></td><td>${esc(nameOf(e.device_id))}${e.simulated?'<small>模拟数据</small>':''}</td><td>${fmtTime(e.captured_at)}</td><td>${tag(statusNames[e.alert_status],['open','assigned'].includes(e.alert_status)?'warn':'gray')}</td><td>${esc(e.assignee)||'未分配'}</td><td><button data-event="${e.id}">处理</button></td></tr>`).join('')}</tbody></table></div>`:empty('暂无告警<br>可以录制敲门或咳嗽，测试模型识别后的规则触发'),'RULE → REVIEW → RESPONSE')}`;
}
function render() {
  window.LingtingMap?.detach();
  current=location.hash.slice(1) in pages?location.hash.slice(1):'overview';
  const p=pages[current];
  $('#title').textContent=p[1]; $('#breadcrumb').textContent=p[1]; $('#eyebrow').textContent=p[2]; $('#subtitle').textContent=p[3];
  $('#nav').innerHTML=Object.entries(pages).map(([id,p])=>`<a href="#${id}" class="${current===id?'active':''}"><span>${p[0]}</span>${p[1]}</a>`).join('');
  $('#content').innerHTML=({overview,devices:devicesPage,archive:archivePage,review:reviewPage,trends:trendsPage,alerts:alertsPage})[current]();
  const slot=$('#map-slot');
  if(slot)window.LingtingMap?.sync(slot,{offlineHtml:renderOfflineMap(),devices:mapDevices().map(d=>{
    const events=state.events.filter(e=>e.device_id===d.id&&scope(e));
    return {...d,count:events.length,latest:events.length?`${translated(events[0].label)} · ${fmtTime(events[0].captured_at)}`:null};
  })});
}
function showRecording(id) {
  const r=state.recordings.find(r=>r.id===id); if(!r)return;
  $('#detail-content').innerHTML=`<div class="dialog-head"><h2>${esc(r.name)}</h2><button class="icon-button close">×</button></div><p class="detail-meta">${esc(nameOf(r.device_id))} · ${fmtTime(r.captured_at)}<br>${esc(r.source)} · ${r.duration.toFixed(2)}秒 ${r.simulated?'· 模拟数据':''}</p><audio controls src="/audio/${r.id}.wav"></audio><p><a href="/audio/${r.id}.wav" download="${esc(r.name)}">下载归档 WAV</a></p>${r.error?`<p class="error">${esc(r.error)}</p>`:''}${eventTable(state.events.filter(e=>e.recording_id===id),true)}`;
  if(!$('#detail-dialog').open)$('#detail-dialog').showModal();
}
function showEvent(id) {
  const e=state.events.find(e=>e.id===id); if(!e)return;
  $('#detail-content').innerHTML=`<div class="dialog-head"><div><p class="eyebrow">SOUND EVENT</p><h2>${esc(translated(e.label))}</h2></div><button class="icon-button close">×</button></div><p class="detail-meta">${esc(nameOf(e.device_id))} · ${fmtTime(e.captured_at)}<br>${esc(e.recording_name)} · 片段 ${e.start}～${(e.start+e.duration).toFixed(1)}秒 ${e.simulated?'· 模拟数据':''}</p><audio controls src="/audio/${e.recording_id}.wav#t=${e.start},${e.start+e.duration}"></audio><div>${e.predictions.slice(0,5).map(p=>`<div class="rank"><div><span>${esc(translated(p.label))}</span><span>${(p.score*100).toFixed(1)}%</span></div><div class="rank-track"><i style="width:${p.score*100}%"></i></div></div>`).join('')}</div><form id="review-form" data-id="${e.id}" class="dialog-section"><h3>人工复核</h3><div class="split"><label>复核结论<select name="review"><option value="confirmed">确认模型结果</option><option value="corrected" ${e.review==='corrected'?'selected':''}>纠正类别</option><option value="rejected" ${e.review==='rejected'?'selected':''}>驳回此片段</option></select></label><label>纠正后的标签<input name="label" maxlength="160" value="${esc(e.reviewed_label||'')}" placeholder="纠正时必填"></label></div><button class="primary">保存复核</button> ${tag(statusNames[e.review],e.review==='pending'?'warn':'')}</form>${e.alert?`<form id="alert-form" data-id="${e.id}" class="dialog-section"><h3>${esc(e.alert)} · 处理记录</h3><div class="split"><label>处理状态<select name="status">${['open','assigned','resolved','dismissed'].map(s=>`<option value="${s}" ${s===e.alert_status?'selected':''}>${statusNames[s]}</option>`).join('')}</select></label><label>负责人<input name="assignee" maxlength="80" value="${esc(e.assignee)}"></label></div><label>处理说明<textarea name="note" rows="3" maxlength="1000">${esc(e.note)}</textarea></label><button class="primary">保存处理记录</button><p class="alert-note">派单需填写负责人；结案或误报需填写说明。此处不会自动向他人发送消息。</p></form>`:''}<div class="dialog-section"><h3>变更历史</h3>${state.audit.filter(a=>a.event_id===id).map(a=>`<p class="muted">${fmtTime(a.created_at)} · ${a.action==='review'?'人工复核':'告警处理'}<br>${esc(a.detail)}</p>`).join('')||'<p class="muted">尚无操作记录</p>'}</div>`;
  if(!$('#detail-dialog').open)$('#detail-dialog').showModal();
}
document.addEventListener('click',async event=>{
  const target=event.target.closest('button,a,[data-device]'); if(!target)return;
  try {
    if(target.classList.contains('close')){ if(target.closest('dialog').id==='upload-dialog'&&(recording||uploadBusy)){toast('请先停止录音或等待上传完成');return;} target.closest('dialog').close(); }
    if(target.dataset.event)showEvent(target.dataset.event);
    if(target.dataset.recording)showRecording(target.dataset.recording);
    if(target.dataset.device){selectedDevice=target.dataset.device;location.hash='devices';render();}
    if(target.dataset.filterDevice)deviceFilter=target.dataset.filterDevice;
    if(target.dataset.action==='demo'){
      target.disabled=true;await api('/api/demo',{});includeSim=true;await refresh();toast('模拟终端已上传猫叫样例，后台正在真实识别');
    }
    if(target.dataset.retry){await api(`/api/retry/${target.dataset.retry}`,{});await refresh();toast('已重新排队');}
    if(target.id==='add-device')$('#device-dialog').showModal();
    if(target.id==='export'){
      const data=await api('/api/export');const link=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));link.href=url;link.download=`灵听记录-${localDay(new Date())}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
  } catch(error){toast(error.message);target.disabled=false;}
});
document.addEventListener('change',event=>{
  const el=event.target;
  if(el.id==='include-sim')includeSim=el.checked;
  else if(el.id==='device-filter')deviceFilter=el.value;
  else if(el.id==='date-filter')dateFilter=el.value;
  else if(el.id==='search')search=el.value;
  else if(el.id==='review-filter')reviewFilter=el.value;
  else return;
  render();
});
document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!['review-form','alert-form','device-form'].includes(form.id))return;
  event.preventDefault(); const body=Object.fromEntries(new FormData(form));
  try {
    if(form.id==='device-form'){
      body.lat=body.lat===''?null:Number(body.lat);body.lon=body.lon===''?null:Number(body.lon);body.simulated=body.simulated==='on';
      await api('/api/devices',body);$('#device-dialog').close();form.reset();await refresh();toast('终端已登记，等待上报');
    }else{
      body.action=form.id==='review-form'?'review':'alert';await api(`/api/events/${form.dataset.id}`,body);await refresh();showEvent(form.dataset.id);toast('记录已保存');
    }
  }catch(error){toast(error.message);}
});
$('#new-audio').addEventListener('click',()=>{
  $('#upload-device').innerHTML=state.devices.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}${d.simulated?'（模拟）':''}</option>`).join('');
  $('#upload-progress').textContent='';$('#upload-dialog').showModal();
});
function wavEncode(samples) {
  const buffer=new ArrayBuffer(44+samples.length*2), v=new DataView(buffer);
  const str=(offset,s)=>[...s].forEach((c,i)=>v.setUint8(offset+i,c.charCodeAt(0)));
  str(0,'RIFF');v.setUint32(4,36+samples.length*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,samples.length*2,true);
  samples.forEach((x,i)=>v.setInt16(44+i*2,Math.max(-1,Math.min(1,x))* (x<0?32768:32767),true));
  const bytes=new Uint8Array(buffer);let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(binary);
}
async function convert(buffer) {
  const length=Math.round(buffer.duration*16000);const offline=new OfflineAudioContext(1,length,16000);const source=offline.createBufferSource();source.buffer=buffer;source.connect(offline.destination);source.start();return (await offline.startRendering()).getChannelData(0);
}
async function submitAudio(samples,name,source) {
  uploadBusy=true;$('#upload-submit').disabled=true;$('#record').disabled=true;
  try {
    $('#upload-progress').textContent='正在归档音频…';
    const fields=Object.fromEntries(new FormData($('#upload-form')));
    await api('/api/upload',{...fields,threshold:Number(fields.threshold),captured_at:fields.captured_at?new Date(fields.captured_at).toISOString():undefined,audio:wavEncode(samples),name,source});
    $('#upload-dialog').close();if(state.devices.find(d=>d.id===fields.device_id)?.simulated)includeSim=true;dateFilter='';deviceFilter='';search='';location.hash='archive';await refresh();toast('录音已归档，模型正在后台排队识别');
  }finally{uploadBusy=false;$('#upload-submit').disabled=false;$('#record').disabled=false;}
}
$('#upload-form').addEventListener('submit',async event=>{
  event.preventDefault();if(uploadBusy||recording)return;const file=$('#audio-file').files[0];if(!file){toast('请先选择音频文件，或使用录音按钮');return;}
  const context=new AudioContext();
  try{uploadBusy=true;$('#upload-submit').disabled=true;$('#record').disabled=true;$('#upload-progress').textContent='正在解码与转换音频…';if(file.size>40*1024*1024)throw new Error('文件超过40 MB，请先截取120秒以内片段');const buffer=await context.decodeAudioData(await file.arrayBuffer());if(buffer.duration>120||buffer.duration<.1)throw new Error('请选择0.1～120秒的录音，文件不会被静默截断');await submitAudio(await convert(buffer),file.name,'网页文件上传');}
  catch(error){$('#upload-progress').textContent=error.message;}
  finally{uploadBusy=false;$('#upload-submit').disabled=false;$('#record').disabled=false;await context.close();}
});
async function stopRecord() {
  if(!recording)return;const r=recording;recording=null;clearInterval(r.timer);r.node.disconnect();r.source.disconnect();r.stream.getTracks().forEach(t=>t.stop());
  $('#record').textContent='● 录制10秒';
  try{const n=r.chunks.reduce((s,c)=>s+c.length,0);if(!n)throw new Error('没有采集到音频，请检查麦克风');const buffer=r.context.createBuffer(1,n,r.context.sampleRate);let pos=0;for(const chunk of r.chunks){buffer.getChannelData(0).set(chunk,pos);pos+=chunk.length;}await submitAudio(await convert(buffer),`麦克风-${Date.now()}.wav`,'麦克风采集');}
  catch(error){$('#upload-progress').textContent=error.message;}
  finally{await r.context.close();$('#upload-submit').disabled=false;}
}
$('#record').addEventListener('click',async()=>{
  if(recording){await stopRecord();return;}if(uploadBusy)return;
  let stream,context;
  try{
    $('#record').disabled=true;stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});context=new AudioContext();await context.resume();
    const source=context.createMediaStreamSource(stream),node=context.createScriptProcessor(4096,1,1),chunks=[];node.onaudioprocess=e=>chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));source.connect(node);node.connect(context.destination);
    const start=performance.now();recording={stream,context,source,node,chunks};$('#upload-submit').disabled=true;$('#record').textContent='■ 停止并上传识别';
    recording.timer=setInterval(()=>{const seconds=(performance.now()-start)/1000;$('#upload-progress').textContent=`正在录音 ${Math.min(10,seconds).toFixed(1)} / 10秒；再次点击会保存并识别`;if(seconds>=10)stopRecord();},100);
  }catch(error){stream?.getTracks().forEach(t=>t.stop());await context?.close();$('#upload-progress').textContent=`麦克风不可用：${error.message}`;}
  finally{$('#record').disabled=false;}
});
$('#upload-dialog').addEventListener('cancel',e=>{if(recording||uploadBusy)e.preventDefault();});
window.addEventListener('hashchange',()=>{search='';reviewFilter='';render();});
window.addEventListener('beforeunload',()=>recording?.stream.getTracks().forEach(t=>t.stop()));
await refresh();
setInterval(()=>{const active=document.activeElement;refresh(!document.querySelector('dialog[open]')&&!['INPUT','SELECT','TEXTAREA'].includes(active?.tagName));$('#clock').textContent=new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'});},3000);
