import './style.css';

const SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 10;
const MAX_FILE_CHUNKS = 12;

const $ = (selector) => document.querySelector(selector);
const recordButton = $('#record-btn');
const demoButton = $('#demo-btn');
const fileInput = $('#file-input');
const predictions = $('#predictions');
const emptyResult = $('#empty-result');
const modelPill = $('#model-pill');
const latency = $('#latency');
const timer = $('#timer');
const waveform = $('#waveform');
const canvasContext = waveform.getContext('2d');

const labelTranslations = new Map([
  ['Speech', '人声'], ['Conversation', '交谈'], ['Narration, monologue', '独白'],
  ['Child speech, kid speaking', '儿童说话'], ['Baby cry, infant cry', '婴儿哭声'],
  ['Crying, sobbing', '哭泣'], ['Screaming', '尖叫'], ['Laughter', '笑声'],
  ['Cough', '咳嗽'], ['Sneeze', '喷嚏'], ['Whistling', '口哨'],
  ['Dog', '狗叫'], ['Bark', '犬吠'], ['Cat', '猫'], ['Meow', '猫叫'],
  ['Bird', '鸟鸣'], ['Bird vocalization, bird call, bird song', '鸟鸣'],
  ['Rain', '雨声'], ['Thunder', '雷声'], ['Wind', '风声'], ['Water', '水声'],
  ['Vehicle', '车辆'], ['Car', '汽车'], ['Vehicle horn, car horn, honking', '汽车鸣笛'],
  ['Siren', '警笛'], ['Ambulance (siren)', '救护车警笛'], ['Police car (siren)', '警车警笛'],
  ['Fire engine, fire truck (siren)', '消防车警笛'], ['Train', '火车'], ['Aircraft', '飞机'],
  ['Doorbell', '门铃'], ['Knock', '敲门'], ['Glass', '玻璃声'], ['Glass breaking', '玻璃破碎'],
  ['Smoke detector, smoke alarm', '烟雾报警器'], ['Fire alarm', '火警'],
  ['Gunshot, gunfire', '枪声'], ['Explosion', '爆炸'], ['Fire', '火焰'],
  ['Music', '音乐'], ['Silence', '静音'], ['Inside, small room', '室内小空间'],
  ['Outside, urban or manmade', '城市户外'], ['Outside, rural or natural', '自然户外'],
]);

const wakeRules = [
  { id: 'danger', icon: '!', name: '安全预警', hint: '火警 / 玻璃破碎 / 爆炸 / 尖叫', color: '#ff6b62', patterns: ['smoke alarm', 'fire alarm', 'glass breaking', 'gunshot', 'explosion', 'screaming'] },
  { id: 'road', icon: '↗', name: '道路提醒', hint: '车辆鸣笛 / 警笛 / 列车', color: '#ffb45f', patterns: ['vehicle horn', 'car horn', 'honking', 'siren', 'train horn'] },
  { id: 'care', icon: '+', name: '照护提醒', hint: '婴儿哭声 / 咳嗽 / 哭泣', color: '#6be6c1', patterns: ['baby cry', 'infant cry', 'cough', 'crying', 'sobbing'] },
  { id: 'visitor', icon: '⌂', name: '访客提醒', hint: '敲门 / 门铃', color: '#74b9ff', patterns: ['knock', 'doorbell'] },
];

let enabledRules = new Set(wakeRules.map((rule) => rule.id));
let threshold = Number($('#threshold').value);
let samples = JSON.parse(localStorage.getItem('lingting-pseudo-labels') || '[]');
let eventItems = [];
let audioSession = null;
let requestCounter = 0;
let modelReady = false;

const worker = new Worker(new URL('./model.worker.js', import.meta.url), { type: 'module' });
const pending = new Map();

worker.addEventListener('message', ({ data }) => {
  if (data.type === 'progress') {
    const percent = Number.isFinite(data.progress?.progress) ? Math.round(data.progress.progress) : null;
    setModelStatus(percent === null ? '正在准备模型…' : `正在下载模型 ${percent}%`, 'loading');
    return;
  }
  if (data.type === 'ready') {
    modelReady = true;
    setModelStatus('AST 模型已就绪', 'ready');
  }
  const resolver = pending.get(data.requestId);
  if (resolver) {
    pending.delete(data.requestId);
    data.type === 'error' ? resolver.reject(new Error(data.message)) : resolver.resolve(data);
  }
});

