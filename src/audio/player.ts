import { createNoiseBuffer, soundNote } from "./synth";
import type { AudioVoice } from "./synth";
import type { PlaybackTimeline } from "./timeline";

export type PlaybackState = {
  kind: "stopped" | "starting" | "playing" | "paused";
  position: number;
} | { kind: "error"; position: number; message: string };

type AudioSession = { context: AudioContext; output: GainNode; noise: AudioBuffer };

export class ScorePlayer {
  private audio: AudioSession | null = null;
  private state: PlaybackState = { kind: "stopped", position: 0 };
  private voices: { voice: AudioVoice; end: number }[] = [];
  private timer: number | null = null;
  private clockStart = 0;
  private nextNote = 0;
  private generation = 0;
  private transpose = 0;
  private volume = 0.8;

  constructor(private timeline: PlaybackTimeline, private onChange: (state: PlaybackState) => void) {}

  private publish(state: PlaybackState) {
    this.state = state;
    this.onChange(state);
  }

  private position(): number {
    return this.state.kind === "playing" && this.audio
      ? Math.min(this.timeline.duration, Math.max(0, this.audio.context.currentTime - this.clockStart))
      : this.state.position;
  }

  async play(): Promise<void> {
    if (this.state.kind === "playing" || this.state.kind === "starting" || this.timeline.notes.length === 0) return;
    const generation = ++this.generation;
    const position = this.state.position >= this.timeline.duration ? 0 : this.state.position;
    this.publish({ kind: "starting", position });
    try {
      if (!this.audio) {
        const context = new AudioContext();
        const output = context.createGain();
        const compressor = context.createDynamicsCompressor();
        output.gain.value = this.volume;
        output.connect(compressor);
        compressor.connect(context.destination);
        this.audio = { context, output, noise: createNoiseBuffer(context) };
      }
      await this.audio.context.resume();
      if (generation !== this.generation) return;
      if (this.audio.context.state !== "running") throw new Error("Audio did not start.");
      this.begin(position);
    } catch (error: unknown) {
      if (generation !== this.generation) return;
      this.clearSound();
      this.publish({ kind: "error", position, message: "Could not start audio. Press Play to try again in a browser that supports sound." });
    }
  }

  private begin(position: number) {
    const audio = this.audio;
    if (!audio) return;
    this.clockStart = audio.context.currentTime + 0.035 - position;
    this.nextNote = 0;
    this.publish({ kind: "playing", position });
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  private tick() {
    const audio = this.audio;
    if (!audio || this.state.kind !== "playing") return;
    const position = this.position();
    if (position >= this.timeline.duration) {
      this.clearSound();
      this.publish({ kind: "stopped", position: 0 });
      return;
    }
    if (audio.context.state !== "running") {
      this.pause();
      return;
    }
    const horizon = position + 0.2;
    while (this.nextNote < this.timeline.notes.length) {
      const note = this.timeline.notes[this.nextNote];
      if (!note || note.start > horizon) break;
      this.nextNote++;
      const end = note.start + note.duration;
      if (end <= position) continue;
      const onset = Math.max(position, note.start);
      const when = Math.max(audio.context.currentTime, this.clockStart + onset);
      const voice = soundNote({ ...audio, note, when, duration: end - onset, transpose: this.transpose });
      this.voices.push({ voice, end: when + end - onset + 0.1 });
    }
    this.voices = this.voices.filter(({ end }) => end > audio.context.currentTime);
    if (position - this.state.position >= 0.08) this.publish({ kind: "playing", position });
  }

  private clearSound() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.voices.forEach(({ voice }) => voice.stop());
    this.voices = [];
  }

  pause() {
    const position = this.position();
    this.generation++;
    this.clearSound();
    this.publish({ kind: "paused", position });
  }

  stop() {
    this.generation++;
    this.clearSound();
    this.publish({ kind: "stopped", position: 0 });
  }

  seek(position: number) {
    const playing = this.state.kind === "playing";
    this.generation++;
    this.clearSound();
    position = Math.min(this.timeline.duration, Math.max(0, position));
    if (playing && position < this.timeline.duration) this.begin(position);
    else this.publish({ kind: "paused", position });
  }

  setTranspose(transpose: number) {
    if (this.transpose === transpose) return;
    const position = this.position();
    this.transpose = transpose;
    if (this.state.kind === "playing") this.seek(position);
  }

  setVolume(volume: number) {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.audio) this.audio.output.gain.setTargetAtTime(this.volume, this.audio.context.currentTime, 0.015);
  }

  dispose() {
    this.generation++;
    this.clearSound();
    if (this.audio) void this.audio.context.close().catch(() => {});
  }
}
