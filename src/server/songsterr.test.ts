import { describe, expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { EXAMPLE_URL, importResultSchema, type ScoreTrack } from "../shared/model";
import { ImportError, importSong, normalizeTrack } from "./songsterr";

const vocalMetadata = {
  partId: 0,
  name: "Carl Wilson | Lead Vocals",
  title: "Carl Wilson | Lead Vocals - Tenor Sax",
  instrumentId: 66,
  tuning: [64, 59, 55, 50, 45, 40],
  isVocalTrack: true,
  isDrums: false,
};

const percussionFixtureSchema = z.object({
  songId: z.number().int().positive(),
  revisionId: z.number().int().positive(),
  cases: z.array(z.object({
    partId: z.number().int().nonnegative(),
    name: z.string(),
    expectedMidi: z.array(z.number().int()),
    revision: z.unknown(),
  })),
});
const rawPercussionFixtures: unknown = await Bun.file(new URL("./fixtures/songsterr-percussion.json", import.meta.url)).json();
const percussionFixtures = percussionFixtureSchema.parse(rawPercussionFixtures);

function quarterBeat(fret = 3, string = 1) {
  return { notes: [{ fret, string }], type: 4, duration: [1, 4] };
}

function normalize(revision: unknown, metadata: Partial<typeof vocalMetadata> = {}) {
  return normalizeTrack({ metadata: { ...vocalMetadata, ...metadata }, revision });
}

function firstVoice(track: ScoreTrack) {
  const voice = track.measures[0]?.voices[0];
  if (!voice) throw new Error("Expected a source voice in the test fixture.");
  return voice;
}

describe("Songsterr normalization", () => {
  test("matches Songsterr's opening vocal lyric positions through rests, ties, and held words", async () => {
    const revision: unknown = await Bun.file(new URL("./fixtures/songsterr-in-my-life-opening.json", import.meta.url)).json();
    const { track, warnings } = normalize(revision);
    const lyrics = track.measures.flatMap((measure) => measure.voices.flatMap((voice) => voice.beats
      .flatMap((beat) => beat.kind === "notes" && beat.lyric ? [[beat.id, beat.lyric.kind === "hold" ? "_"
        : `${beat.lyric.text}${beat.lyric.hyphen ? "-" : ""}`]] : [])));
    expect(lyrics).toEqual([
      ["0:3:0:1", "There"], ["0:3:0:2", "are"],
      ["0:4:0:0", "pla-"], ["0:4:0:1", "ces"], ["0:4:0:2", "I"], ["0:4:0:3", "re-"],
      ["0:5:0:0", "mem-"], ["0:5:0:1", "ber."], ["0:5:0:2", "_"], ["0:5:0:5", "All"], ["0:5:0:6", "my"],
      ["0:6:0:0", "life,"], ["0:6:0:1", "_"], ["0:6:0:2", "_"], ["0:6:0:3", "_"], ["0:6:0:4", "_"], ["0:6:0:5", "_"], ["0:6:0:6", "though"],
      ["0:7:0:0", "some"], ["0:7:0:1", "have"], ["0:7:0:2", "_"], ["0:7:0:3", "changed."], ["0:7:0:4", "_"], ["0:7:0:6", "Some"], ["0:7:0:7", "for-"],
    ]);
    expect(warnings).toEqual([]);
  });

  test("honors the lyric start bar, skips grace notes, and assigns track lyrics only to the first voice", () => {
    const grace = { ...quarterBeat(), graceNote: "beforeBeat" };
    const { track } = normalize({ newLyrics: [{ line: 1, offset: 2, text: "hello world" }], measures: [
      { signature: [2, 4], voices: [{ beats: [quarterBeat(), quarterBeat()] }] },
      { voices: [{ beats: [grace, quarterBeat(), quarterBeat()] }, { beats: [quarterBeat(), quarterBeat()] }] },
    ] });
    expect(firstVoice(track).beats.every((beat) => beat.kind === "notes" && beat.lyric === null)).toBe(true);
    expect(track.measures[1]?.voices[0]?.beats.map((beat) => beat.kind === "notes" ? beat.lyric : null)).toEqual([
      null, { kind: "syllable", text: "hello", hyphen: false }, { kind: "syllable", text: "world", hyphen: false },
    ]);
    expect(track.measures[1]?.voices[1]?.beats.every((beat) => beat.kind === "notes" && beat.lyric === null)).toBe(true);
  });

  test("an omitted source beat still consumes its lyric so later words retain their positions", () => {
    for (const omitted of [quarterBeat(3, 24), { notes: [{ fret: 3, string: 1 }], duration: [1, 0] }]) {
      const { track } = normalize({ newLyrics: [{ line: 1, offset: 1, text: "one two three" }], measures: [{
        signature: [3, 4], voices: [{ beats: [quarterBeat(), omitted, quarterBeat()] }],
      }] });
      expect(firstVoice(track).beats.map((beat) => beat.kind === "notes" ? beat.lyric : null)).toEqual([
        { kind: "syllable", text: "one", hyphen: false }, { kind: "syllable", text: "three", hyphen: false },
      ]);
    }
  });

  test("uses Songsterr's sixth lyric entry when present and preserves legacy beat lyrics", () => {
    const measures = [{ signature: [1, 4], voices: [{ beats: [{ ...quarterBeat(), lyrics: [{ text: "older-" }] }] }] }];
    const { track } = normalize({ measures });
    expect(firstVoice(track).beats[0]).toMatchObject({ lyric: { kind: "syllable", text: "older", hyphen: true } });
    const { track: modern } = normalize({ measures, newLyrics: [
      { line: 1, offset: 1, text: "unused" }, ...Array.from({ length: 4 }, (_, index) => ({ line: index + 2, text: "", offset: 1 })),
      { line: 6, offset: 1, text: "new" },
    ] });
    expect(firstVoice(modern).beats[0]).toMatchObject({ lyric: { kind: "syllable", text: "new", hyphen: false } });
    const { warnings } = normalize({ measures: [{ signature: [1, 4], voices: [{ beats: [{ ...quarterBeat(), lyrics: "invalid" }] }] }],
      newLyrics: [{ line: 1, offset: "invalid", text: "words" }] });
    expect(warnings).toEqual(["Invalid track lyrics skipped.", "Measure 1, voice 1, beat 1: invalid beat lyrics skipped."]);
  });

  test("keeps rational duration in quarters and infers missing dots from the base type", () => {
    const { track, warnings } = normalize({ measures: [{
      signature: [3, 4], voices: [{ beats: [
        { notes: [{ fret: 3, string: 1 }], type: 4, duration: [3, 8] },
        { notes: [{ fret: 5, string: 1, tie: true }], type: 4, duration: [3, 8] },
      ] }],
    }] });
    expect(firstVoice(track).beats.map(({ start, duration, denominator, dots }) => ({ start, duration, denominator, dots })))
      .toEqual([
        { start: 0, duration: 1.5, denominator: 4, dots: 1 },
        { start: 1.5, duration: 1.5, denominator: 4, dots: 1 },
      ]);
    expect(firstVoice(track).beats[1]).toMatchObject({ kind: "notes", notes: [{ kind: "pitch", midi: 64, tie: true }] });
    expect(track.range).toEqual({ low: 62, high: 64 });
    expect(warnings).toEqual([]);
  });

  test("infers double dots and a base type when source notation is missing", () => {
    const { track } = normalize({ measures: [{ signature: [7, 16], voices: [{ beats: [
      { notes: [{ fret: 0, string: 0 }], duration: [7, 16] },
    ] }] }] });
    expect(firstVoice(track).beats[0]).toMatchObject({ duration: 1.75, denominator: 4, dots: 2 });
  });

  test("does not apply explicit tuplets twice to already scaled source fractions", () => {
    const triplet = { notes: [{ fret: 3, string: 1 }], type: 4, tuplet: 3, duration: [1, 6] };
    const { track, warnings } = normalize({ measures: [{ signature: [4, 4], voices: [{ beats: [
      { ...triplet, tupletStart: true }, triplet, { ...triplet, tupletStop: true },
      { rest: true, notes: [{ rest: true }], type: 2, duration: [1, 2] },
    ] }] }] });
    const beats = firstVoice(track).beats;
    expect(beats[0]).toMatchObject({ duration: 2 / 3, denominator: 4, dots: 0, tuplet: 3 });
    expect(beats[1]?.start).toBeCloseTo(2 / 3);
    expect(beats[2]?.start).toBeCloseTo(4 / 3);
    expect(beats[3]?.start).toBeCloseTo(2);
    expect(beats.map(({ tupletStart, tupletStop }) => ({ tupletStart, tupletStop }))).toEqual([
      { tupletStart: true, tupletStop: false },
      { tupletStart: false, tupletStop: false },
      { tupletStart: false, tupletStop: true },
      { tupletStart: false, tupletStop: false },
    ]);
    expect(beats.reduce((sum, beat) => sum + beat.duration, 0)).toBeCloseTo(4);
    expect(warnings).toEqual([]);
  });

  test("preserves tuplet boundaries on rests and defaults absent boundaries to false", () => {
    const tripletRest = { rest: true, notes: [{ rest: true }], type: 8, tuplet: 3, duration: [1, 12] };
    const { track, warnings } = normalize({ measures: [{ signature: [1, 4], voices: [{ beats: [
      { ...tripletRest, tupletStart: true }, tripletRest, { ...tripletRest, tupletStop: true },
    ] }] }] });
    expect(firstVoice(track).beats.map(({ kind, tupletStart, tupletStop }) => ({ kind, tupletStart, tupletStop }))).toEqual([
      { kind: "rest", tupletStart: true, tupletStop: false },
      { kind: "rest", tupletStart: false, tupletStop: false },
      { kind: "rest", tupletStart: false, tupletStop: true },
    ]);
    expect(warnings).toEqual([]);
  });

  test("preserves conflicting source duration and explicit dots with a warning", () => {
    const { track, warnings } = normalize({ measures: [{ signature: [1, 4], voices: [{ beats: [
      { ...quarterBeat(), dots: 2 },
    ] }] }] });
    expect(firstVoice(track).beats[0]).toMatchObject({ duration: 1, denominator: 4, dots: 2 });
    expect(warnings.join(" ")).toContain("disagrees with base type/dots/tuplet");
  });

  test("reconstructs missing duration only from explicit source notation", () => {
    const { track, warnings } = normalize({ measures: [{ signature: [1, 8], voices: [{ beats: [
      { notes: [{ fret: 3, string: 1 }], type: 8, dots: 1, tuplet: 3 },
    ] }] }] });
    expect(firstVoice(track).beats[0]).toMatchObject({ duration: 0.5, denominator: 8, dots: 1, tuplet: 3 });
    expect(warnings.join(" ")).toContain("reconstructed from base type");
  });

  test("skips unrepairable durations rather than inventing beats", () => {
    const { track, warnings } = normalize({ measures: [{ signature: [1, 4], voices: [{ beats: [
      { notes: [{ fret: 2, string: 0 }], duration: [1, 0] }, quarterBeat(),
    ] }] }] });
    expect(firstVoice(track).beats).toHaveLength(1);
    expect(warnings.join(" ")).toContain("beat skipped");
  });

  test("grace notes preserve written duration but never advance a voice", () => {
    const grace = { notes: [{ fret: 5, string: 2 }], duration: [1, 32], type: 32 };
    const { track, warnings } = normalize({ measures: [{ signature: [4, 4], voices: [{ beats: [
      { ...grace, graceNote: "beforeBeat" }, { ...grace, graceNote: "onBeat" },
      quarterBeat(), quarterBeat(), quarterBeat(), quarterBeat(),
    ] }] }] });
    const beats = firstVoice(track).beats;
    expect(beats.map((beat) => beat.start)).toEqual([0, 0, 0, 1, 2, 3]);
    expect(beats[0]).toMatchObject({ grace: true, duration: 0.125 });
    expect(beats.filter((beat) => !beat.grace).reduce((sum, beat) => sum + beat.duration, 0)).toBe(4);
    expect(warnings).toEqual([]);
  });

  test("retains all voices, ties and rests, with independent timing", () => {
    const { track, warnings } = normalize({ measures: [{ signature: [3, 4], voices: [
      { beats: [{ notes: [{ fret: 5, string: 0, tie: true }], type: 2, duration: [3, 4] }] },
      { beats: [quarterBeat(0, 5), { rest: true, notes: [{ rest: true }], type: 4, duration: [1, 4] }, quarterBeat(2, 5)] },
    ] }] });
    expect(track.measures[0]?.voices).toHaveLength(2);
    expect(track.measures[0]?.voices[0]?.beats[0]).toMatchObject({ start: 0, duration: 3, dots: 1 });
    expect(track.measures[0]?.voices[1]?.beats.map((beat) => beat.start)).toEqual([0, 1, 2]);
    expect(track.measures[0]?.voices[1]?.beats[1]?.kind).toBe("rest");
    expect(track.noteCount).toBe(3);
    expect(warnings).toEqual([]);
  });

  test("inherits meter and swing and keeps markers, repeat counts and alternate endings", () => {
    const restVoice = { rest: true, beats: [] };
    const { track, warnings } = normalize({ measures: [
      { signature: [3, 8], voices: [restVoice], tripletFeel: "8th", marker: { text: "Intro", width: 38 }, repeatStart: true },
      { voices: [restVoice], repeat: 3, alternateEnding: [1, 2] },
      { signature: [5, 4], voices: [restVoice], tripletFeel: "none", marker: "Verse", repeatCount: 2, alternateEnding: 5 },
      { voices: [restVoice] },
    ] });
    expect(track.measures.map((measure) => measure.timeSignature)).toEqual([
      { beats: 3, unit: 8 }, { beats: 3, unit: 8 }, { beats: 5, unit: 4 }, { beats: 5, unit: 4 },
    ]);
    expect(track.measures.map((measure) => measure.tripletFeel)).toEqual(["8th", "8th", "none", "none"]);
    expect(track.measures[0]).toMatchObject({ marker: "Intro", repeatStart: true });
    expect(track.measures[1]).toMatchObject({ repeatCount: 3, alternateEndings: [1, 2] });
    expect(track.measures[2]).toMatchObject({ marker: "Verse", repeatCount: 2, alternateEndings: [1, 3] });
    expect(firstVoice(track).beats[0]).toMatchObject({ kind: "rest", duration: 1.5, tupletStart: false, tupletStop: false });
    expect(warnings).toEqual([]);
  });

  test("labels percussion by drum sound and does not create a pitched range", () => {
    const { track } = normalize({ instrumentId: 1024, tuning: [], measures: [{ signature: [1, 4], voices: [{ beats: [
      { notes: [{ fret: 36, string: 0 }, { fret: 38, string: 1 }, { fret: 42, string: 2 }], type: 4, duration: [1, 4] },
    ] }] }] }, { name: "Hal Blaine | Drums", instrumentId: 1024, isDrums: true, isVocalTrack: false });
    expect(track.isPercussion).toBe(true);
    expect(track.range).toBeNull();
    expect(firstVoice(track).beats[0]).toMatchObject({ kind: "notes", notes: [
      { kind: "percussion", midi: 36, label: "Bass drum" },
      { kind: "percussion", midi: 38, label: "Acoustic snare" },
      { kind: "percussion", midi: 42, label: "Closed hi-hat" },
    ] });
  });

  for (const fixture of percussionFixtures.cases) {
    test(`retains captured percussion staff positions for part ${fixture.partId}: ${fixture.name}`, () => {
      const { track, warnings } = normalize(fixture.revision, {
        partId: fixture.partId, name: fixture.name, instrumentId: 1024, isDrums: true, isVocalTrack: false,
      });
      const notes = track.measures.flatMap((measure) => measure.voices.flatMap((voice) =>
        voice.beats.flatMap((beat) => beat.kind === "notes" ? beat.notes : [])));
      expect(notes.map((note) => note.midi)).toEqual(fixture.expectedMidi);
      expect(notes.every((note) => note.kind === "percussion")).toBe(true);
      expect(track.noteCount).toBe(fixture.expectedMidi.length);
      expect(track.range).toBeNull();
      expect(warnings).toEqual([]);
      if (fixture.partId === 22) expect(notes[0]).toMatchObject({ label: "Jingle bell" });
    });
  }

  test("keeps pitched integer string validation despite permissive percussion staff positions", () => {
    const { track, warnings } = normalize({ measures: [{ signature: [3, 4], voices: [{ beats: [
      quarterBeat(3, 1.5), quarterBeat(3, -1), quarterBeat(3, 1),
    ] }] }] });
    expect(firstVoice(track).beats).toHaveLength(1);
    expect(firstVoice(track).beats[0]).toMatchObject({ start: 2, notes: [{ kind: "pitch", midi: 62 }] });
    expect(track.noteCount).toBe(1);
    expect(warnings.filter((warning) => warning.includes("undecodable note skipped"))).toHaveLength(2);
  });

  test("percussion ignores staff string but still validates the MIDI sound and preserves ties", () => {
    const { track, warnings } = normalize({ measures: [{ signature: [1, 4], voices: [{ beats: [{
      notes: [
        { fret: 54, string: -1, tie: true }, { fret: 38, string: 1.5 }, { fret: 42 },
        { fret: 128, string: -1 }, { fret: 38.5, string: 1.5 }, { fret: "38", string: -1 }, { string: -1 },
      ], type: 4, duration: [1, 4],
    }] }] }] }, { instrumentId: 1024, isDrums: true, isVocalTrack: false });
    expect(track.noteCount).toBe(3);
    expect(firstVoice(track).beats[0]).toMatchObject({ kind: "notes", notes: [
      { kind: "percussion", midi: 54, label: "Tambourine", tie: true },
      { kind: "percussion", midi: 38, label: "Acoustic snare", tie: false },
      { kind: "percussion", midi: 42, label: "Closed hi-hat", tie: false },
    ] });
    expect(warnings).toHaveLength(4);
  });

  test("recognizes percussion rests with negative staff strings even without beat rest flags", () => {
    const { track, warnings } = normalize({ measures: [{ signature: [4, 4], voices: [{ beats: [{
      notes: [{ rest: true, string: -1 }], type: 1, duration: [1, 1],
    }] }] }] }, { instrumentId: 1024, isDrums: true, isVocalTrack: false });
    expect(firstVoice(track).beats[0]).toMatchObject({ kind: "rest", duration: 4, tupletStart: false, tupletStop: false });
    expect(warnings).toEqual([]);
  });

  test("uses revision tuning, not a guessed standard tuning", () => {
    const { track } = normalize({ tuning: [72], measures: [{ signature: [1, 4], voices: [{ beats: [quarterBeat(5, 0)] }] }] });
    expect(firstVoice(track).beats[0]).toMatchObject({ notes: [{ midi: 77 }] });
    expect(track.tuning).toEqual([72]);
    expect(track.name).toBe(vocalMetadata.name);
    expect(track.isVocal).toBe(true);
    expect(track.instrument).toBe("Tenor saxophone");
  });

  test("skips undecodable notes while keeping later beat positions and valid chord notes", () => {
    const { track, warnings } = normalize({ measures: [{ signature: [3, 4], voices: [{ beats: [
      { notes: [{ fret: 5 }, { fret: "x", string: 0 }], type: 4, duration: [1, 4] },
      { notes: [{ fret: 3, string: 1 }, { fret: 1, string: 24 }, { fret: 99, string: 0 }, { fret: 0, string: 0, dead: true }], type: 4, duration: [1, 4] },
      quarterBeat(),
    ] }] }] });
    expect(firstVoice(track).beats.map((beat) => beat.start)).toEqual([1, 2]);
    expect(track.noteCount).toBe(2);
    expect(track.range).toEqual({ low: 62, high: 62 });
    expect(warnings.join(" ")).toContain("undecodable note skipped");
    expect(warnings.join(" ")).toContain("missing string or tuning");
    expect(warnings.join(" ")).toContain("outside MIDI range");
    expect(warnings.join(" ")).toContain("unpitched dead note");
  });

  test("keeps source tempo changes in quarters and rejects invalid tempo locations", () => {
    const { track, warnings } = normalize({
      measures: [
        { signature: [4, 4], voices: [{ rest: true }] }, { voices: [{ rest: true }] },
      ],
      automations: { tempo: [
        { measure: 1, position: 3, type: 8, bpm: 130 },
        { measure: 0, position: 0, type: 4, bpm: 114 },
        { measure: 9, position: 0, type: 4, bpm: 90 },
        { measure: 0, position: 5, type: 4, bpm: 90 },
        { measure: 0, position: 0, type: 4, bpm: 0 },
      ] },
    });
    expect(track.tempos).toEqual([
      { measure: 0, position: 0, bpm: 114 }, { measure: 1, position: 1.5, bpm: 130 },
    ]);
    expect(warnings).toHaveLength(3);
  });

  test("reports underfull source voices without adding filler beats", () => {
    const { track, warnings } = normalize({ measures: [{ signature: [4, 4], voices: [{ beats: [quarterBeat()] }] }] });
    expect(firstVoice(track).beats).toHaveLength(1);
    expect(warnings.join(" ")).toContain("source durations total 1 quarters; meter expects 4");
  });

  test("bounds warnings on malformed source data", () => {
    const { warnings } = normalize({ measures: [{ signature: [4, 4], voices: [{ beats:
      Array.from({ length: 250 }, () => ({ notes: [{ fret: 3 }], duration: [1, 4], type: 4 })),
    }] }] });
    expect(warnings).toHaveLength(200);
    expect(warnings[199]).toContain("additional source warnings omitted");
  });

  test("converts a complete captured vocal revision offline", async () => {
    const revision: unknown = await Bun.file(new URL("./fixtures/songsterr-vocal.json", import.meta.url)).json();
    const { track } = normalize(revision, { name: "Caleb Molina - Chorus Vocals", instrumentId: 64 });
    expect(track.measures).toHaveLength(146);
    expect(track.noteCount).toBe(37);
    expect(track.range).toEqual({ low: 57, high: 69 });
    expect(track.tuning).toEqual([61, 56, 52, 47, 42, 35]);
    expect(track.tempos).toEqual([
      { measure: 0, position: 0, bpm: 194 }, { measure: 67, position: 0, bpm: 195 }, { measure: 131, position: 0, bpm: 121 },
    ]);
    for (const measure of track.measures) {
      for (const voice of measure.voices) {
        for (const beat of voice.beats) {
          expect(Number.isFinite(beat.duration)).toBe(true);
          if (beat.kind === "notes") expect(beat.notes.every((note) => note.kind === "pitch" && Number.isInteger(note.midi))).toBe(true);
        }
      }
    }
  });

  test("rejects malformed part structure and mismatched IDs with readable errors", () => {
    expect(() => normalize({ measures: [] })).toThrow(ImportError);
    expect(() => normalize({ partId: 9, measures: [{ voices: [{ rest: true }] }] })).toThrow("different part");
  });
});

function pageMetadata(songId: number) {
  return {
    songId, revisionId: 8869686, image: "v0-3-2-gA9HWwFt_jyzmcl0",
    title: "God Only Knows", artist: "The Beach Boys",
    tracks: Array.from({ length: 25 }, (_, partId) => ({
      ...vocalMetadata, partId, name: `Part ${partId}`, isVocalTrack: partId === 5,
    })),
  };
}

function songPage(metadata: unknown) {
  return new Response(`<html><script type="application/json" id='state'>${JSON.stringify({ meta: { current: metadata } })}</script></html>`);
}

function partJson(partId: number) {
  return new Response(JSON.stringify({ partId, measures: [{ signature: [1, 4], voices: [{ beats: [quarterBeat()] }] }] }));
}

function interceptFetch() {
  return spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request in an offline test."));
}

describe("Songsterr import boundaries", () => {
  test("rejects unsafe URLs before fetching", async () => {
    const fetchSpy = interceptFetch();
    try {
      for (const url of [
        "http://www.songsterr.com/a/wsa/song-s1", "https://songsterr.com.evil.test/song-s1",
        "https://evil.test/song-s1", "https://user:pass@www.songsterr.com/song-s1",
        "https://www.songsterr.com:444/song-s1", "https://www.songsterr.com/a/wsa/no-song-id",
        "https://www.songsterr.com/song-s999999999999999", "file:///song-s1",
      ]) {
        try { await importSong({ url }); throw new Error(`Accepted unsafe URL ${url}`); }
        catch (error) { expect(error).toBeInstanceOf(ImportError); if (error instanceof ImportError) expect(error.status).toBe(400); }
      }
      await expect(importSong({ url: EXAMPLE_URL, partId: 4096 })).rejects.toBeInstanceOf(ImportError);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  test("fetches only the first vocal part out of 25 tracks and protects cached results from mutation", async () => {
    const songId = 910001;
    const url = `https://www.songsterr.com/a/wsa/test-s${songId}`;
    const fetchSpy = interceptFetch()
      .mockResolvedValueOnce(songPage(pageMetadata(songId))).mockResolvedValueOnce(partJson(5));
    try {
      const result = await importSong({ url });
      expect(result.song.tracks).toHaveLength(25);
      expect(result.track.id).toBe(5);
      expect(result.track.isVocal).toBe(true);
      expect(importResultSchema.safeParse(result).success).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(String(fetchSpy.mock.calls[1]?.[0])).toBe(`https://dqsljvtekg760.cloudfront.net/${songId}/8869686/v0-3-2-gA9HWwFt_jyzmcl0/5.json`);
      expect(fetchSpy.mock.calls[0]?.[1]?.redirect).toBe("manual");
      result.track.measures.length = 0;
      const cached = await importSong({ url });
      expect(cached.track.measures).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally { fetchSpy.mockRestore(); }
  });

  test("URL tN takes priority over vocals and an explicit part overrides the URL", async () => {
    const songId = 910002;
    const url = `https://songsterr.com/a/wsa/test-s${songId}t3`;
    const fetchSpy = interceptFetch().mockResolvedValueOnce(songPage(pageMetadata(songId)))
      .mockResolvedValueOnce(partJson(3)).mockResolvedValueOnce(partJson(8));
    try {
      expect((await importSong({ url })).track.id).toBe(3);
      expect((await importSong({ url, partId: 8 })).track.id).toBe(8);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    } finally { fetchSpy.mockRestore(); }
  });

  test("an invalid linked part falls back to vocals, then the first metadata track", async () => {
    const vocalSong = pageMetadata(910003);
    const nonvocalSong = pageMetadata(910004);
    nonvocalSong.tracks = nonvocalSong.tracks.map((track) => ({ ...track, isVocalTrack: false }));
    const fetchSpy = interceptFetch()
      .mockResolvedValueOnce(songPage(vocalSong)).mockResolvedValueOnce(partJson(5))
      .mockResolvedValueOnce(songPage(nonvocalSong)).mockResolvedValueOnce(partJson(0));
    try {
      expect((await importSong({ url: "https://songsterr.com/test-s910003t9999" })).track.id).toBe(5);
      expect((await importSong({ url: "https://songsterr.com/test-s910004t99" })).track.id).toBe(0);
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    } finally { fetchSpy.mockRestore(); }
  });

  test("rejects an explicit missing part without fetching CDN JSON", async () => {
    const fetchSpy = interceptFetch().mockResolvedValueOnce(songPage(pageMetadata(910005)));
    try {
      await expect(importSong({ url: "https://songsterr.com/test-s910005", partId: 30 })).rejects.toThrow("not present");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally { fetchSpy.mockRestore(); }
  });

  test("rejects off-domain, downgraded, credentialed and custom-port page redirects", async () => {
    for (const [index, location] of [
      "https://evil.test/song-s1", "http://www.songsterr.com/song-s1",
      "https://user@www.songsterr.com/song-s1", "https://www.songsterr.com:444/song-s1",
    ].entries()) {
      const fetchSpy = interceptFetch().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location } }));
      try {
        await expect(importSong({ url: `https://songsterr.com/test-s${910010 + index}` })).rejects.toThrow("outside its allowed HTTPS domain");
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      } finally { fetchSpy.mockRestore(); }
    }
  });

  test("follows same-domain page redirects with manual guards", async () => {
    const fetchSpy = interceptFetch()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "https://www.songsterr.com/test-s910014" } }))
      .mockResolvedValueOnce(songPage(pageMetadata(910014))).mockResolvedValueOnce(partJson(5));
    try {
      expect((await importSong({ url: "https://songsterr.com/test-s910014" })).track.id).toBe(5);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(fetchSpy.mock.calls.every((call) => call[1]?.redirect === "manual")).toBe(true);
    } finally { fetchSpy.mockRestore(); }
  });

  test("rejects CDN redirects before contacting a different host", async () => {
    const fetchSpy = interceptFetch().mockResolvedValueOnce(songPage(pageMetadata(910015)))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://evil.test/5.json" } }));
    try {
      await expect(importSong({ url: "https://songsterr.com/test-s910015" })).rejects.toThrow("outside its allowed HTTPS domain");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally { fetchSpy.mockRestore(); }
  });

  test("rejects traversal in revision image and incorrect metadata song IDs", async () => {
    for (const [index, metadata] of [
      { ...pageMetadata(910016), image: "../outside" }, { ...pageMetadata(910017), revisionId: -1 },
      { ...pageMetadata(910018), songId: 1 },
    ].entries()) {
      const fetchSpy = interceptFetch().mockResolvedValueOnce(songPage(metadata));
      try {
        await expect(importSong({ url: `https://songsterr.com/test-s${910016 + index}` })).rejects.toBeInstanceOf(ImportError);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      } finally { fetchSpy.mockRestore(); }
    }
  });

  test("returns readable errors for missing state, invalid JSON, upstream failure and oversized bodies", async () => {
    for (const [index, response] of [
      new Response("<html>No state</html>"), new Response("<script id=state>{broken}</script>"),
      new Response(null, { status: 404 }), new Response("oversized", { headers: { "content-length": String(9 * 1024 * 1024) } }),
    ].entries()) {
      const fetchSpy = interceptFetch().mockResolvedValueOnce(response);
      try {
        await expect(importSong({ url: `https://songsterr.com/test-s${910020 + index}` })).rejects.toBeInstanceOf(ImportError);
      } finally { fetchSpy.mockRestore(); }
    }
  });

  test("uses the fixed alternate CDN only for a selected part rejected by HTTP status", async () => {
    const fetchSpy = interceptFetch().mockResolvedValueOnce(songPage(pageMetadata(910024)))
      .mockResolvedValueOnce(new Response(null, { status: 403 })).mockResolvedValueOnce(partJson(5));
    try {
      expect((await importSong({ url: "https://songsterr.com/test-s910024" })).track.id).toBe(5);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(String(fetchSpy.mock.calls[2]?.[0])).toBe("https://d3d3l6a6rcgkaf.cloudfront.net/910024/8869686/v0-3-2-gA9HWwFt_jyzmcl0/5.json");
    } finally { fetchSpy.mockRestore(); }
  });

  test("does not retry malformed selected-part JSON or a mismatched revision", async () => {
    for (const [index, response] of [
      new Response("not JSON"),
      new Response(JSON.stringify({ songId: 1, measures: [{ voices: [{ rest: true }] }] })),
    ].entries()) {
      const songId = 910025 + index;
      const fetchSpy = interceptFetch().mockResolvedValueOnce(songPage(pageMetadata(songId))).mockResolvedValueOnce(response);
      try {
        await expect(importSong({ url: `https://songsterr.com/test-s${songId}` })).rejects.toBeInstanceOf(ImportError);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      } finally { fetchSpy.mockRestore(); }
    }
  });

  test("enforces the streamed byte limit even without content-length", async () => {
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
      controller.close();
    } }));
    const fetchSpy = interceptFetch().mockResolvedValueOnce(response);
    try {
      await expect(importSong({ url: "https://songsterr.com/test-s910027" })).rejects.toThrow("8 MiB import limit");
    } finally { fetchSpy.mockRestore(); }
  });

  test("passes a 15-second abort signal and reports timeouts as HTTP 504", async () => {
    const signal = AbortSignal.abort(new DOMException("Timed out", "TimeoutError"));
    const timeoutSpy = spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const fetchSpy = interceptFetch().mockRejectedValueOnce(signal.reason);
    try {
      try { await importSong({ url: "https://songsterr.com/test-s910028" }); throw new Error("Expected a timeout."); }
      catch (error) {
        expect(error).toBeInstanceOf(ImportError);
        if (error instanceof ImportError) {
          expect(error.status).toBe(504);
          expect(error.message).toContain("timed out after 15 seconds");
        }
      }
      expect(timeoutSpy).toHaveBeenCalledWith(15_000);
      expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBe(signal);
    } finally { fetchSpy.mockRestore(); timeoutSpy.mockRestore(); }
  });

  test("evicts old entries instead of growing caches without bound", async () => {
    const fetchSpy = interceptFetch();
    try {
      for (let index = 0; index < 17; index++) {
        const songId = 911000 + index;
        fetchSpy.mockResolvedValueOnce(songPage(pageMetadata(songId))).mockResolvedValueOnce(partJson(5));
        await importSong({ url: `https://songsterr.com/test-s${songId}` });
      }
      expect(fetchSpy).toHaveBeenCalledTimes(34);
      fetchSpy.mockResolvedValueOnce(songPage(pageMetadata(911000))).mockResolvedValueOnce(partJson(5));
      await importSong({ url: "https://songsterr.com/test-s911000" });
      expect(fetchSpy).toHaveBeenCalledTimes(36);
    } finally { fetchSpy.mockRestore(); }
  });

  test("expires cached metadata and selected tracks", async () => {
    const now = Date.now();
    const clockSpy = spyOn(Date, "now").mockReturnValue(now);
    const fetchSpy = interceptFetch()
      .mockResolvedValueOnce(songPage(pageMetadata(912000))).mockResolvedValueOnce(partJson(5))
      .mockResolvedValueOnce(songPage(pageMetadata(912000))).mockResolvedValueOnce(partJson(5));
    try {
      await importSong({ url: "https://songsterr.com/test-s912000" });
      clockSpy.mockReturnValue(now + 11 * 60_000);
      await importSong({ url: "https://songsterr.com/test-s912000" });
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    } finally { fetchSpy.mockRestore(); clockSpy.mockRestore(); }
  });
});

