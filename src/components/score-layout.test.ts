import { describe, expect, test } from "bun:test";
import type { Beat, Measure } from "../shared/model";
import {
  beamGroups, describeBeat, layoutMeasure, layoutSystems, layoutTieSegments, noteLabelY, rhythmFor, tieLinks, tupletGroups, xAtTime,
} from "./score-layout";

function note(id: string, start: number, denominator = 4, overrides: Partial<Extract<Beat, { kind: "notes" }>> = {}): Beat {
  return {
    kind: "notes", id, start: start * 4, duration: 4 / denominator, denominator,
    dots: 0, tuplet: null, tupletStart: false, tupletStop: false, grace: false, beamStart: false, beamStop: false,
    notes: [{ kind: "pitch", midi: 60, tie: false }], lyric: null, ...overrides,
    ...(overrides.duration !== undefined ? { duration: overrides.duration * 4 } : {}),
  };
}

function rest(id: string, start: number, duration: number, denominator = 4): Beat {
  return {
    kind: "rest", id, start: start * 4, duration: duration * 4, denominator, dots: 0,
    tuplet: null, tupletStart: false, tupletStop: false, grace: false, beamStart: false, beamStop: false,
  };
}

function measure(number: number, voices: Beat[][], overrides: Partial<Measure> = {}): Measure {
  return {
    index: number - 1, number, timeSignature: { beats: 4, unit: 4 }, marker: null,
    repeatStart: false, repeatCount: 0, alternateEndings: [], tripletFeel: null,
    voices: voices.map((beats) => ({ beats })), ...overrides,
  };
}

function layout(source: Measure, previous?: Measure) {
  return layoutMeasure({ measure: source, previous, transpose: 0, accidentalStyle: "sharps" });
}

describe("score spacing", () => {
  test("reserves space for lyric words without moving their note anchors or tie endpoints", () => {
    const source = measure(1, [[
      note("a", 0, 16, { lyric: { kind: "syllable", text: "remember", hyphen: true } }),
      note("b", 1 / 16, 16, { lyric: { kind: "syllable", text: "everything", hyphen: false } }),
    ]]);
    const result = layout(source);
    const first = result.voices[0]?.beats[0];
    const next = result.voices[0]?.beats[1];
    if (!first || !next) throw new Error("Missing lyric fixture beats");
    expect(next.x - first.x).toBeGreaterThan(80);
    expect(first.labelWidth).toBe(24);
    const hidden = layoutMeasure({ measure: source, transpose: 0, accidentalStyle: "sharps", showLyrics: false });
    expect(result.width).toBeGreaterThan(hidden.width);
    expect(xAtTime(result, 0)).toBe(first.x);
    const wrapped = layoutSystems({ measures: [result, result], availableWidth: 300, maxMeasures: 2 });
    expect(wrapped).toHaveLength(2);
  });

  test("aligns simultaneous voices and reserves space for wide accidentals and octave labels", () => {
    const source = measure(1, [
      [note("a", 0, 16), note("b", 1 / 16, 16), note("c", 2 / 16, 16)],
      [note("d", 0, 8, { notes: [{ kind: "pitch", midi: -11, tie: false }] }), note("e", 2 / 16, 8)],
    ]);
    const result = layout(source);
    expect(result.voices[0]?.beats[0]?.x).toBe(result.voices[1]?.beats[0]?.x);
    expect(result.voices[0]?.beats[2]?.x).toBe(result.voices[1]?.beats[1]?.x);
    const first = result.voices[1]?.beats[0];
    const next = result.voices[0]?.beats[1];
    expect(first).toBeDefined();
    expect(next).toBeDefined();
    if (first && next) expect(next.x - first.x).toBeGreaterThan((first.labelWidth + next.labelWidth) / 2);
    expect(xAtTime(result, 1 / 4)).toBe(next?.x ?? -1);
  });

  test("keeps grace notes before the aligned main attack", () => {
    const result = layout(measure(1, [
      [note("grace1", 0, 16, { grace: true }), note("grace2", 0, 16, { grace: true }), note("main", 0)],
      [note("other", 0)],
    ]));
    const beats = result.voices[0]?.beats ?? [];
    expect(beats[0]?.x ?? Infinity).toBeLessThan(beats[1]?.x ?? -Infinity);
    expect(beats[1]?.x ?? Infinity).toBeLessThan(beats[2]?.x ?? -Infinity);
    expect(beats[2]?.x).toBe(result.voices[1]?.beats[0]?.x);
  });

  test("dense bars expand and wrapping preserves every source measure and natural width", () => {
    const sparse = layout(measure(11, [[rest("r", 0, 1, 1)]]));
    const dense = layout(measure(12, [Array.from({ length: 32 }, (_, index) => note(`n${index}`, index / 32, 32))]));
    const last = layout(measure(13, [[rest("last", 0, 1, 1)]]));
    expect(dense.width).toBeGreaterThan(sparse.width * 3);
    const systems = layoutSystems({ measures: [sparse, dense, last], availableWidth: 600, maxMeasures: 2 });
    expect(systems.flatMap((system) => system.measures.map((item) => item.measure.number))).toEqual([11, 12, 13]);
    expect(systems).toHaveLength(3);
    expect(systems[1]?.width).toBeGreaterThanOrEqual(dense.width);
    const narrow = layoutSystems({ measures: [sparse, dense], availableWidth: 180, maxMeasures: 1 });
    expect(narrow.every((system) => system.measures.length === 1 && system.width >= 218)).toBe(true);
  });

  test("retains silent intro measures as full-bar rests and detects meter changes", () => {
    const intro = measure(1, [[rest("intro", 0, 1, 1)]]);
    expect(layout(intro).voices[0]?.fullRest).toBe(true);
    expect(layout(measure(2, [[]]), intro).voices[0]?.fullRest).toBe(true);
    expect(layout(measure(3, [[rest("short", 0, 1 / 4)]]), intro).voices[0]?.fullRest).toBe(false);
    expect(layout(measure(4, [[]]), intro).showMeter).toBe(false);
    expect(layout(measure(5, [[]], { timeSignature: { beats: 6, unit: 8 } }), intro).showMeter).toBe(true);
  });
});

