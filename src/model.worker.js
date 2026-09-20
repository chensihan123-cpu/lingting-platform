import { env, pipeline } from '@huggingface/transformers';

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = '/models/';

const MODEL_ID = 'Xenova/ast-finetuned-audioset-10-10-0.4593';
let classifierPromise;

function getClassifier() {
  if (!classifierPromise) {
    classifierPromise = pipeline('audio-classification', MODEL_ID, {
      dtype: 'q8',
      progress_callback: (progress) => {
        self.postMessage({ type: 'progress', progress });
      },
    });
  }
  return classifierPromise;
}

self.addEventListener('message', async (event) => {
  const { type, requestId } = event.data;
  try {
    if (type === 'load') {
      await getClassifier();
      self.postMessage({ type: 'ready', requestId });
      return;
    }

    if (type === 'classify') {
      const classifier = await getClassifier();
      const started = performance.now();
      const audio = new Float32Array(event.data.audio);
      const results = await classifier(audio, { top_k: 10 });
      self.postMessage({
        type: 'result',
        requestId,
        results,
        latencyMs: Math.round(performance.now() - started),
      });
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      message: error?.message || String(error),
    });
  }
});
