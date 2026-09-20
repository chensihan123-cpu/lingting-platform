/* Map stays mounted across dashboard polling, preserving zoom and open popups. */
(() => {
  let root, map, tiles, layer, snapshot = '', geometry = '', options;
  let offline = false, loaded = 0, failed = 0, timer;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const valid = d => Number.isFinite(d.lat) && Number.isFinite(d.lon) && Math.abs(d.lat) <= 85.0511 && Math.abs(d.lon) <= 180;
  const q = s => root.querySelector(s);
  function message(text) { q('.map-status').textContent = text; }
  function fit() {
    const points = options.devices.filter(valid).map(d => [d.lat, d.lon]);
    if (points.length) map.fitBounds(points, {padding:[45,45], maxZoom:15, animate:false});
    else map.setView([35,105],4,{animate:false});
  }
  function startTiles() {
    if (!map || map.hasLayer(tiles)) return;
    loaded=0;failed=0;
    message('正在加载 OpenStreetMap 底图…');
    tiles.addTo(map);
    clearTimeout(timer);
    timer=setTimeout(()=>{if(!loaded&&!offline)message('底图暂未加载，请检查网络，或切换离线点位图。');},12000);
  }
  function create() {
    root=document.createElement('div');root.className='geo-shell';
    root.innerHTML='<div class="map-tools"><span>OpenStreetMap · WGS84 经纬度</span><div><button type="button" class="map-fit">定位全部终端</button><button type="button" class="map-toggle">离线点位图</button></div></div><div class="geo-map" aria-label="交互式终端地图"></div><div class="geo-fallback" hidden></div><div class="map-status" role="status"></div><div class="map-footnote">绿色：在线 · 灰色：离线 · 虚线边框：模拟终端。点位表示设备位置，不是声源位置。</div>';
    q('.map-toggle').addEventListener('click',()=>{
      offline=!offline;applyMode();
    });
    q('.map-fit').addEventListener('click',()=>{if(map&&!offline)fit();});
  }
  function initMap() {
    if (!window.L) { offline=true;applyMode();return; }
    map=window.L.map(q('.geo-map'),{scrollWheelZoom:false,attributionControl:true});
    tiles=window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19, minZoom:2, updateWhenIdle:true, keepBuffer:0,
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
    });
    layer=window.L.layerGroup().addTo(map);
    tiles.on('tileload',()=>{loaded++;if(!offline)message(failed?'部分底图未加载；终端标记仍可使用。':'底图已加载 · 可拖动、双击或使用 ＋/− 缩放');});
    tiles.on('tileerror',()=>{failed++;if(!offline)message('底图加载失败或不完整；可切换离线点位图，录音功能不受影响。');});
    fit();startTiles();
  }
  function applyMode() {
    q('.geo-map').hidden=offline;q('.geo-fallback').hidden=!offline;
    q('.map-toggle').textContent=offline?'重试在线地图':'离线点位图';
    q('.map-fit').disabled=offline;
    if(offline){if(map&&map.hasLayer(tiles))map.removeLayer(tiles);clearTimeout(timer);message(window.L?'离线点位模式：不加载网络底图。':'本地地图组件未加载，暂用离线点位图。请重启服务并刷新页面。');}
    else{if(!map)initMap();if(map){map.invalidateSize({pan:false});startTiles();}}
  }
  function popup(d) {
    return `<div class="device-popup"><b>${escape(d.name)}</b><p>${d.simulated?'模拟终端（示例坐标）':'真实终端'} · ${d.online?'在线':'离线'}<br>纬度 ${d.lat.toFixed(6)} / 经度 ${d.lon.toFixed(6)}<br>电量 ${d.battery==null?'未知':escape(d.battery)+'%'} · 存储已用 ${d.storage==null?'未知':escape(d.storage)+'%'}</p><p>${d.count} 个识别片段<br>最近事件：${escape(d.latest||'暂无')}</p><a href="#archive" data-filter-device="${escape(d.id)}">查看该终端录音 →</a></div>`;
  }
  window.LingtingMap = {
    detach() { if(root)root.remove(); },
    sync(slot, data) {
      options=data;
      if(!root)create();
      slot.replaceWith(root);
      q('.geo-fallback').innerHTML=data.offlineHtml;
      if(!map&&!offline)initMap();
      if(!map)return;
      const devices=data.devices.filter(valid);
      const nextGeometry=JSON.stringify(devices.map(d=>[d.id,d.lat,d.lon]));
      const nextSnapshot=JSON.stringify(devices);
      if(nextSnapshot!==snapshot){
        let openId;
        layer.eachLayer(marker=>{if(marker.isPopupOpen())openId=marker.deviceId;});
        layer.clearLayers();
        devices.forEach(d=>{
          const icon=window.L.divIcon({className:'terminal-marker',html:`<span class="terminal-dot ${d.online?'online':''} ${d.simulated?'simulated':''}"></span>`,iconSize:[26,26],iconAnchor:[13,13]});
          const marker=window.L.marker([d.lat,d.lon],{icon,title:d.name,keyboard:true}).addTo(layer).bindPopup(popup(d),{maxWidth:300,autoPan:false});
          marker.deviceId=d.id;
          if(d.id===openId)marker.openPopup();
        });
        snapshot=nextSnapshot;
      }
      map.invalidateSize({pan:false});
      if(geometry!==nextGeometry){geometry=nextGeometry;if(!offline)fit();}
      if(data.devices.length!==devices.length)message('部分坐标超出在线地图纬度范围，已跳过；可查看离线点位图。');
      if(!devices.length&&!failed&&loaded)message('底图已加载，暂无符合筛选条件的坐标。可登记终端或勾选“包含模拟数据”。');
    },
  };
})();
