// Browser audio: play the tutor's streamed PCM, and capture the student's mic as PCM.

const TTS_SAMPLE_RATE = 24000;
const END_OF_SPEECH_PAD_MS = 150;

// Plays 16-bit PCM chunks back to back, in the order they arrive.
export function createPlayer() {
  const ctx = new AudioContext({ sampleRate: TTS_SAMPLE_RATE });
  ctx.resume();
  let playHead = 0;

  return {
    play(arrayBuffer) {
      const pcm = new Int16Array(arrayBuffer);
      const buffer = ctx.createBuffer(1, pcm.length, TTS_SAMPLE_RATE);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      playHead = Math.max(ctx.currentTime, playHead);
      source.start(playHead);
      playHead += buffer.duration;
    },
    // Calls back once everything queued so far has finished playing.
    whenFinished(callback) {
      const remainingMs = Math.max(0, playHead - ctx.currentTime) * 1000;
      setTimeout(callback, remainingMs + END_OF_SPEECH_PAD_MS);
    },
    close() {
      ctx.close();
    },
  };
}

// Starts the mic and hands every PCM chunk to onChunk. Throws if mic access is blocked.
export async function startMic(onChunk) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new AudioContext();
  await ctx.resume();
  await ctx.audioWorklet.addModule("/mic-processor.js");

  const node = new AudioWorkletNode(ctx, "mic-processor");
  node.port.onmessage = (event) => onChunk(event.data);

  // Route through a muted gain so the browser keeps the worklet running without echoing the mic.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  ctx.createMediaStreamSource(stream).connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);

  return {
    stop() {
      stream.getTracks().forEach((track) => track.stop());
      ctx.close();
    },
  };
}
