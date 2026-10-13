import type { PlaybackNote } from "./timeline";

export type AudioVoice = { stop: () => void };

export function midiFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function soundNote({ context, output, note, when, duration, transpose, noise }: {
  context: BaseAudioContext;
  output: AudioNode;
  note: PlaybackNote;
  when: number;
  duration: number;
  transpose: number;
  noise: AudioBuffer;
}): AudioVoice {
  const envelope = context.createGain();
  envelope.connect(output);
  const sources: (OscillatorNode | AudioBufferSourceNode)[] = [];
  const filters: BiquadFilterNode[] = [];
  let release = 0.06;
  if (note.kind === "pitch") {
    const frequency = midiFrequency(note.midi + transpose);
    const fundamental = context.createOscillator();
    fundamental.type = "triangle";
    fundamental.frequency.setValueAtTime(frequency, when);
    fundamental.connect(envelope);
    sources.push(fundamental);
    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(0.18, when + Math.min(0.008, duration / 3));
    envelope.gain.exponentialRampToValueAtTime(0.07, when + Math.max(0.01, duration * 0.8));
    envelope.gain.linearRampToValueAtTime(0, when + duration + release);
  } else {
    const kick = note.midi === 35 || note.midi === 36;
    const tom = note.midi >= 41 && note.midi <= 50 && ![42, 44, 46, 49].includes(note.midi);
    if (kick || tom) {
      const oscillator = context.createOscillator();
      oscillator.frequency.setValueAtTime(kick ? 150 : 100 + (note.midi - 41) * 18, when);
      oscillator.frequency.exponentialRampToValueAtTime(kick ? 45 : 70, when + 0.12);
      oscillator.connect(envelope);
      sources.push(oscillator);
      duration = Math.min(duration, kick ? 0.22 : 0.16);
    } else {
      const source = context.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      const filter = context.createBiquadFilter();
      const snare = [38, 39, 40].includes(note.midi);
      filter.type = snare ? "bandpass" : "highpass";
      filter.frequency.value = snare ? 1800 : 6500;
      filter.Q.value = 0.7;
      source.connect(filter);
      filter.connect(envelope);
      sources.push(source);
      filters.push(filter);
      duration = Math.min(duration, snare ? 0.14 : [46, 49, 51, 52, 55, 57, 59].includes(note.midi) ? 0.3 : 0.045);
    }
    release = 0.02;
    envelope.gain.setValueAtTime(0.28, when);
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration + release);
  }
  let remaining = sources.length;
  function disconnect() {
    sources.forEach((source) => source.disconnect());
    filters.forEach((filter) => filter.disconnect());
    envelope.disconnect();
  }
  for (const source of sources) {
    source.onended = () => { if (--remaining === 0) disconnect(); };
    source.start(when);
    source.stop(when + duration + release);
  }
  return {
    stop: () => {
      envelope.gain.cancelScheduledValues(context.currentTime);
      envelope.gain.setValueAtTime(0, context.currentTime);
      sources.forEach((source) => source.stop(context.currentTime));
      disconnect();
    },
  };
}

export function createNoiseBuffer(context: BaseAudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
  return buffer;
}