function workerRequest(type, payload = {}, transfer = []) {
  const requestId = ++requestCounter;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    worker.postMessage({ type, requestId, ...payload }, transfer);
  });
}

async function ensureModel() {
  if (modelReady) return;
  setModelStatus('正在初始化模型…', 'loading');
  await workerRequest('load');
}

function setModelStatus(text, state = '') {
  modelPill.className = `status-pill ${state}`;
  modelPill.querySelector('span').textContent = text;
}

function translateLabel(label) {
  return labelTranslations.get(label) || label;
}

function renderRules() {
  $('#rules').innerHTML = wakeRules.map((rule) => `
    <button class="rule ${enabledRules.has(rule.id) ? 'enabled' : ''}" data-rule="${rule.id}" style="--rule-color:${rule.color}">
      <span>${rule.icon}</span><div><b>${rule.name}</b><small>${rule.hint}</small></div><i></i>
    </button>
  `).join('');
}

function renderSamples() {
  $('#sample-count').textContent = samples.length;
}

function renderLog() {
  const container = $('#event-log');
  if (!eventItems.length) {
    container.innerHTML = '<div class="log-empty">还没有识别事件</div>';
    return;
  }
  container.innerHTML = eventItems.map((item) => `
    <div class="log-item ${item.wake ? 'wake' : ''}">
      <time>${item.time}</time>
      <div><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.detail)}</small></div>
      <strong>${Math.round(item.score * 100)}%</strong>
    </div>
  `).join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function renderPredictions(results, segmentLabel) {
  emptyResult.hidden = true;
  predictions.hidden = false;
  predictions.innerHTML = results.slice(0, 5).map((result, index) => {
    const percent = Math.max(1, Math.round(result.score * 100));
    return `<div class="prediction ${index === 0 ? 'top' : ''}">
      <div class="prediction-head"><span><i>${String(index + 1).padStart(2, '0')}</i><b>${escapeHtml(translateLabel(result.label))}</b><small>${escapeHtml(result.label)}</small></span><strong>${percent}%</strong></div>
      <div class="bar"><i style="width:${percent}%"></i></div>
    </div>`;
  }).join('') + `<p class="segment-label">${segmentLabel}</p>`;
}

function evaluateWake(results) {
  const matches = [];
  for (const result of results) {
    if (result.score < threshold) continue;
    const label = result.label.toLowerCase();
    for (const rule of wakeRules) {
      if (enabledRules.has(rule.id) && rule.patterns.some((pattern) => label.includes(pattern))) {
        matches.push({ rule, result });
      }
    }
  }
  const best = matches.sort((a, b) => b.result.score - a.result.score)[0];
  const banner = $('#wake-banner');
  if (!best) {
    banner.className = 'wake-banner idle';
    banner.innerHTML = '<span>●</span><div><b>系统待命</b><small>本片段未命中场景唤醒规则</small></div>';
    return null;
  }
  banner.className = 'wake-banner triggered';
  banner.style.setProperty('--wake-color', best.rule.color);
  banner.innerHTML = `<span>${best.rule.icon}</span><div><b>${best.rule.name}已唤醒</b><small>${escapeHtml(translateLabel(best.result.label))} · ${(best.result.score * 100).toFixed(1)}%</small></div>`;
  return best;
}

function storePseudoLabel(results, source, segment) {
  const top = results[0];
  if (!top || top.score < threshold) return;
  samples.unshift({
    createdAt: new Date().toISOString(), source, segment,
    pseudoLabel: top.label, confidence: top.score,
    top3: results.slice(0, 3), reviewed: false,
  });
  samples = samples.slice(0, 100);
  localStorage.setItem('lingting-pseudo-labels', JSON.stringify(samples));
  renderSamples();
}

async function classifyChunk(chunk, source, segmentIndex, segmentCount) {
  latency.textContent = '模型推理中…';
  const transferable = chunk.slice();
  const response = await workerRequest('classify', { audio: transferable.buffer }, [transferable.buffer]);
  const results = Array.isArray(response.results[0]) ? response.results[0] : response.results;
  const segmentLabel = `${source} · 片段 ${segmentIndex + 1}/${segmentCount} · ${CHUNK_SECONDS} 秒窗口`;
  renderPredictions(results, segmentLabel);
  latency.textContent = `${response.latencyMs} ms`;
  const wake = evaluateWake(results);
  const top = results[0];
  eventItems.unshift({
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    label: translateLabel(top.label),
    detail: wake ? `${wake.rule.name} · ${source}` : `普通事件 · ${source}`,
    score: top.score,
    wake: Boolean(wake),
  });
  eventItems = eventItems.slice(0, 30);
  renderLog();
  storePseudoLabel(results, source, segmentIndex);
}

async function analyzeAudio(audio, source) {
  try {
    await ensureModel();
    const fullChunkSize = SAMPLE_RATE * CHUNK_SECONDS;
    const segmentCount = Math.min(MAX_FILE_CHUNKS, Math.max(1, Math.ceil(audio.length / fullChunkSize)));
    for (let index = 0; index < segmentCount; index += 1) {
      const start = index * fullChunkSize;
      let chunk = audio.slice(start, Math.min(start + fullChunkSize, audio.length));
      if (chunk.length < fullChunkSize) {
        const padded = new Float32Array(fullChunkSize);
        padded.set(chunk);
        chunk = padded;
      }
      await classifyChunk(chunk, source, index, segmentCount);
    }
  } catch (error) {
    console.error(error);
    latency.textContent = '分析失败';
    setModelStatus('模型加载失败', 'error');
    alert(`分析失败：${error.message}\n\n请确认网络可访问 hf-mirror.com，然后刷新重试。`);
  }
}

function mergeChunks(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function resampleLinear(input, inputRate, outputRate = SAMPLE_RATE) {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const output = new Float32Array(Math.round(input.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const weight = position - left;
    output[index] = input[left] * (1 - weight) + input[right] * weight;
  }
  return output;
}

function updateMeter(data) {
  let energy = 0;
  for (const sample of data) energy += sample * sample;
  const rms = Math.sqrt(energy / Math.max(1, data.length));
  const db = rms ? 20 * Math.log10(rms) : -Infinity;
  const meterValue = Math.max(0, Math.min(100, (db + 60) * (100 / 60)));
  $('#level').style.width = `${meterValue}%`;
  $('#level-text').textContent = Number.isFinite(db) ? `${db.toFixed(1)} dB` : '-∞ dB';
  drawWave(data);
}

function drawWave(data = new Float32Array(128)) {
  const ratio = window.devicePixelRatio || 1;
  const rect = waveform.getBoundingClientRect();
  if (waveform.width !== Math.round(rect.width * ratio)) {
    waveform.width = Math.round(rect.width * ratio);
    waveform.height = Math.round(150 * ratio);
  }
  const width = waveform.width;
  const height = waveform.height;
  canvasContext.clearRect(0, 0, width, height);
  canvasContext.strokeStyle = 'rgba(101, 232, 199, .12)';
  canvasContext.lineWidth = ratio;
  for (let row = 1; row < 4; row += 1) {
    canvasContext.beginPath();
    canvasContext.moveTo(0, (height / 4) * row);
    canvasContext.lineTo(width, (height / 4) * row);
    canvasContext.stroke();
  }
  const gradient = canvasContext.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, '#42d3ff');
  gradient.addColorStop(1, '#72f0bc');
  canvasContext.strokeStyle = gradient;
  canvasContext.lineWidth = 2 * ratio;
  canvasContext.beginPath();
  const stride = Math.max(1, Math.floor(data.length / Math.max(1, width / ratio)));
  for (let index = 0, x = 0; index < data.length; index += stride, x += ratio) {
    const y = height / 2 + data[index] * height * 0.42;
    if (index === 0) canvasContext.moveTo(x, y); else canvasContext.lineTo(x, y);
  }
  canvasContext.stroke();
}

async function startRecording() {
  if (audioSession) {
    stopRecording(true);
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    const startedAt = performance.now();
    processor.onaudioprocess = (event) => {
      const data = new Float32Array(event.inputBuffer.getChannelData(0));
      chunks.push(data);
      updateMeter(data);
    };
    source.connect(processor);
    processor.connect(context.destination);
    audioSession = { stream, context, source, processor, chunks, startedAt };
    recordButton.classList.add('recording');
    recordButton.innerHTML = '<span class="record-dot"></span>停止并分析';
    const tick = () => {
      if (!audioSession) return;
      const elapsed = Math.min(CHUNK_SECONDS, (performance.now() - startedAt) / 1000);
      timer.textContent = `00:${String(Math.floor(elapsed)).padStart(2, '0')}`;
      if (elapsed >= CHUNK_SECONDS) stopRecording(false);
      else audioSession.animation = requestAnimationFrame(tick);
    };
    tick();
  } catch (error) {
    alert(`无法使用麦克风：${error.message}\n请在浏览器地址栏允许麦克风权限。`);
  }
}

async function stopRecording(cancelled) {
  const session = audioSession;
  if (!session) return;
  audioSession = null;
  cancelAnimationFrame(session.animation);
  session.processor.disconnect();
  session.source.disconnect();
  session.stream.getTracks().forEach((track) => track.stop());
  await session.context.close();
  recordButton.classList.remove('recording');
  recordButton.innerHTML = '<span class="record-dot"></span>监听 10 秒';
  timer.textContent = '00:00';
  if (!cancelled && session.chunks.length) {
    const merged = mergeChunks(session.chunks);
    const resampled = resampleLinear(merged, session.context.sampleRate);
    await analyzeAudio(resampled.slice(0, SAMPLE_RATE * CHUNK_SECONDS), '麦克风');
  }
}

async function decodeFile(file) {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const mono = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) mono[index] += data[index] / buffer.numberOfChannels;
    }
    return resampleLinear(mono, buffer.sampleRate);
  } finally {
    await context.close();
  }
}

