// AudioWorklet: turns mic audio into 16 kHz, 16-bit mono PCM chunks for speech-to-text.

const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 800; // 50 ms per chunk

class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / TARGET_RATE; // e.g. 48000 / 16000 = keep every 3rd sample
    this.position = 0;
    this.chunk = new Int16Array(CHUNK_SAMPLES);
    this.filled = 0;
  }

  process(inputs) {
    const samples = inputs[0] && inputs[0][0];
    if (!samples) return true;

    for (; this.position < samples.length; this.position += this.step) {
      const sample = Math.max(-1, Math.min(1, samples[Math.floor(this.position)]));
      this.chunk[this.filled++] = sample * 0x7fff;
      if (this.filled === CHUNK_SAMPLES) {
        this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
        this.chunk = new Int16Array(CHUNK_SAMPLES);
        this.filled = 0;
      }
    }
    this.position -= samples.length;
    return true;
  }
}

registerProcessor("mic-processor", MicProcessor);
