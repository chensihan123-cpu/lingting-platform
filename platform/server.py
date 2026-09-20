"""Local Lingting platform. Standard-library HTTP/SQLite + persistent Node AST worker."""
import argparse
import base64
import binascii
import io
import json
import queue
import sqlite3
import subprocess
import threading
import uuid
import wave
from datetime import datetime, timezone
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent
MODEL = 'Xenova/ast-finetuned-audioset-10-10-0.4593'
RULES = {
    '安全异常': ['smoke alarm', 'fire alarm', 'glass breaking', 'gunshot', 'explosion', 'screaming'],
    '道路干扰': ['vehicle horn', 'honking', 'siren', 'train horn'],
    '照护提醒': ['baby cry', 'cough', 'crying', 'sobbing'],
    '访客提醒': ['knock', 'doorbell'],
    '人为活动': ['chainsaw'],
}

def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')

def uid():
    return uuid.uuid4().hex

def validate_wav(raw):
    try:
        with wave.open(io.BytesIO(raw), 'rb') as w:
            if w.getsampwidth() != 2 or w.getframerate() != 16000 or w.getnchannels() not in (1, 2):
                raise ValueError('终端录音须为 16 kHz、16-bit PCM WAV，单/双声道；网页上传会自动转换。')
            duration = w.getnframes() / w.getframerate()
            if not 0.1 <= duration <= 120:
                raise ValueError('单条音频长度须为 0.1～120 秒；长录音请在终端分段上传。')
            if len(w.readframes(w.getnframes())) != w.getnframes() * w.getnchannels() * 2:
                raise ValueError('WAV 音频数据不完整。')
            return duration
    except (wave.Error, EOFError) as exc:
        raise ValueError('请上传有效的 PCM WAV 音频。') from exc

def detect_alert(predictions, threshold):
    for p in predictions:
        if p['score'] >= threshold:
            for name, patterns in RULES.items():
                if any(word in p['label'].lower() for word in patterns):
                    return name
    return None

