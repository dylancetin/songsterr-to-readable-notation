import type { ScoreNote, ScoreTrack } from "../shared/model";

export type PlaybackNote = Pick<ScoreNote, "kind" | "midi"> & { start: number; duration: number };
export type PlaybackMeasure = { number: number; start: number; duration: number };
export type PlaybackTimeline = { notes: PlaybackNote[]; measures: PlaybackMeasure[]; duration: number };

function swingPosition(position: number, feel: string | null): number {
  const pair = feel === "8th" ? 1 : feel === "16th" ? 0.5 : null;
  if (pair === null) return position;
  const base = Math.floor(position / pair) * pair;
  const fraction = (position - base) / pair;
  return base + pair * (fraction <= 0.5 ? fraction * 4 / 3 : 2 / 3 + (fraction - 0.5) * 2 / 3);
}

export function buildPlaybackTimeline(track: ScoreTrack): PlaybackTimeline {
  let quarters = 0;
  const sourceMeasures = track.measures.map((measure) => {
    const duration = 4 * measure.timeSignature.beats / measure.timeSignature.unit;
    const result = { measure, start: quarters, duration };
    quarters += duration;
    return result;
  });
  const tempoPoints = [{ quarter: 0, bpm: 120 }, ...track.tempos.flatMap((tempo) => {
    const source = sourceMeasures.find(({ measure }) => measure.index === tempo.measure);
    return source ? [{ quarter: source.start + tempo.position, bpm: tempo.bpm }] : [];
  })].sort((a, b) => a.quarter - b.quarter);
  let previousQuarter = 0;
  let seconds = 0;
  let bpm = 120;
  const segments = tempoPoints.map((point) => {
    seconds += (point.quarter - previousQuarter) * 60 / bpm;
    previousQuarter = point.quarter;
    bpm = point.bpm;
    return { ...point, seconds };
  });
  function secondsAt(quarter: number): number {
    let segment = { quarter: 0, seconds: 0, bpm: 120 };
    for (const candidate of segments) {
      if (candidate.quarter > quarter) break;
      segment = candidate;
    }
    return segment.seconds + (quarter - segment.quarter) * 60 / segment.bpm;
  }

  const notes: PlaybackNote[] = [];
  const previousNotes = new Map<number, Map<string, PlaybackNote>>();
  const measures = sourceMeasures.map(({ measure, start: measureStart, duration }) => {
    const start = secondsAt(measureStart);
    const end = secondsAt(measureStart + duration);
    for (const [voiceIndex, voice] of measure.voices.entries()) {
      let previous = previousNotes.get(voiceIndex) ?? new Map<string, PlaybackNote>();
      const graceOffsets = new Map<number, number>();
      for (const beat of voice.beats) {
        if (beat.kind === "rest") {
          previous.clear();
          continue;
        }
        const position = (value: number) => beat.tuplet === null ? swingPosition(value, measure.tripletFeel) : value;
        const onset = secondsAt(measureStart + position(beat.start));
        const noteEnd = Math.min(end, secondsAt(measureStart + position(beat.start + beat.duration)));
        const graceCount = voice.beats.filter((item) => item.grace && item.start === beat.start).length;
        const main = voice.beats.find((item) => !item.grace && item.start === beat.start);
        const available = main ? secondsAt(measureStart + position(main.start + main.duration)) - onset : 0.12;
        const graceDuration = Math.min(0.06, available / Math.max(2, graceCount * 2));
        const graceOffset = graceOffsets.get(beat.start) ?? 0;
        const noteStart = Math.min(end, onset + (beat.grace ? graceOffset : graceCount * graceDuration));
        const noteDuration = beat.grace ? Math.min(graceDuration, end - noteStart) : noteEnd - noteStart;
        if (beat.grace) graceOffsets.set(beat.start, graceOffset + graceDuration);
        if (noteDuration <= 0) continue;
        const current = new Map<string, PlaybackNote>();
        for (const note of beat.notes) {
          const key = `${note.kind}:${note.midi}`;
          const tied = previous.get(key);
          if (!beat.grace && note.tie && tied && Math.abs(tied.start + tied.duration - noteStart) < 0.00001) {
            tied.duration += noteDuration;
            current.set(key, tied);
          } else {
            const event = { kind: note.kind, midi: note.midi, start: noteStart, duration: noteDuration };
            notes.push(event);
            current.set(key, event);
          }
        }
        if (!beat.grace) previous = current;
      }
      previousNotes.set(voiceIndex, previous);
    }
    return { number: measure.number, start, duration: end - start };
  });
  notes.sort((a, b) => a.start - b.start);
  return { notes, measures, duration: secondsAt(quarters) };
}

export function playbackMeasureAt(timeline: PlaybackTimeline, position: number): PlaybackMeasure | undefined {
  return timeline.measures.find((measure) => position >= measure.start && position < measure.start + measure.duration)
    ?? timeline.measures.at(-1);
}

export function formatPlaybackTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
