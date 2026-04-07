class VoskAudioProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    const channel = input?.[0];

    if (channel?.length) {
      const samples = new Float32Array(channel);
      this.port.postMessage({ samples, sampleRate }, [samples.buffer]);
    }

    return true;
  }
}

registerProcessor('vosk-audio-processor', VoskAudioProcessor);