describe("rhythmic groups", () => {
  test("groups compound eighths in threes and breaks beams at rests", () => {
    const source = measure(1, [[
      note("a", 0, 8), note("b", 1 / 8, 8), note("c", 2 / 8, 8),
      note("d", 3 / 8, 8), rest("r", 4 / 8, 1 / 8, 8), note("e", 5 / 8, 8),
    ]], { timeSignature: { beats: 6, unit: 8 } });
    const placed = layout(source).voices[0]?.beats ?? [];
    expect(beamGroups(placed, source).map((group) => group.map((item) => item.beat.id))).toEqual([["a", "b", "c"]]);
  });

  test("honors explicit beam boundaries across metrical beats and separates new groups", () => {
    const source = measure(1, [[
      note("a", 1 / 8, 8, { beamStart: true }), note("b", 2 / 8, 8, { beamStop: true }),
      note("c", 3 / 8, 8, { beamStart: true }), note("d", 4 / 8, 8, { beamStop: true }),
    ]]);
    expect(beamGroups(layout(source).voices[0]?.beats ?? [], source).map((group) => group.map((item) => item.beat.id)))
      .toEqual([["a", "b"], ["c", "d"]]);
  });

  test("does not beam across a timing gap or grace note", () => {
    const source = measure(1, [[note("a", 0, 16), note("b", 2 / 16, 16),
      note("g", 3 / 16, 16, { grace: true }), note("c", 3 / 16, 16)]]);
    expect(beamGroups(layout(source).voices[0]?.beats ?? [], source)).toEqual([]);
  });

  test("splits a run of six triplets into two brackets, including rests", () => {
    const beats = Array.from({ length: 6 }, (_, index) => note(`t${index}`, index / 12, 8, { duration: 1 / 12, tuplet: 3 }));
    const placed = layout(measure(1, [beats])).voices[0]?.beats ?? [];
    expect(tupletGroups(placed).map((group) => group.beats.length)).toEqual([3, 3]);
    const withRest = placed.map((placed, index) => index === 1 ? {
      ...placed, beat: { ...rest("tr", 1 / 12, 1 / 12, 8), tuplet: 3 },
    } : placed);
    expect(tupletGroups(withRest).map((group) => group.beats.length)).toEqual([3, 3]);
  });

  test("lead vocal bar 15 brackets the half rest plus quarter separately from the next three quarters", () => {
    const source = measure(15, [[
      { ...rest("0:14:0:0", 0, 1 / 3, 2), tuplet: 3, tupletStart: true },
      note("0:14:0:1", 1 / 3, 4, { duration: 1 / 6, tuplet: 3, tupletStop: true, notes: [{ kind: "pitch", midi: 64, tie: false }] }),
      note("0:14:0:2", 1 / 2, 4, { duration: 1 / 6, tuplet: 3, tupletStart: true, notes: [{ kind: "pitch", midi: 64, tie: false }] }),
      note("0:14:0:3", 2 / 3, 4, { duration: 1 / 6, tuplet: 3, notes: [{ kind: "pitch", midi: 63, tie: false }] }),
      note("0:14:0:4", 5 / 6, 4, { duration: 1 / 6, tuplet: 3, tupletStop: true, notes: [{ kind: "pitch", midi: 64, tie: false }] }),
    ]]);
    const placed = layout(source).voices[0]?.beats ?? [];
    const expected = [["0:14:0:0", "0:14:0:1"], ["0:14:0:2", "0:14:0:3", "0:14:0:4"]];
    expect(tupletGroups(placed).map((group) => group.beats.map((item) => item.beat.id))).toEqual(expected);
    const unmarked = placed.map((placed) => ({ ...placed, beat: { ...placed.beat, tupletStart: false, tupletStop: false } }));
    expect(tupletGroups(unmarked).map((group) => group.beats.map((item) => item.beat.id))).toEqual(expected);
  });

  test("explicit tuplet boundaries override inferred spans and support mixed subdivisions", () => {
    const beats = [
      note("a", 0, 8, { duration: 1 / 12, tuplet: 3, tupletStart: true }),
      note("b", 1 / 12, 8, { duration: 1 / 12, tuplet: 3 }),
      note("c", 1 / 6, 16, { duration: 1 / 24, tuplet: 3 }),
      note("d", 5 / 24, 16, { duration: 1 / 24, tuplet: 3, tupletStop: true }),
      note("e", 1 / 4, 8, { duration: 1 / 12, tuplet: 3, tupletStart: true }),
      note("f", 1 / 3, 8, { duration: 1 / 12, tuplet: 3, tupletStop: true }),
    ];
    const placed = layout(measure(1, [beats])).voices[0]?.beats ?? [];
    expect(tupletGroups(placed).map((group) => group.beats.map((item) => item.beat.id)))
      .toEqual([["a", "b", "c", "d"], ["e", "f"]]);
    const unmarked = placed.slice(0, 4).map((placed) => ({ ...placed, beat: { ...placed.beat, tupletStart: false, tupletStop: false } }));
    expect(tupletGroups(unmarked).map((group) => group.beats.length)).toEqual([4]);
  });

  test("counts dotted written durations and separates timing gaps", () => {
    const beats = [note("a", 0, 8, { duration: 1 / 8, dots: 1, tuplet: 3 }),
      note("b", 1 / 8, 8, { duration: 1 / 8, dots: 1, tuplet: 3 }),
      note("c", 1 / 2, 8, { duration: 1 / 12, tuplet: 3 })];
    expect(tupletGroups(layout(measure(1, [beats])).voices[0]?.beats ?? []).map((group) => group.beats.map((item) => item.beat.id)))
      .toEqual([["a", "b"], ["c"]]);
  });

  test("distinguishes whole and half from quarter, eighth, and sixteenth rhythms", () => {
    expect([1, 2, 4, 8, 16].map(rhythmFor)).toEqual([
      { kind: "whole" }, { kind: "half" }, { kind: "stem", flags: 0 },
      { kind: "stem", flags: 1 }, { kind: "stem", flags: 2 },
    ]);
  });
});

