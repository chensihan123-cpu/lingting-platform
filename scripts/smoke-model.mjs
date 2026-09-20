import { env, pipeline } from '@huggingface/transformers';
import wavefile from 'wavefile';

const { WaveFile } = wavefile;

const MODEL_ID = 'Xenova/ast-finetuned-audioset-10-10-0.4593';
const SAMPLE_URL = 'https://hf-mirror.com/datasets/Xenova/transformers.js-docs/resolve/main/cat_meow.wav';

env.remoteHost = 'https://hf-mirror.com/';

console.log(`Loading ${MODEL_ID}...`);
const classifier = await pipeline('audio-classification', MODEL_ID, { dtype: 'q8' });
const response = await fetch(SAMPLE_URL);
if (!response.ok) throw new Error(`Unable to download sample audio: HTTP ${response.status}`);
const wav = new WaveFile(Buffer.from(await response.arrayBuffer()));
wav.toBitDepth('32f');
wav.toSampleRate(16000);
let audio = wav.getSamples();
if (Array.isArray(audio)) audio = audio[0];
const result = await classifier(audio, { top_k: 4 });
console.log(result);

if (!result.some((item) => /meow|cat/i.test(item.label))) {
  throw new Error('Smoke test failed: expected a cat-related label.');
}
console.log('Model smoke test passed.');