const liveTest = process.env.SONGSTERR_LIVE === "1" ? test : test.skip;
liveTest("imports aligned lyrics from the requested In My Life vocal track", async () => {
  const result = await importSong({ url: "https://www.songsterr.com/a/wsa/beatles-in-my-life-vocal-tab-s2814" });
  const syllables = result.track.measures.flatMap((measure) => measure.voices.flatMap((voice) => voice.beats
    .flatMap((beat) => beat.kind === "notes" && beat.lyric?.kind === "syllable" ? [{ id: beat.id, ...beat.lyric }] : [])));
  expect(result.song.id).toBe(2814);
  expect(result.track.isVocal).toBe(true);
  expect(syllables[0]).toMatchObject({ id: "0:3:0:1", text: "There", hyphen: false });
  expect(syllables[2]).toMatchObject({ id: "0:4:0:0", text: "pla", hyphen: true });
  expect(syllables.length).toBeGreaterThan(100);
  expect(result.warnings).toEqual([]);
}, 40_000);

liveTest("read-only live import of the shared Songsterr example", async () => {
  const fetchSpy = spyOn(globalThis, "fetch");
  try {
    const result = await importSong({ url: EXAMPLE_URL });
    expect(importResultSchema.safeParse(result).success).toBe(true);
    expect(result.song.id).toBe(31795);
    expect(result.track.isVocal).toBe(true);
    expect(result.track.noteCount).toBeGreaterThan(0);
    expect(result.track.measures.length).toBeGreaterThan(0);
    expect(fetchSpy.mock.calls.filter((call) => String(call[0]).endsWith(".json"))).toHaveLength(1);
    console.info(JSON.stringify({
      liveSong: result.song.title, artist: result.song.artist, revisionId: result.song.revisionId,
      availableTracks: result.song.tracks.length, selectedPart: result.track.id, name: result.track.name,
      instrument: result.track.instrument, isVocal: result.track.isVocal, measures: result.track.measures.length,
      noteCount: result.track.noteCount, range: result.track.range, tempoChanges: result.track.tempos.length,
      warnings: result.warnings, requests: fetchSpy.mock.calls.map((call) => String(call[0])),
    }));
  } finally { fetchSpy.mockRestore(); }
}, 40_000);