describe("ties and readable pitches", () => {
  test("ties flagged destinations across measures but preserves repeated attacks", () => {
    const source = measure(1, [[note("origin", 3 / 4)]]);
    const destination = measure(2, [[
      note("tied", 0, 4, { notes: [{ kind: "pitch", midi: 60, tie: true }] }),
      note("attack", 1 / 4), note("tiedAgain", 2 / 4, 4, { notes: [{ kind: "pitch", midi: 60, tie: true }] }),
    ]]);
    expect(tieLinks({ measures: [source, destination] }).map((link) => [link.from.beatId, link.to.beatId]))
      .toEqual([["origin", "tied"], ["attack", "tiedAgain"]]);
  });

  test("matches individual chord pitches and never ties across rests or missing voices", () => {
    const a = note("a", 0, 4, { notes: [{ kind: "pitch", midi: 60, tie: false }, { kind: "pitch", midi: 67, tie: false }] });
    const b = note("b", 1 / 4, 4, { notes: [{ kind: "pitch", midi: 60, tie: true }, { kind: "pitch", midi: 64, tie: true }] });
    const c = note("c", 3 / 4, 4, { notes: [{ kind: "pitch", midi: 60, tie: true }] });
    const links = tieLinks({ measures: [measure(1, [[a, b, rest("r", 2 / 4, 1 / 4), c]])] });
    expect(links).toHaveLength(1);
    expect(links[0]?.from.noteIndex).toBe(1);
    expect(links[0]?.to.noteIndex).toBe(1);
    expect(tieLinks({ measures: [measure(1, [[note("end", 3 / 4)]]), measure(2, [[]]), measure(3, [[b]])] })).toEqual([]);
  });

  test("Accordion 2 bars 1 to 2 ties only E4 alongside its own chord row", () => {
    const origin = measure(1, [[note("10:0:0:0", 0, 1, { notes: [64, 61, 57].map((midi) => ({ kind: "pitch", midi, tie: false })) })]]);
    const destination = measure(2, [[note("10:1:0:0", 0, 1, { notes: [64, 59, 56].map((midi) => ({ kind: "pitch", midi, tie: midi === 64 })) })]]);
    const first = layout(origin);
    const second = layout(destination, origin);
    const links = tieLinks({ measures: [origin, destination] });
    expect(links).toHaveLength(1);
    const segments = layoutTieSegments({ links, measures: [{ layout: first, x: 0 }, { layout: second, x: first.width }], lanes: [{ labelY: 156 }], width: first.width + second.width });
    expect(segments).toHaveLength(1);
    expect(segments[0]?.kind).toBe("complete");
    expect(segments[0]?.start.y).toBe(107);
    expect(segments[0]?.end.y).toBe(107);
    const a = first.voices[0]?.beats[0];
    const b = second.voices[0]?.beats[0];
    if (!a || !b) throw new Error("Missing regression fixture beats");
    expect(segments[0]?.start.x ?? 0).toBeGreaterThan(a.x + a.labelWidth / 2);
    expect(segments[0]?.end.x ?? Infinity).toBeLessThan(first.width + b.x - b.labelWidth / 2);
    expect(segments[0]?.start.y ?? Infinity).toBeLessThan(noteLabelY({ placed: a, noteIndex: 1, laneLabelY: 156 }));
  });

  test("tie endpoints use both chord indices and sizes and split at each system's local note height", () => {
    const origin = measure(1, [[note("from", 0, 1, { notes: [72, 64, 60].map((midi) => ({ kind: "pitch", midi, tie: false })) })]]);
    const destination = measure(2, [[note("to", 0, 1, { notes: [64, 59].map((midi) => ({ kind: "pitch", midi, tie: midi === 64 })) })]]);
    const first = layout(origin);
    const second = layout(destination, origin);
    const links = tieLinks({ measures: [origin, destination] });
    expect(links[0]?.from.noteIndex).toBe(1);
    expect(links[0]?.to.noteIndex).toBe(0);
    const complete = layoutTieSegments({ links, measures: [{ layout: first, x: 0 }, { layout: second, x: first.width }], lanes: [{ labelY: 180 }], width: first.width + second.width });
    expect(complete[0]?.start.y).toBe(159);
    expect(complete[0]?.end.y).toBe(159);
    const outgoing = layoutTieSegments({ links, measures: [{ layout: first, x: 0 }], lanes: [{ labelY: 156 }], width: first.width });
    const incoming = layoutTieSegments({ links, measures: [{ layout: second, x: 0 }], lanes: [{ labelY: 128 }], width: second.width });
    expect(outgoing[0]?.kind).toBe("outgoing");
    expect(outgoing[0]?.start.y).toBe(135);
    expect(outgoing[0]?.end).toEqual({ x: first.width - 4, y: 135 });
    expect(incoming[0]?.kind).toBe("incoming");
    expect(incoming[0]?.start).toEqual({ x: 4, y: 107 });
    expect(incoming[0]?.end.y).toBe(107);
  });

  test("a held pitch moves to its new label height when a higher note enters the chord", () => {
    const origin = measure(1, [[note("from", 0, 1, { notes: [64, 60].map((midi) => ({ kind: "pitch", midi, tie: false })) })]]);
    const destination = measure(2, [[note("to", 0, 1, { notes: [72, 64].map((midi) => ({ kind: "pitch", midi, tie: midi === 64 })) })]]);
    const first = layout(origin);
    const second = layout(destination, origin);
    const segments = layoutTieSegments({ links: tieLinks({ measures: [origin, destination] }), measures: [{ layout: first, x: 0 }, { layout: second, x: first.width }], lanes: [{ labelY: 128 }], width: first.width + second.width });
    expect(segments[0]?.start.y).toBe(107);
    expect(segments[0]?.end.y).toBe(135);
  });

  test("describes transposed octave, accidental preference, dots, tuplets and meter beat unit", () => {
    const beat = note("a", 1 / 8, 8, { dots: 1, tuplet: 3 });
    expect(describeBeat(beat, 1, "flats", 8)).toBe("D♭4, eighth, 1 dot, tuplet of 3, at beat 2.");
    expect(describeBeat(beat, -12, "sharps")).toContain("C3");
  });

  test("includes lyric syllables and holds in accessible note descriptions", () => {
    const beat = note("a", 0, 4, { lyric: { kind: "syllable", text: "sing", hyphen: true } });
    expect(describeBeat(beat, 0, "sharps")).toContain("Lyric: sing, word continues.");
    expect(describeBeat(beat, 0, "sharps", 4, false)).not.toContain("Lyric:");
    expect(describeBeat(note("b", 1 / 4, 4, { lyric: { kind: "hold" } }), 0, "sharps"))
      .toContain("Continue the previous lyric syllable.");
  });
});
