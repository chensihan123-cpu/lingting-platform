import base64
import io
import json
import tempfile
import threading
import unittest
import wave
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from server import Store, make_handler, validate_wav, detect_alert, now

def wav_bytes(seconds=1, rate=16000):
    buffer=io.BytesIO()
    with wave.open(buffer,'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate)
        w.writeframes(b'\x00\x00'*int(seconds*rate))
    return buffer.getvalue()

class PlatformTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='lingting-test-')
        self.store=Store(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def upload(self, **kwargs):
        return self.store.upload({'audio':base64.b64encode(wav_bytes()).decode(), **kwargs})

    def test_audio_validation(self):
        self.assertEqual(validate_wav(wav_bytes()),1)
        for raw in (b'invalid', wav_bytes(0.05), wav_bytes(121), wav_bytes(1,8000),wav_bytes()[:-4]):
            with self.assertRaises(ValueError):validate_wav(raw)

    def test_device_registration_heartbeat(self):
        self.store.register({'id':'real-1','name':'Station','lat':30,'lon':120})
        self.assertFalse(next(d for d in self.store.state()['devices'] if d['id']=='real-1')['online'])
        self.store.heartbeat({'id':'real-1','battery':55,'storage':12})
        self.assertTrue(next(d for d in self.store.state()['devices'] if d['id']=='real-1')['online'])
        for body in ({'id':'none'},{'id':'real-1','battery':101}):
            with self.assertRaises(ValueError):self.store.heartbeat(body)
        with self.assertRaises(ValueError):self.store.register({'id':'real-1','name':'Duplicate'})
        with self.assertRaises(ValueError):self.store.register({'id':'bad','name':'Bad','lat':91,'lon':120})

    def test_archive_survives_restart_and_marks_simulation(self):
        result=self.upload(device_id='sim-forest',captured_at='2026-09-18T12:00:00+08:00',name='<script>.wav')
        reopened=Store(self.tmp.name).state()
        r=reopened['recordings'][0]
        self.assertEqual(r['id'],result['id']);self.assertEqual(r['simulated'],1)
        self.assertEqual(r['lat'],30.25);self.assertEqual(r['score_method'],'sigmoid')
        self.assertTrue((self.store.directory/'audio'/f"{r['id']}.wav").exists())

    def test_invalid_upload_does_not_archive(self):
        for fields in ({'threshold':2},{'device_id':'missing'},{'captured_at':'not-a-date'},{'captured_at':'2026-09-18T12:00:00'}):
            with self.assertRaises(ValueError):self.upload(**fields)
        self.assertEqual(self.store.state()['recordings'],[])

    def test_rules_respect_threshold(self):
        self.assertEqual(detect_alert([{'label':'Knock','score':.7}],.25),'访客提醒')
        self.assertIsNone(detect_alert([{'label':'Knock','score':.1}],.25))
        self.assertIsNone(detect_alert([{'label':'Meow','score':.9}],.25))

    def test_review_and_alert_history(self):
        r=self.upload()
        with self.store.connect() as db:
            db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                ('test-event',r['id'],0,1,'Knock',.8,'[]','pending',None,'访客提醒','open','',''))
        self.store.update_event('test-event',{'action':'review','review':'corrected','label':'Tap'})
        with self.assertRaises(ValueError):self.store.update_event('test-event',{'action':'alert','status':'assigned'})
        self.store.update_event('test-event',{'action':'alert','status':'assigned','assignee':'测试负责人'})
        with self.assertRaises(ValueError):self.store.update_event('test-event',{'action':'alert','status':'resolved'})
        self.store.update_event('test-event',{'action':'alert','status':'resolved','assignee':'测试负责人','note':'测试完成'})
        state=Store(self.tmp.name).state(); e=state['events'][0]
        self.assertEqual(e['label'],'Knock');self.assertEqual(e['reviewed_label'],'Tap')
        self.assertEqual(e['alert_status'],'resolved');self.assertEqual(len(state['audit']),3)

    def test_http_routes_and_origin(self):
        import queue
        class FakeInference:
            status='test'; jobs=queue.Queue()
        server=ThreadingHTTPServer(('127.0.0.1',0),make_handler(self.store,FakeInference()))
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base=f'http://127.0.0.1:{server.server_port}'
        try:
            with urlopen(base) as r:self.assertIn('灵听',r.read().decode())
            with urlopen(base+'/api/state') as r:self.assertEqual(len(json.load(r)['devices']),4)
            for path, expected in [('/vendor/leaflet.js',b'Leaflet'),('/vendor/leaflet.css',b'leaflet'),('/map.js',b'LingtingMap'),('/map.css',b'geo-map')]:
                with urlopen(base+path) as r:self.assertIn(expected,r.read())
            request=Request(base+'/api/heartbeat',json.dumps({'id':'pc-local'}).encode(),{'Content-Type':'application/json','Origin':'https://other.example'})
            with self.assertRaises(HTTPError) as context:urlopen(request)
            self.assertEqual(context.exception.code,403)
            record=self.upload()
            with urlopen(base+f"/audio/{record['id']}.wav") as r:self.assertEqual(r.read(),wav_bytes())
            with self.assertRaises(HTTPError):urlopen(base+'/audio/../server.py')
        finally:
            server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main(verbosity=2)
