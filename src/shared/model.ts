import { z } from "zod";

const pitchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pitch"), midi: z.number().int(), tie: z.boolean() }),
  z.object({ kind: z.literal("percussion"), midi: z.number().int(), label: z.string(), tie: z.boolean() }),
]);

export const lyricSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("syllable"), text: z.string().min(1), hyphen: z.boolean() }),
  z.object({ kind: z.literal("hold") }),
]);

const beatTiming = {
  id: z.string(),
  start: z.number().nonnegative(),
  duration: z.number().positive(),
  denominator: z.number().positive(),
  dots: z.number().int().nonnegative(),
  tuplet: z.number().int().positive().nullable(),
  tupletStart: z.boolean(),
  tupletStop: z.boolean(),
  grace: z.boolean(),
  beamStart: z.boolean(),
  beamStop: z.boolean(),
};

export const beatSchema = z.discriminatedUnion("kind", [
  z.object({ ...beatTiming, kind: z.literal("rest") }),
  z.object({ ...beatTiming, kind: z.literal("notes"), notes: z.array(pitchSchema).min(1), lyric: lyricSchema.nullable().default(null) }),
]);

export const measureSchema = z.object({
  index: z.number().int().nonnegative(),
  number: z.number().int().positive(),
  timeSignature: z.object({ beats: z.number().int().positive(), unit: z.number().int().positive() }),
  marker: z.string().nullable(),
  repeatStart: z.boolean(),
  repeatCount: z.number().int().nonnegative(),
  alternateEndings: z.array(z.number().int().positive()),
  tripletFeel: z.string().nullable(),
  voices: z.array(z.object({ beats: z.array(beatSchema) })).min(1),
});

export const trackSummarySchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string(),
  instrument: z.string(),
  isVocal: z.boolean(),
  isPercussion: z.boolean(),
  tuning: z.array(z.number().int()),
});

export const scoreTrackSchema = trackSummarySchema.extend({
  measures: z.array(measureSchema).min(1),
  tempos: z.array(z.object({ measure: z.number().int().nonnegative(), position: z.number(), bpm: z.number().positive() })),
  noteCount: z.number().int().nonnegative(),
  range: z.object({ low: z.number().int(), high: z.number().int() }).nullable(),
});

export const importResultSchema = z.object({
  song: z.object({
    id: z.number().int().positive(),
    revisionId: z.number().int().positive(),
    title: z.string(),
    artist: z.string(),
    sourceUrl: z.string().url(),
    tracks: z.array(trackSummarySchema).min(1),
  }),
  track: scoreTrackSchema,
  warnings: z.array(z.string()),
});

export const importRequestSchema = z.object({ url: z.string().min(1).max(2048), partId: z.number().int().nonnegative().optional() });
export type ImportResult = z.infer<typeof importResultSchema>;
export type ScoreTrack = z.infer<typeof scoreTrackSchema>;
export type TrackSummary = z.infer<typeof trackSummarySchema>;
export type Measure = z.infer<typeof measureSchema>;
export type Beat = z.infer<typeof beatSchema>;
export type ScoreNote = z.infer<typeof pitchSchema>;
export type Lyric = z.infer<typeof lyricSchema>;
export type AccidentalStyle = "sharps" | "flats";

const sharpNames = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const flatNames = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

export function noteParts(midi: number, accidentalStyle: AccidentalStyle = "sharps") {
  const names = accidentalStyle === "flats" ? flatNames : sharpNames;
  return { name: names[((midi % 12) + 12) % 12] ?? "C", octave: Math.floor(midi / 12) - 1 };
}

export function noteLabel(midi: number, accidentalStyle: AccidentalStyle = "sharps") {
  const { name, octave } = noteParts(midi, accidentalStyle);
  return `${name}${octave}`;
}

export const EXAMPLE_URL = "https://www.songsterr.com/a/wsa/beach-boys-god-only-knows-vocal-tab-s31795";
