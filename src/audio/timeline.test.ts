import { describe, expect, test } from "bun:test";
import type { Beat, Measure, ScoreTrack } from "../shared/model";
import { buildPlaybackTimeline, formatPlaybackTime, playbackMeasureAt } from "./timeline";

function note(id: string, start: number, duration: number, overrides: Partial<Extract<Beat, { kind: "notes" }>> = {}): Beat {
  return {
    kind: "notes", id, start, duration, denominator: 4, dots: 0, tuplet: null,
    tupletStart: false, tupletStop: false, grace: false, beamStart: false, beamStop: false,
    notes: [{ kind: "pitch", midi: 60, tie: false }], lyric: null, ...overrides,
  };
}

function measure(number: number, voices: Beat[][], overrides: Partial<Measure> = {}): Measure {
  return {
    index: number - 1, number, timeSignature: { beats: 4, unit: 4 }, marker: null,
    repeatStart: false, repeatCount: 0, alternateEndings: [], tripletFeel: null,
    voices: voices.map((beats) => ({ beats })), ...overrides,
  };
}

function track(measures: Measure[], tempos: ScoreTrack["tempos"] = [{ measure: 0, position: 0, bpm: 120 }]): ScoreTrack {
  return {
    id: 0, name: "Piano", instrument: "Piano", isVocal: false, isPercussion: false,
    tuning: [], measures, tempos, noteCount: 0, range: null,
  };
}

describe("playback timing", () => {
  test("keeps silent bars, chords, and simultaneous voices at the correct times", () => {
    const timeline = buildPlaybackTimeline(track([
      measure(1, [[]]),
      measure(2, [[note("chord", 1, 1, { notes: [
        { kind: "pitch", midi: 60, tie: false }, { kind: "pitch", midi: 64, tie: false },
      ] })], [note("bass", 1, 2, { notes: [{ kind: "pitch", midi: 36, tie: false }] })]]),
    ]));
    expect(timeline.duration).toBe(4);
    expect(timeline.measures).toEqual([{ number: 1, start: 0, duration: 2 }, { number: 2, start: 2, duration: 2 }]);
    expect(timeline.notes.map(({ midi, start, duration }) => ({ midi, start, duration }))).toEqual([
      { midi: 60, start: 2.5, duration: 0.5 }, { midi: 64, start: 2.5, duration: 0.5 },
      { midi: 36, start: 2.5, duration: 1 },
    ]);
    expect(playbackMeasureAt(timeline, 1.999)?.number).toBe(1);
    expect(playbackMeasureAt(timeline, 2)?.number).toBe(2);
  });

  test("integrates tempo changes inside notes and changing meters", () => {
    const timeline = buildPlaybackTimeline(track([
      measure(1, [[note("held", 1, 3)]]),
      measure(2, [[note("compound", 0, 3)]], { timeSignature: { beats: 6, unit: 8 } }),
    ], [{ measure: 0, position: 0, bpm: 120 }, { measure: 0, position: 2, bpm: 60 }, { measure: 1, position: 1, bpm: 180 }]));
    expect(timeline.notes[0]).toMatchObject({ start: 0.5, duration: 2.5 });
    expect(timeline.measures[1]?.start).toBe(3);
    expect(timeline.measures[1]?.duration).toBeCloseTo(1 + 2 / 3);
    expect(timeline.duration).toBeCloseTo(4 + 2 / 3);
  });

  test("joins tie chains across bars without retriggering and preserves other chord notes", () => {
    const timeline = buildPlaybackTimeline(track([
      measure(1, [[note("begin", 3, 1)]]),
      measure(2, [[note("continue", 0, 2, { notes: [
        { kind: "pitch", midi: 60, tie: true }, { kind: "pitch", midi: 67, tie: false },
      ] }), note("last", 2, 1, { notes: [{ kind: "pitch", midi: 60, tie: true }] })]]),
    ]));
    expect(timeline.notes).toEqual([
      { kind: "pitch", midi: 60, start: 1.5, duration: 2 },
      { kind: "pitch", midi: 67, start: 2, duration: 1 },
    ]);
  });

  test("starts a new note for orphaned ties, rests, and different voices", () => {
    const first = note("first", 0, 1);
    const rest: Beat = { ...first, kind: "rest", id: "rest", start: 1 };
    const tied = note("after-rest", 2, 1, { notes: [{ kind: "pitch", midi: 60, tie: true }] });
    const timeline = buildPlaybackTimeline(track([measure(1, [[first, rest, tied], [note("other-voice", 1, 1, { notes: [{ kind: "pitch", midi: 60, tie: true }] })]])]));
    expect(timeline.notes).toHaveLength(3);
    expect(timeline.notes.map((event) => event.start)).toEqual([0, 0.5, 1]);
  });

  test("uses decoded dotted and tuplet durations instead of the written denominator", () => {
    const timeline = buildPlaybackTimeline(track([measure(1, [[
      note("dotted", 0, 1.5, { dots: 1 }),
      note("tuplet", 1.5, 1 / 3, { tuplet: 3, denominator: 8 }),
    ]])]));
    expect(timeline.notes[0]?.duration).toBe(0.75);
    expect(timeline.notes[1]?.duration).toBeCloseTo(1 / 6);
  });

  test("swings ordinary eighths while leaving explicit tuplets unchanged", () => {
    const timeline = buildPlaybackTimeline(track([measure(1, [[
      note("on", 0, 0.5), note("off", 0.5, 0.5),
      note("triplet", 1 + 1 / 3, 1 / 3, { tuplet: 3 }),
    ]], { tripletFeel: "8th" })]));
    expect(timeline.notes[0]?.duration).toBeCloseTo(1 / 3);
    expect(timeline.notes[1]?.start).toBeCloseTo(1 / 3);
    expect(timeline.notes[1]?.duration).toBeCloseTo(1 / 6);
    expect(timeline.notes[2]?.start).toBeCloseTo(2 / 3);
  });

  test("plays grace notes in sequence before the main attack without extending the bar", () => {
    const timeline = buildPlaybackTimeline(track([measure(1, [[
      note("g1", 0, 0.125, { grace: true, notes: [{ kind: "pitch", midi: 58, tie: false }] }),
      note("g2", 0, 0.125, { grace: true, notes: [{ kind: "pitch", midi: 59, tie: false }] }),
      note("main", 0, 1),
    ]])]));
    expect(timeline.notes.map((event) => event.start)).toEqual([0, 0.06, 0.12]);
    expect(timeline.notes[2]?.duration).toBeCloseTo(0.38);
    expect(timeline.duration).toBe(2);
  });

  test("retains percussion MIDI identities and gives tempo-less tracks a 120 bpm clock", () => {
    const timeline = buildPlaybackTimeline(track([measure(1, [[note("snare", 0, 1, {
      notes: [{ kind: "percussion", midi: 38, label: "Snare", tie: false }],
    })]])], []));
    expect(timeline.notes).toEqual([{ kind: "percussion", midi: 38, start: 0, duration: 0.5 }]);
    expect(timeline.duration).toBe(2);
    expect(formatPlaybackTime(125.9)).toBe("2:05");
  });
});
