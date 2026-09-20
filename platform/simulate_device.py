"""Send real WAV audio through the same HTTP contract used by a future terminal."""
import argparse
import base64
import json
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

def post(base, endpoint, body):
    request = Request(base + endpoint, json.dumps(body).encode(), {'Content-Type': 'application/json'})
    try:
        with urlopen(request, timeout=30) as response:
            return json.load(response)
    except HTTPError as exc:
        raise RuntimeError(exc.read().decode()) from exc

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Lingting terminal simulator; all data is marked simulated.')
    parser.add_argument('--url', default='http://127.0.0.1:8765')
    parser.add_argument('--device', default='sim-forest')
    parser.add_argument('--file', type=Path, default=Path(__file__).resolve().parent.parent/'public'/'cat_meow.wav')
    parser.add_argument('--count', type=int, default=1)
    parser.add_argument('--interval', type=float, default=15)
    args = parser.parse_args()
    if not args.device.startswith('sim-') or args.count < 1 or args.interval < 1:
        parser.error('Use sim-* device ids, count >= 1 and interval >= 1.')
    with urlopen(args.url + '/api/state', timeout=10) as response:
        registered = next((d for d in json.load(response)['devices'] if d['id'] == args.device), None)
    if not registered or not registered['simulated']:
        parser.error('The selected device must be registered and marked simulated.')
    encoded = base64.b64encode(args.file.read_bytes()).decode()
    for i in range(args.count):
        post(args.url, '/api/heartbeat', {'id':args.device, 'battery':86, 'storage':12})
        result = post(args.url, '/api/upload', {'device_id':args.device, 'audio':encoded,
            'name':args.file.name, 'source':'终端模拟程序（真实音频推理）'})
        print(json.dumps(result, ensure_ascii=False), flush=True)
        if i < args.count-1:
            remaining = args.interval
            while remaining > 0:
                seconds=min(30,remaining)
                time.sleep(seconds)
                remaining-=seconds
                post(args.url, '/api/heartbeat', {'id':args.device, 'battery':86, 'storage':12})