recordButton.addEventListener('click', startRecording);
fileInput.addEventListener('change', async () => {
  const [file] = fileInput.files;
  if (!file) return;
  latency.textContent = '音频解码中…';
  try {
    const audio = await decodeFile(file);
    drawWave(audio.slice(0, Math.min(audio.length, SAMPLE_RATE)));
    await analyzeAudio(audio, file.name);
  } catch (error) {
    alert(`无法读取音频：${error.message}`);
  } finally {
    fileInput.value = '';
  }
});

demoButton.addEventListener('click', async () => {
  demoButton.disabled = true;
  demoButton.textContent = '演示推理中…';
  latency.textContent = '读取演示音频…';
  try {
    const response = await fetch('/cat_meow.wav');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const file = new File([await response.blob()], 'cat_meow.wav', { type: 'audio/wav' });
    const audio = await decodeFile(file);
    drawWave(audio.slice(0, Math.min(audio.length, SAMPLE_RATE)));
    await analyzeAudio(audio, '内置演示：猫叫');
  } catch (error) {
    alert(`演示样例运行失败：${error.message}`);
  } finally {
    demoButton.disabled = false;
    demoButton.textContent = '运行演示样例';
  }
});

$('#rules').addEventListener('click', (event) => {
  const button = event.target.closest('[data-rule]');
  if (!button) return;
  const id = button.dataset.rule;
  enabledRules.has(id) ? enabledRules.delete(id) : enabledRules.add(id);
  renderRules();
});

$('#threshold').addEventListener('input', (event) => {
  threshold = Number(event.target.value);
  $('#threshold-value').textContent = threshold.toFixed(2);
});

$('#clear-log').addEventListener('click', () => { eventItems = []; renderLog(); });
$('#clear-samples').addEventListener('click', () => {
  samples = [];
  localStorage.removeItem('lingting-pseudo-labels');
  renderSamples();
});
$('#export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(samples, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `lingting-pseudo-labels-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

renderRules();
renderSamples();
renderLog();
drawWave();
