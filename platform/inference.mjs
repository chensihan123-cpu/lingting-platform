import { env, pipeline } from '@huggingface/transformers';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import wavefile from 'wavefile';

// stdout is reserved for the JSON protocol; model diagnostics go to stderr.
console.log = (...args) => console.error(...args);
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = fileURLToPath(new URL('../public/models/', import.meta.url));
let classifier;
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const { path } = JSON.parse(line);
    classifier ??= await pipeline('audio-classification', 'Xenova/ast-finetuned-audioset-10-10-0.4593', { dtype: 'q8' });
    const wav = new wavefile.WaveFile(await readFile(path));
    wav.toBitDepth('32f');
    let samples = wav.getSamples();
    if (Array.isArray(samples)) {
      const channels = samples;
      samples = Float32Array.from(channels[0], (_, i) => channels.reduce((sum, c) => sum + c[i], 0) / channels.length);
    }
    const segments = [];
    for (let start = 0; start < samples.length; start += 160000) {
      const chunk = new Float32Array(160000);
      const slice = samples.subarray(start, start + 160000);
      chunk.set(slice);
      // AudioSet is multi-label: classes can coexist. The generic JS pipeline uses
      // softmax, so use the raw logits with independent sigmoid scores instead.
      const output = await classifier.model(await classifier.processor(chunk));
      const results = Array.from(output.logits.data, (logit, index) => ({
        label: classifier.model.config.id2label[index], score: 1 / (1 + Math.exp(-logit)),
      })).sort((a, b) => b.score - a.score);
      segments.push({ start: start / 16000, duration: slice.length / 16000,
        predictions: Array.isArray(results[0]) ? results[0] : results });
    }
    process.stdout.write(JSON.stringify({ segments }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: error.message }) + '\n');
  }
}