class Store:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        (self.directory / 'audio').mkdir(exist_ok=True)
        self.db = self.directory / 'platform.sqlite3'
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, name TEXT, lat REAL, lon REAL,
                  simulated INTEGER, last_seen TEXT, battery REAL, storage REAL);
                CREATE TABLE IF NOT EXISTS recordings(id TEXT PRIMARY KEY, device_id TEXT, name TEXT,
                  captured_at TEXT, created_at TEXT, duration REAL, source TEXT, simulated INTEGER,
                  status TEXT, error TEXT, threshold REAL, lat REAL, lon REAL);
                CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, recording_id TEXT, start REAL,
                  duration REAL, label TEXT, score REAL, predictions TEXT, review TEXT, reviewed_label TEXT,
                  alert TEXT, alert_status TEXT, assignee TEXT, note TEXT);
                CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, event_id TEXT, created_at TEXT,
                  action TEXT, detail TEXT);
            ''')
            if 'score_method' not in [r['name'] for r in db.execute('PRAGMA table_info(recordings)')]:
                db.execute("ALTER TABLE recordings ADD COLUMN score_method TEXT DEFAULT 'softmax-legacy'")
            for row in [
                ('pc-local', '本机采集站', None, None, 0),
                ('sim-forest', '林地模拟终端', 30.250, 120.110, 1),
                ('sim-wetland', '湿地模拟终端', 30.263, 120.132, 1),
                ('sim-trail', '步道模拟终端', 30.239, 120.144, 1),
            ]:
                db.execute('INSERT OR IGNORE INTO devices(id,name,lat,lon,simulated) VALUES(?,?,?,?,?)', row)
            db.execute("UPDATE recordings SET status='queued', error=NULL WHERE status='processing'")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.db, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def register(self, body):
        device_id = str(body.get('id', '')).strip()
        name = str(body.get('name', '')).strip()
        if not device_id or len(device_id) > 64 or not name or len(name) > 80:
            raise ValueError('设备编号和名称必填，分别最多64和80个字符。')
        lat, lon = body.get('lat'), body.get('lon')
        if lat is not None or lon is not None:
            if not isinstance(lat, (float, int)) or not isinstance(lon, (float, int)) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise ValueError('请输入有效经纬度，或同时留空。')
        with self.connect() as db:
            if db.execute('SELECT 1 FROM devices WHERE id=?', (device_id,)).fetchone():
                raise ValueError('设备编号已存在。')
            db.execute('INSERT INTO devices(id,name,lat,lon,simulated) VALUES(?,?,?,?,?)',
                       (device_id, name, lat, lon, int(bool(body.get('simulated', False)))))
        return {'id': device_id}

    def heartbeat(self, body):
        for field in ('battery', 'storage'):
            value = body.get(field)
            if value is not None and (not isinstance(value, (int, float)) or not 0 <= value <= 100):
                raise ValueError('电量、存储已用率须为0～100。')
        with self.connect() as db:
            count = db.execute('UPDATE devices SET last_seen=?, battery=?, storage=? WHERE id=?',
                              (now(), body.get('battery'), body.get('storage'), body.get('id'))).rowcount
            if not count:
                raise ValueError('设备未注册。')
        return {'ok': True}

    def upload(self, body):
        device_id = body.get('device_id', 'pc-local')
        with self.connect() as db:
            device = db.execute('SELECT * FROM devices WHERE id=?', (device_id,)).fetchone()
        if not device:
            raise ValueError('设备未注册。')
        try:
            raw = base64.b64decode(body.get('audio', ''), validate=True)
        except (binascii.Error, TypeError) as exc:
            raise ValueError('音频编码无效。') from exc
        duration = validate_wav(raw)
        threshold = float(body.get('threshold', 0.25))
        if not 0.05 <= threshold <= 1:
            raise ValueError('阈值须为0.05～1。')
        captured_at = body.get('captured_at') or now()
        try:
            stamp = datetime.fromisoformat(captured_at.replace('Z', '+00:00'))
            if stamp.tzinfo is None:
                raise ValueError()
            captured_at = stamp.astimezone(timezone.utc).isoformat(timespec='seconds')
        except (ValueError, AttributeError):
            raise ValueError('采集时间须为带时区的 ISO 8601 时间。')
        recording_id = uid()
        path = self.directory / 'audio' / f'{recording_id}.wav'
        path.write_bytes(raw)
        try:
            with self.connect() as db:
                db.execute('INSERT INTO recordings VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (
                    recording_id, device_id, str(body.get('name', '录音.wav'))[:160], captured_at, now(),
                    duration, str(body.get('source', '终端上传'))[:80], device['simulated'], 'queued', None,
                    threshold, device['lat'], device['lon'], 'sigmoid'))
                db.execute('UPDATE devices SET last_seen=? WHERE id=?', (now(), device_id))
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return {'id': recording_id, 'status': 'queued'}

    def state(self, export=False):
        with self.connect() as db:
            devices = [dict(r) for r in db.execute('SELECT * FROM devices')]
            recordings = [dict(r) for r in db.execute('SELECT * FROM recordings ORDER BY created_at DESC, rowid DESC')]
            events = [dict(r) for r in db.execute('''SELECT e.*, r.device_id, r.captured_at, r.source,
                r.simulated, r.lat, r.lon, r.score_method, r.name AS recording_name FROM events e JOIN recordings r
                ON r.id=e.recording_id ORDER BY r.created_at DESC, e.start''')]
            audit = [dict(r) for r in db.execute('SELECT * FROM audit ORDER BY id DESC' + ('' if export else ' LIMIT 100'))]
        for d in devices:
            d['online'] = bool(d['last_seen'] and (datetime.now(timezone.utc) - datetime.fromisoformat(d['last_seen'])).total_seconds() < 90)
        for e in events:
            e['predictions'] = json.loads(e['predictions'])
        return {'devices': devices, 'recordings': recordings, 'events': events, 'audit': audit,
                'model': MODEL, 'server_time': now()}

    def update_event(self, event_id, body):
        with self.connect() as db:
            event = db.execute('SELECT * FROM events WHERE id=?', (event_id,)).fetchone()
            if not event:
                raise ValueError('事件不存在。')
            action = body.get('action')
            if action == 'review':
                review = body.get('review')
                label = str(body.get('label', '')).strip()[:160]
                if review not in ('confirmed', 'corrected', 'rejected') or (review == 'corrected' and not label):
                    raise ValueError('请选择复核结论；纠正时需填写标签。')
                db.execute('UPDATE events SET review=?, reviewed_label=? WHERE id=?',
                           (review, label if review == 'corrected' else event['label'], event_id))
            elif action == 'alert':
                status = body.get('status')
                assignee = str(body.get('assignee', '')).strip()[:80]
                note = str(body.get('note', '')).strip()[:1000]
                if not event['alert'] or status not in ('open', 'assigned', 'resolved', 'dismissed'):
                    raise ValueError('告警状态无效。')
                if status == 'assigned' and not assignee:
                    raise ValueError('派单须填写负责人。')
                if status in ('resolved', 'dismissed') and not note:
                    raise ValueError('结案或误报须填写处理说明。')
                db.execute('UPDATE events SET alert_status=?, assignee=?, note=? WHERE id=?',
                           (status, assignee, note, event_id))
            else:
                raise ValueError('操作无效。')
            db.execute('INSERT INTO audit(event_id,created_at,action,detail) VALUES(?,?,?,?)',
                       (event_id, now(), action, json.dumps(body, ensure_ascii=False)))
        return {'ok': True}

class Inference:
    def __init__(self, store):
        self.store = store
        self.jobs = queue.Queue()
        self.status = '待首次识别'
        self.process = None
        with store.connect() as db:
            for r in db.execute("SELECT id FROM recordings WHERE status='queued'"):
                self.jobs.put(r['id'])
        threading.Thread(target=self.run, daemon=True).start()

    def run(self):
        while True:
            recording_id = self.jobs.get()
            try:
                with self.store.connect() as db:
                    r = db.execute('SELECT * FROM recordings WHERE id=?', (recording_id,)).fetchone()
                    db.execute("UPDATE recordings SET status='processing',error=NULL,score_method='sigmoid' WHERE id=?", (recording_id,))
                self.status = '正在识别 / 首次加载可能较慢'
                if self.process is None or self.process.poll() is not None:
                    if hasattr(self, 'log'):
                        self.log.close()
                    self.log = open(self.store.directory / 'inference.log', 'a', encoding='utf-8')
                    self.process = subprocess.Popen(['node', str(ROOT / 'inference.mjs')], cwd=PROJECT,
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.log,
                        text=True, encoding='utf-8', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                self.process.stdin.write(json.dumps({'path': str(self.store.directory / 'audio' / f'{recording_id}.wav')}) + '\n')
                self.process.stdin.flush()
                # A bad model/runtime must not leave the entire queue stuck forever.
                watchdog = threading.Timer(300, self.process.kill)
                watchdog.daemon = True
                watchdog.start()
                try:
                    reply = self.process.stdout.readline()
                finally:
                    watchdog.cancel()
                if not reply:
                    raise RuntimeError('模型进程退出，请检查 data/inference.log。')
                result = json.loads(reply)
                if 'error' in result:
                    raise RuntimeError(result['error'])
                with self.store.connect() as db:
                    for segment in result['segments']:
                        predictions = segment['predictions']
                        best = predictions[0]
                        alert = detect_alert(predictions, r['threshold'])
                        db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', (
                            uid(), recording_id, segment['start'], segment['duration'], best['label'], best['score'],
                            json.dumps(predictions[:10]), 'pending', None, alert, 'open' if alert else None, '', ''))
                    db.execute("UPDATE recordings SET status='done' WHERE id=?", (recording_id,))
                self.status = 'AST 已就绪'
            except Exception as exc:
                with self.store.connect() as db:
                    db.execute("UPDATE recordings SET status='failed',error=? WHERE id=?", (str(exc)[:1000], recording_id))
                self.status = '最近任务失败，可在音频档案重试'
            finally:
                self.jobs.task_done()

def make_handler(store, inference):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            if args and '/api/state' in str(args[0]):
                return
            super().log_message(fmt, *args)

        def send(self, status, data, mime='application/json; charset=utf-8'):
            raw = json.dumps(data, ensure_ascii=False).encode('utf-8') if isinstance(data, (dict, list)) else data
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            if urlparse('http://' + self.headers.get('Host', '')).hostname not in ('127.0.0.1', 'localhost'):
                return self.send(403, {'error': '仅允许本机访问'})
            path = urlparse(self.path).path
            if path == '/api/state':
                state = store.state()
                state['inference_status'] = inference.status
                return self.send(200, state)
            if path == '/api/export':
                return self.send(200, store.state(export=True))
            vendor = {'/vendor/leaflet.js': ('leaflet.js', 'text/javascript; charset=utf-8'),
                      '/vendor/leaflet.css': ('leaflet.css', 'text/css; charset=utf-8')}
            if path in vendor:
                filename, mime = vendor[path]
                file = PROJECT / 'node_modules' / 'leaflet' / 'dist' / filename
                if file.exists():
                    return self.send(200, file.read_bytes(), mime)
                return self.send(404, {'error': 'Leaflet未安装，请在项目根目录运行 npm install'})
            if path.startswith('/audio/'):
                name = path.rsplit('/', 1)[-1]
                if len(name) != 36 or not name.endswith('.wav') or any(c not in '0123456789abcdef' for c in name[:-4]):
                    return self.send(404, {'error': '音频不存在'})
                file = store.directory / 'audio' / name
                if file.exists():
                    return self.send(200, file.read_bytes(), 'audio/wav')
            static = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
                      '/style.css': ('style.css', 'text/css; charset=utf-8'),
                      '/map.js': ('map.js', 'text/javascript; charset=utf-8'),
                      '/map.css': ('map.css', 'text/css; charset=utf-8')}
            if path in static:
                filename, mime = static[path]
                return self.send(200, (ROOT / 'web' / filename).read_bytes(), mime)
            return self.send(404, {'error': '页面不存在'})

        def do_POST(self):
            try:
                if urlparse('http://' + self.headers.get('Host', '')).hostname not in ('127.0.0.1', 'localhost'):
                    return self.send(403, {'error': '仅允许本机访问'})
                origin = self.headers.get('Origin')
                if origin and origin != f'http://{self.headers.get("Host")}':
                    return self.send(403, {'error': '不允许跨站写入'})
                if 'application/json' not in self.headers.get('Content-Type', ''):
                    return self.send(415, {'error': '仅支持 application/json'})
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= 12_000_000:
                    return self.send(413, {'error': '请求为空或超出12 MB'})
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError('请求须为 JSON 对象。')
                path = urlparse(self.path).path
                if path == '/api/devices':
                    result = store.register(body)
                elif path == '/api/heartbeat':
                    result = store.heartbeat(body)
                elif path in ('/api/upload', '/api/demo'):
                    if path == '/api/demo':
                        body = {'device_id': 'sim-forest', 'name': '公开猫叫样例.wav',
                                'source': '模拟终端·公开猫叫样例（真实推理）',
                                'audio': base64.b64encode((PROJECT / 'public' / 'cat_meow.wav').read_bytes()).decode()}
                        store.heartbeat({'id': 'sim-forest', 'battery': 86, 'storage': 12})
                    result = store.upload(body)
                    inference.jobs.put(result['id'])
                elif path.startswith('/api/events/'):
                    result = store.update_event(path.rsplit('/', 1)[-1], body)
                elif path.startswith('/api/retry/'):
                    recording_id = path.rsplit('/', 1)[-1]
                    with store.connect() as db:
                        count = db.execute("UPDATE recordings SET status='queued',error=NULL WHERE id=? AND status='failed'", (recording_id,)).rowcount
                    if not count:
                        raise ValueError('仅失败任务可重试。')
                    inference.jobs.put(recording_id)
                    result = {'ok': True}
                else:
                    return self.send(404, {'error': '接口不存在'})
                self.send(200, result)
            except (ValueError, TypeError) as exc:
                self.send(400, {'error': str(exc)})
            except Exception as exc:
                self.send(500, {'error': str(exc)})
    return Handler

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--data-dir', default=str(ROOT / 'data'))
    args = parser.parse_args()
    store = Store(args.data_dir)
    inference = Inference(store)
    httpd = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(store, inference))
    print(f'Lingting platform: http://127.0.0.1:{args.port}', flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if inference.process and inference.process.poll() is None:
            inference.process.terminate()
        httpd.server_close()
