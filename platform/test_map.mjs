// Deterministic map lifecycle tests. No public map tiles are requested by tests.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
const source=await readFile(new URL('./web/map.js',import.meta.url),'utf8');
const {document,window}=parseHTML('<html><body><div id="slot"></div></body></html>');
const stats={maps:0,fits:0,markers:[],layers:[],callbacks:{}};
const map={fitBounds(){stats.fits++;return this;},setView(){return this;},hasLayer(x){return stats.layers.includes(x);},removeLayer(x){stats.layers=stats.layers.filter(l=>l!==x);},invalidateSize(){},};
const group={items:[],addTo(){return this;},eachLayer(fn){this.items.forEach(fn);},clearLayers(){this.items=[];}};
window.L={
  map(){stats.maps++;return map;},
  tileLayer(url,options){assert.equal(url,'https://tile.openstreetmap.org/{z}/{x}/{y}.png');assert.ok(options.attribution.includes('OpenStreetMap contributors'));return {addTo(){stats.layers.push(this);return this;},on(name,fn){stats.callbacks[name]=fn;return this;}};},
  layerGroup(){return group;},divIcon(o){return o;},
  marker(coords,options){const m={coords,options,open:false,addTo(g){g.items.push(this);return this;},bindPopup(html){this.html=html;return this;},isPopupOpen(){return this.open;},openPopup(){this.open=true;return this;}};stats.markers.push(m);return m;},
};
new Function('window','document','setTimeout','clearTimeout',source)(window,document,()=>0,()=>{});
const data={devices:[{id:'x"<>',name:'<img src=x onerror=alert(1)>',lat:30,lon:120,online:true,simulated:true,battery:50,storage:10,count:2,latest:'Knock'}],offlineHtml:'<p>离线点位测试</p>'};
window.LingtingMap.sync(document.querySelector('#slot'),data);
assert.equal(stats.maps,1);assert.equal(group.items.length,1);
assert.deepEqual(group.items[0].coords,[30,120]);assert.ok(!group.items[0].html.includes('<img'));
group.items[0].openPopup();const root=document.querySelector('.geo-shell'),fitCount=stats.fits;
window.LingtingMap.detach();document.body.innerHTML='<div id="slot"></div>';
window.LingtingMap.sync(document.querySelector('#slot'),data);
assert.equal(document.querySelector('.geo-shell'),root);assert.equal(stats.maps,1);assert.equal(stats.fits,fitCount);assert.equal(group.items[0].open,true);
const updated={...data,devices:[{...data.devices[0],count:3}]};
window.LingtingMap.detach();document.body.innerHTML='<div id="slot"></div>';window.LingtingMap.sync(document.querySelector('#slot'),updated);
assert.equal(stats.fits,fitCount);assert.equal(group.items[0].open,true);assert.ok(group.items[0].html.includes('3 个识别片段'));
stats.callbacks.tileerror();assert.ok(document.querySelector('.map-status').textContent.includes('加载失败'));
document.querySelector('.map-toggle').click();assert.equal(stats.layers.length,0);assert.equal(document.querySelector('.geo-fallback').hidden,false);
document.querySelector('.map-toggle').click();assert.equal(stats.layers.length,1);assert.equal(document.querySelector('.geo-map').hidden,false);
const second=parseHTML('<html><body><div id="slot"></div></body></html>');
new Function('window','document','setTimeout','clearTimeout',source)(second.window,second.document,()=>0,()=>{});
// linkedom's window globals may be shared; explicitly remove Leaflet to simulate failed script.
delete second.window.L;
second.window.LingtingMap.sync(second.document.querySelector('#slot'),data);
assert.equal(second.document.querySelector('.geo-fallback').hidden,false);
console.log('PASS map coordinates, escaping, persistent viewport/popup, tile failure, offline/retry and missing-library fallback');