const livePercussionSourceSchema = z.object({
  partId: z.number().int(),
  revisionId: z.number().int(),
  measures: z.array(z.object({ voices: z.array(z.object({ beats: z.array(z.object({
    notes: z.array(z.object({
      fret: z.number().optional(),
      string: z.number().optional(),
      rest: z.boolean().default(false),
      dead: z.boolean().default(false),
    })).default([]),
  })) })) })),
});

for (const fixture of percussionFixtures.cases) {
  liveTest(`read-only live percussion import matches source notes for part ${fixture.partId}`, async () => {
    const realFetch = globalThis.fetch;
    let rawSource: unknown;
    const captureFetch = Object.assign(async (...args: Parameters<typeof fetch>) => {
      const response = await realFetch(...args);
      if (String(args[0]).endsWith(`/${fixture.partId}.json`) && response.ok) {
        rawSource = await response.clone().json();
      }
      return response;
    }, { preconnect: realFetch.preconnect });
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(captureFetch);
    try {
      const result = await importSong({ url: EXAMPLE_URL, partId: fixture.partId });
      const source = livePercussionSourceSchema.parse(rawSource);
      const rawNotes = source.measures.flatMap((measure) => measure.voices.flatMap((voice) =>
        voice.beats.flatMap((beat) => beat.notes))).filter((note) => !note.rest);
      const validMidi = rawNotes.flatMap((note) => !note.dead && note.fret !== undefined &&
        Number.isInteger(note.fret) && note.fret >= 0 && note.fret <= 127 ? [note.fret] : []);
      const importedNotes = result.track.measures.flatMap((measure) => measure.voices.flatMap((voice) =>
        voice.beats.flatMap((beat) => beat.kind === "notes" ? beat.notes : [])));
      expect(source.partId).toBe(fixture.partId);
      expect(source.revisionId).toBe(result.song.revisionId);
      expect(validMidi.length).toBeGreaterThan(0);
      expect(result.track.isPercussion).toBe(true);
      expect(result.track.range).toBeNull();
      expect(result.track.noteCount).toBe(validMidi.length);
      expect(importedNotes.map((note) => note.midi)).toEqual(validMidi);
      expect(importedNotes.every((note) => note.kind === "percussion")).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(fetchSpy.mock.calls.filter((call) => String(call[0]).endsWith(".json"))).toHaveLength(1);
      console.info(JSON.stringify({
        livePercussionPart: fixture.partId, name: result.track.name, revisionId: result.song.revisionId,
        rawNotes: rawNotes.length, validSourceNotes: validMidi.length, importedNotes: result.track.noteCount,
        staffStrings: [...new Set(rawNotes.map((note) => note.string))], warnings: result.warnings,
      }));
    } finally { fetchSpy.mockRestore(); }
  }, 40_000);
}
