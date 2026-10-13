import { z } from "zod";
import {
  importRequestSchema,
  importResultSchema,
  scoreTrackSchema,
  type Beat,
  type ImportResult,
  type Measure,
  type ScoreNote,
  type ScoreTrack,
  type TrackSummary,
} from "../shared/model";
import { legacyLyricsSchema, lyricLineSchema, LyricCursor, syllable } from "./lyrics";

export class ImportError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ImportError";
  }
}

const positiveId = z.number().int().min(1).max(2_147_483_647);
const songIdSchema = positiveId.brand<"SongId">();
const revisionIdSchema = positiveId.brand<"RevisionId">();
const partIdSchema = z.number().int().min(0).max(4095).brand<"PartId">();
const midiSchema = z.number().int().min(0).max(127);
const tuningSchema = z.array(midiSchema).max(32);
const metadataTrackSchema = z.object({
  partId: partIdSchema,
  instrumentId: z.number().int().min(0).max(4095).optional(),
  instrument: z.string().max(256).optional(),
  name: z.string().max(1024).optional(),
  title: z.string().max(1024).optional(),
  tuning: tuningSchema.optional(),
  isVocalTrack: z.boolean().default(false),
  isDrums: z.boolean().default(false),
});
const metadataSchema = z.object({
  songId: songIdSchema,
  revisionId: revisionIdSchema,
  image: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  title: z.string().min(1).max(2048),
  artist: z.string().min(1).max(2048),
  tracks: z.array(metadataTrackSchema).min(1).max(512).refine(
    (tracks) => new Set(tracks.map((track) => track.partId)).size === tracks.length,
    "Track part IDs must be unique",
  ),
});
const stateSchema = z.object({ meta: z.object({ current: metadataSchema }) });
const rationalSchema = z.tuple([
  z.number().int().min(1).max(1_000_000_000),
  z.number().int().min(1).max(1_000_000_000),
]);
const denominatorSchema = z.number().finite().min(0.5).max(4096);
const dotsSchema = z.number().int().min(0).max(4);
const tupletSchema = z.number().int().min(2).max(64);
const signatureSchema = z.tuple([
  z.number().int().min(1).max(128),
  z.number().int().min(1).max(128),
]);
const drumNoteSchema = z.object({
  fret: midiSchema.optional(),
  tie: z.boolean().default(false),
  rest: z.boolean().default(false),
  dead: z.boolean().default(false),
});
const pitchedNoteSchema = drumNoteSchema.extend({
  string: z.number().int().min(0).max(31).optional(),
});
const sourceBeatSchema = z.object({
  notes: z.array(z.unknown()).max(128).default([]),
  lyrics: z.unknown().optional(),
  duration: z.unknown().optional(),
  type: z.unknown().optional(),
  dots: z.unknown().optional(),
  tuplet: z.unknown().optional(),
  tupletStart: z.boolean().default(false),
  tupletStop: z.boolean().default(false),
  rest: z.boolean().default(false),
  graceNote: z.enum(["beforeBeat", "onBeat"]).optional(),
  beamStart: z.boolean().default(false),
  beamStop: z.boolean().default(false),
});
const sourceVoiceSchema = z.object({
  beats: z.array(sourceBeatSchema).max(4096).default([]),
  rest: z.boolean().default(false),
});
const sourceMeasureSchema = z.object({
  voices: z.array(sourceVoiceSchema).max(32).default([]),
  signature: z.unknown().optional(),
  marker: z.union([z.string(), z.object({ text: z.string() })]).optional(),
  repeatStart: z.boolean().default(false),
  repeat: z.number().int().min(0).max(1024).optional(),
  repeatCount: z.number().int().min(0).max(1024).optional(),
  alternateEnding: z.union([
    z.array(z.number().int().min(1).max(32)).max(32),
    z.number().int().min(0).max(0xffff_ffff),
  ]).optional(),
  tripletFeel: z.string().max(64).nullable().optional(),
  rest: z.boolean().default(false),
});
const tempoPointSchema = z.object({
  measure: z.number().int().nonnegative(),
  position: z.number().nonnegative().finite().default(0),
  bpm: z.number().positive().finite(),
  type: denominatorSchema.default(4),
});
const revisionSchema = z.object({
  name: z.string().max(1024).optional(),
  instrumentId: z.number().int().min(0).max(4095).optional(),
  instrument: z.string().max(256).optional(),
  tuning: tuningSchema.optional(),
  songId: songIdSchema.optional(),
  revisionId: revisionIdSchema.optional(),
  partId: partIdSchema.optional(),
  newLyrics: z.array(z.unknown()).max(32).default([]),
  measures: z.array(sourceMeasureSchema).min(1).max(10_000),
  automations: z.object({ tempo: z.array(z.unknown()).max(10_000).default([]) }).optional(),
});

type Metadata = z.infer<typeof metadataSchema>;
type SongId = z.infer<typeof songIdSchema>;
type PartId = z.infer<typeof partIdSchema>;
type MetadataTrack = z.infer<typeof metadataTrackSchema>;
type Revision = z.infer<typeof revisionSchema>;
type SourceBeat = z.infer<typeof sourceBeatSchema>;
type Timing = Pick<Beat, "duration" | "denominator" | "dots" | "tuplet">;
const standardDenominators = [0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096];

const gmInstruments = [
  "Acoustic grand piano", "Bright acoustic piano", "Electric grand piano", "Honky-tonk piano",
  "Electric piano 1", "Electric piano 2", "Harpsichord", "Clavinet",
  "Celesta", "Glockenspiel", "Music box", "Vibraphone", "Marimba", "Xylophone", "Tubular bells", "Dulcimer",
  "Drawbar organ", "Percussive organ", "Rock organ", "Church organ", "Reed organ", "Accordion", "Harmonica", "Tango accordion",
  "Acoustic guitar (nylon)", "Acoustic guitar (steel)", "Electric guitar (jazz)", "Electric guitar (clean)",
  "Electric guitar (muted)", "Overdriven guitar", "Distortion guitar", "Guitar harmonics",
  "Acoustic bass", "Electric bass (finger)", "Electric bass (pick)", "Fretless bass", "Slap bass 1", "Slap bass 2", "Synth bass 1", "Synth bass 2",
  "Violin", "Viola", "Cello", "Contrabass", "Tremolo strings", "Pizzicato strings", "Orchestral harp", "Timpani",
  "String ensemble 1", "String ensemble 2", "Synth strings 1", "Synth strings 2", "Choir aahs", "Voice oohs", "Synth voice", "Orchestra hit",
  "Trumpet", "Trombone", "Tuba", "Muted trumpet", "French horn", "Brass section", "Synth brass 1", "Synth brass 2",
  "Soprano saxophone", "Alto saxophone", "Tenor saxophone", "Baritone saxophone", "Oboe", "English horn", "Bassoon", "Clarinet",
  "Piccolo", "Flute", "Recorder", "Pan flute", "Blown bottle", "Shakuhachi", "Whistle", "Ocarina",
  "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)", "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass + lead)",
  "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)", "Pad 5 (bowed)", "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)",
  "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)", "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)",
  "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bagpipe", "Fiddle", "Shanai",
  "Tinkle bell", "Agogo", "Steel drums", "Woodblock", "Taiko drum", "Melodic tom", "Synth drum", "Reverse cymbal",
  "Guitar fret noise", "Breath noise", "Seashore", "Bird tweet", "Telephone ring", "Helicopter", "Applause", "Gunshot",
];
const drumLabels = [
  "Acoustic bass drum", "Bass drum", "Side stick", "Acoustic snare", "Hand clap", "Electric snare",
  "Low floor tom", "Closed hi-hat", "High floor tom", "Pedal hi-hat", "Low tom", "Open hi-hat",
  "Low-mid tom", "High-mid tom", "Crash cymbal 1", "High tom", "Ride cymbal 1", "Chinese cymbal",
  "Ride bell", "Tambourine", "Splash cymbal", "Cowbell", "Crash cymbal 2", "Vibraslap", "Ride cymbal 2",
  "High bongo", "Low bongo", "Mute high conga", "Open high conga", "Low conga", "High timbale", "Low timbale",
  "High agogo", "Low agogo", "Cabasa", "Maracas", "Short whistle", "Long whistle", "Short guiro", "Long guiro",
  "Claves", "High woodblock", "Low woodblock", "Mute cuica", "Open cuica", "Mute triangle", "Open triangle",
  "Shaker", "Jingle bell", "Bell tree", "Castanets", "Mute surdo", "Open surdo",
];

function summarizeTrack(metadata: MetadataTrack, revision?: Revision): TrackSummary {
  const instrumentId = metadata.instrumentId ?? revision?.instrumentId;
  const isPercussion = metadata.isDrums || instrumentId === 1024;
  return {
    id: metadata.partId,
    name: metadata.name?.trim() || metadata.title?.trim() || revision?.name?.trim() || `Part ${metadata.partId + 1}`,
    instrument: isPercussion ? "Drums" :
      (instrumentId === undefined ? undefined : gmInstruments[instrumentId]) ??
      metadata.instrument?.trim() ?? revision?.instrument?.trim() ?? "Unknown instrument",
    isVocal: metadata.isVocalTrack,
    isPercussion,
    tuning: revision?.tuning ?? metadata.tuning ?? [],
  };
}

class Warnings {
  private readonly messages: string[] = [];
  private omitted = 0;

  add(message: string): void {
    if (this.messages.length < 199) this.messages.push(message);
    else this.omitted++;
  }

  result(): string[] {
    return this.omitted > 0
      ? [...this.messages, `${this.omitted} additional source warnings omitted.`]
      : [...this.messages];
  }
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-8 * Math.max(1, Math.abs(left), Math.abs(right));
}

function dotFactor(dots: number): number {
  return 2 - 2 ** -dots;
}

function tupletFactor(tuplet: number | null): number {
  if (tuplet === null) return 1;
  if (tuplet === 2) return 3 / 2;
  return 2 ** Math.floor(Math.log2(tuplet - 1)) / tuplet;
}

function inferNotation(duration: number, factor: number): Pick<Timing, "denominator" | "dots"> {
  for (const denominator of standardDenominators) {
    for (let dots = 0; dots <= 4; dots++) {
      if (nearlyEqual(duration, 4 / denominator * dotFactor(dots) * factor)) {
        return { denominator, dots };
      }
    }
  }
  return { denominator: 4 * factor / duration, dots: 0 };
}

function decodeTiming(beat: SourceBeat, location: string, warnings: Warnings): Timing | null {
  const rational = rationalSchema.safeParse(beat.duration);
  const base = denominatorSchema.safeParse(beat.type);
  const explicitDots = dotsSchema.safeParse(beat.dots);
  const explicitTuplet = tupletSchema.safeParse(beat.tuplet);
  const tuplet = explicitTuplet.success ? explicitTuplet.data : null;
  if (beat.tuplet !== undefined && !explicitTuplet.success) warnings.add(`${location}: invalid tuplet ignored.`);
  if (beat.dots !== undefined && !explicitDots.success) warnings.add(`${location}: invalid dot count ignored.`);
  if (beat.type !== undefined && !base.success) warnings.add(`${location}: invalid base note type.`);
  const factor = tupletFactor(tuplet);
  const duration = rational.success ? 4 * rational.data[0] / rational.data[1] :
    base.success ? 4 / base.data * dotFactor(explicitDots.success ? explicitDots.data : 0) * factor : null;
  if (duration === null || !Number.isFinite(duration) || duration <= 0) {
    warnings.add(`${location}: missing or invalid source duration and base type; beat skipped.`);
    return null;
  }
  if (!rational.success) warnings.add(`${location}: missing or invalid source duration; reconstructed from base type.`);
  let notation = inferNotation(duration, factor);
  if (base.success) {
    let dots = explicitDots.success ? explicitDots.data : 0;
    if (!explicitDots.success) {
      for (let candidate = 0; candidate <= 4; candidate++) {
        if (nearlyEqual(duration, 4 / base.data * dotFactor(candidate) * factor)) {
          dots = candidate;
          break;
        }
      }
    }
    notation = { denominator: base.data, dots };
  } else if (explicitDots.success) {
    notation = { denominator: 4 * dotFactor(explicitDots.data) * factor / duration, dots: explicitDots.data };
  }
  const expected = 4 / notation.denominator * dotFactor(notation.dots) * factor;
  if (!nearlyEqual(duration, expected)) {
    warnings.add(`${location}: source duration ${duration} quarters disagrees with base type/dots/tuplet; kept source duration.`);
  }
  if (!base.success && !standardDenominators.includes(notation.denominator)) {
    warnings.add(`${location}: source duration has no standard base note type; kept exact duration.`);
  }
  return { duration, ...notation, tuplet };
}

function decodeNotes(beat: SourceBeat, track: TrackSummary, location: string, warnings: Warnings): ScoreNote[] {
  const notes: ScoreNote[] = [];
  const noteSchema = track.isPercussion ? drumNoteSchema : pitchedNoteSchema;
  for (const [index, rawNote] of beat.notes.entries()) {
    const parsed = noteSchema.safeParse(rawNote);
    const noteLocation = `${location}, note ${index + 1}`;
    if (!parsed.success) {
      warnings.add(`${noteLocation}: undecodable note skipped.`);
      continue;
    }
    const note = parsed.data;
    if (note.rest) continue;
    if (note.dead) {
      warnings.add(`${noteLocation}: unpitched dead note skipped.`);
      continue;
    }
    if (note.fret === undefined) {
      warnings.add(`${noteLocation}: missing fret; note skipped.`);
      continue;
    }
    if (track.isPercussion) {
      notes.push({ kind: "percussion", midi: note.fret, label: drumLabels[note.fret - 35] ?? `Percussion ${note.fret}`, tie: note.tie });
      continue;
    }
    const openPitch = "string" in note && typeof note.string === "number" ? track.tuning[note.string] : undefined;
    if (openPitch === undefined) {
      warnings.add(`${noteLocation}: missing string or tuning; note skipped.`);
      continue;
    }
    const midi = openPitch + note.fret;
    if (!midiSchema.safeParse(midi).success) {
      warnings.add(`${noteLocation}: pitch outside MIDI range; note skipped.`);
      continue;
    }
    notes.push({ kind: "pitch", midi, tie: note.tie });
  }
  return notes;
}

function alternateEndings(value: z.infer<typeof sourceMeasureSchema>["alternateEnding"]): number[] {
  if (value === undefined) return [];
  if (typeof value !== "number") return [...new Set(value)].sort((a, b) => a - b);
  return Array.from({ length: 32 }, (_, index) => index + 1)
    .filter((ending) => Math.floor(value / 2 ** (ending - 1)) % 2 === 1);
}

function normalizeParsedTrack(metadata: MetadataTrack, revision: Revision): Pick<ImportResult, "track" | "warnings"> {
  if (revision.partId !== undefined && revision.partId !== metadata.partId) {
    throw new ImportError("Songsterr returned a different part than requested.", 502);
  }
  const summary = summarizeTrack(metadata, revision);
  const noteSchema = summary.isPercussion ? drumNoteSchema : pitchedNoteSchema;
  const warnings = new Warnings();
  const rawLyrics = revision.newLyrics[revision.newLyrics.length > 5 ? 5 : 0];
  const parsedLyrics = lyricLineSchema.safeParse(rawLyrics);
  if (rawLyrics !== undefined && !parsedLyrics.success) warnings.add("Invalid track lyrics skipped.");
  const lyrics = parsedLyrics.success && parsedLyrics.data.text.trim()
    ? new LyricCursor(parsedLyrics.data) : null;
  let timeSignature: Measure["timeSignature"] = { beats: 4, unit: 4 };
  let tripletFeel: Measure["tripletFeel"] = null;
  let noteCount = 0;
  let range: ScoreTrack["range"] = null;
  const measures: Measure[] = revision.measures.map((source, index) => {
    const measureLocation = `Measure ${index + 1}`;
    const signature = signatureSchema.safeParse(source.signature);
    if (signature.success) timeSignature = { beats: signature.data[0], unit: signature.data[1] };
    else if (source.signature !== undefined) warnings.add(`${measureLocation}: invalid meter; inherited previous meter.`);
    else if (index === 0) warnings.add("First measure has no meter; assumed 4/4.");
    if (source.tripletFeel !== undefined) tripletFeel = source.tripletFeel;
    const measureDuration = 4 * timeSignature.beats / timeSignature.unit;
    const sourceVoices = source.voices.length > 0 ? source.voices : [{ rest: source.rest, beats: [] }];
    const voices: Measure["voices"] = sourceVoices.map((voice, voiceIndex) => {
      const location = `${measureLocation}, voice ${voiceIndex + 1}`;
      const beats: Beat[] = [];
      if (voice.beats.length === 0) {
        if (voice.rest || source.rest) {
          beats.push({
            kind: "rest", id: `${metadata.partId}:${index}:${voiceIndex}:rest`, start: 0,
            duration: measureDuration, ...inferNotation(measureDuration, 1), tuplet: null,
            tupletStart: false, tupletStop: false,
            grace: false, beamStart: false, beamStop: false,
          });
        } else warnings.add(`${location}: no source beats.`);
        return { beats };
      }
      let start = 0;
      for (const [beatIndex, sourceBeat] of voice.beats.entries()) {
        const beatLocation = `${location}, beat ${beatIndex + 1}`;
        const isRest = sourceBeat.rest || voice.rest || source.rest ||
          (sourceBeat.notes.length > 0 && sourceBeat.notes.every((note) => noteSchema.safeParse(note).data?.rest === true));
        let lyric: Extract<Beat, { kind: "notes" }>["lyric"] = null;
        if (!isRest && sourceBeat.graceNote === undefined) {
          if (lyrics) {
            if (voiceIndex === 0 && index + 1 >= lyrics.startMeasure) {
              lyric = lyrics.next({ tied: sourceBeat.notes.every((note) => noteSchema.safeParse(note).data?.tie === true) });
            }
          } else if (sourceBeat.lyrics !== undefined) {
            const legacy = legacyLyricsSchema.safeParse(sourceBeat.lyrics);
            if (legacy.success) lyric = syllable(legacy.data[0]?.text ?? "");
            else warnings.add(`${beatLocation}: invalid beat lyrics skipped.`);
          }
        }
        const timing = decodeTiming(sourceBeat, beatLocation, warnings);
        if (timing === null) continue;
        const grace = sourceBeat.graceNote !== undefined;
        const notes = decodeNotes(sourceBeat, summary, beatLocation, warnings);
        const common = {
          id: `${metadata.partId}:${index}:${voiceIndex}:${beatIndex}`, start, ...timing, grace,
          tupletStart: sourceBeat.tupletStart, tupletStop: sourceBeat.tupletStop,
          beamStart: sourceBeat.beamStart, beamStop: sourceBeat.beamStop,
        };
        if (isRest) beats.push({ kind: "rest", ...common });
        else if (notes.length > 0) {
          beats.push({ kind: "notes", ...common, notes, lyric });
          noteCount += notes.length;
          for (const note of notes) {
            if (note.kind === "pitch") {
              range = range === null ? { low: note.midi, high: note.midi } :
                { low: Math.min(range.low, note.midi), high: Math.max(range.high, note.midi) };
            }
          }
        } else warnings.add(`${beatLocation}: no decodable notes; beat omitted but its timing retained.`);
        if (!grace) start += timing.duration;
      }
      if (!nearlyEqual(start, measureDuration)) {
        warnings.add(`${location}: source durations total ${Number(start.toFixed(8))} quarters; meter expects ${measureDuration}.`);
      }
      return { beats };
    });
    return {
      index, number: index + 1, timeSignature: { ...timeSignature },
      marker: typeof source.marker === "string" ? source.marker : source.marker?.text ?? null,
      repeatStart: source.repeatStart, repeatCount: source.repeat ?? source.repeatCount ?? 0,
      alternateEndings: alternateEndings(source.alternateEnding), tripletFeel, voices,
    };
  });
  const tempos: ScoreTrack["tempos"] = [];
  for (const [index, rawPoint] of (revision.automations?.tempo ?? []).entries()) {
    const parsed = tempoPointSchema.safeParse(rawPoint);
    if (!parsed.success) {
      warnings.add(`Tempo point ${index + 1}: invalid tempo automation skipped.`);
      continue;
    }
    const point = parsed.data;
    const measure = measures[point.measure];
    const position = 4 * point.position / point.type;
    if (measure === undefined || position > 4 * measure.timeSignature.beats / measure.timeSignature.unit) {
      warnings.add(`Tempo point ${index + 1}: position outside the source measure; skipped.`);
      continue;
    }
    tempos.push({ measure: point.measure, position, bpm: point.bpm });
  }
  tempos.sort((a, b) => a.measure - b.measure || a.position - b.position);
  const track = scoreTrackSchema.parse({ ...summary, measures, tempos, noteCount, range });
  return { track, warnings: warnings.result() };
}

function parseBoundary<T>(schema: z.ZodType<T>, value: unknown, description: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ImportError(`${description} is invalid${issue ? ` at ${issue.path.join(".") || "root"}: ${issue.message}` : ""}.`, 502);
  }
  return parsed.data;
}

export function normalizeTrack(input: { metadata: unknown; revision: unknown }): Pick<ImportResult, "track" | "warnings"> {
  return normalizeParsedTrack(
    parseBoundary(metadataTrackSchema, input.metadata, "Songsterr track metadata"),
    parseBoundary(revisionSchema, input.revision, "Songsterr part JSON"),
  );
}

class MemoryCache<T> {
  private readonly entries = new Map<string, { value: T; expires: number; bytes: number }>();
  private bytes = 0;

  constructor(private readonly maxEntries: number, private readonly maxBytes: number, private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) {
      this.remove(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    this.remove(key);
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (bytes > this.maxBytes) return;
    for (const [existingKey, entry] of this.entries) {
      if (entry.expires <= Date.now()) this.remove(existingKey);
    }
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.remove(oldest.value);
    }
    this.entries.set(key, { value, bytes, expires: Date.now() + this.ttlMs });
    this.bytes += bytes;
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }
}

const metadataCache = new MemoryCache<Metadata>(16, 2 * 1024 * 1024, 5 * 60_000);
const trackCache = new MemoryCache<Pick<ImportResult, "track" | "warnings">>(16, 24 * 1024 * 1024, 10 * 60_000);
const cdnHosts = ["dqsljvtekg760.cloudfront.net", "d3d3l6a6rcgkaf.cloudfront.net"];
const songHosts = ["songsterr.com", "www.songsterr.com"];
const requestTimeoutMs = 15_000;
const maxResponseBytes = 8 * 1024 * 1024;

class HttpImportError extends ImportError {
  constructor(description: string, public readonly responseStatus: number, status: number) {
    super(`${description} could not be loaded (HTTP ${responseStatus}).`, status);
  }
}

function hasAllowedOrigin(url: URL, hosts: readonly string[]): boolean {
  return url.protocol === "https:" && hosts.includes(url.hostname) &&
    url.username === "" && url.password === "" && (url.port === "" || url.port === "443");
}

function parseSongUrl(rawUrl: string): { url: URL; songId: SongId; linkedPartId: PartId | undefined } {
  let url: URL;
  try { url = new URL(rawUrl); }
  catch { throw new ImportError("Enter a valid HTTPS Songsterr song URL.", 400); }
  if (!hasAllowedOrigin(url, songHosts)) {
    throw new ImportError("Use an HTTPS URL on songsterr.com or www.songsterr.com without credentials or a custom port.", 400);
  }
  const match = url.pathname.match(/(?:^|[-/])s([1-9]\d*)(?:t(\d+))?(?=$|[-/])/);
  const songId = songIdSchema.safeParse(Number(match?.[1]));
  if (!songId.success) throw new ImportError("The Songsterr URL must contain a song ID such as s31795 in its path.", 400);
  const rawPart = match?.[2] ?? url.searchParams.get("t") ?? url.hash.match(/^#t(\d+)$/)?.[1];
  const linkedPart = rawPart === undefined || rawPart === null || !/^\d+$/.test(rawPart)
    ? undefined : partIdSchema.safeParse(Number(rawPart));
  return { url, songId: songId.data, linkedPartId: linkedPart?.success ? linkedPart.data : undefined };
}

async function readBoundedText(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length")) > maxResponseBytes) {
    await response.body?.cancel();
    throw new ImportError("Songsterr response exceeds the 8 MiB import limit.", 502);
  }
  if (!response.body) throw new ImportError("Songsterr returned an empty response.", 502);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxResponseBytes) {
        await reader.cancel();
        throw new ImportError("Songsterr response exceeds the 8 MiB import limit.", 502);
      }
      chunks.push(decoder.decode(chunk.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally { reader.releaseLock(); }
}

async function requestText(url: URL, allowedHosts: readonly string[], description: string): Promise<string> {
  const signal = AbortSignal.timeout(requestTimeoutMs);
  let current = url;
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (!hasAllowedOrigin(current, allowedHosts)) throw new ImportError(`${description} redirected outside its allowed HTTPS domain.`, 502);
      const response = await fetch(current, {
        redirect: "manual", signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ReadableNotation/1.0)", Accept: "text/html,application/json" },
      });
      if (response.url && !hasAllowedOrigin(new URL(response.url), allowedHosts)) {
        await response.body?.cancel();
        throw new ImportError(`${description} returned a response from an unexpected domain.`, 502);
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new ImportError(`${description} returned a redirect without a destination.`, 502);
        try { current = new URL(location, current); }
        catch { throw new ImportError(`${description} returned an invalid redirect destination.`, 502); }
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new HttpImportError(description, response.status, response.status === 404 && allowedHosts === songHosts ? 404 : 502);
      }
      return await readBoundedText(response);
    }
    throw new ImportError(`${description} returned too many redirects.`, 502);
  } catch (error) {
    if (error instanceof ImportError) throw error;
    if (signal.aborted) throw new ImportError(`${description} timed out after 15 seconds. Try again.`, 504);
    throw new ImportError(`${description} could not be reached. Try again.`, 502);
  }
}

function parseJson(text: string, description: string): unknown {
  try { return JSON.parse(text); }
  catch { throw new ImportError(`${description} contains unreadable JSON.`, 502); }
}

async function loadMetadata(url: URL, expectedSongId: SongId): Promise<Metadata> {
  const pageUrl = new URL(url);
  pageUrl.hash = "";
  const cacheKey = pageUrl.href;
  const cached = metadataCache.get(cacheKey);
  if (cached) return cached;
  const html = await requestText(pageUrl, songHosts, "Songsterr song page");
  const chunks: string[] = [];
  let stateCount = 0;
  await new HTMLRewriter().on("script#state", {
    element() { stateCount++; },
    text(chunk) { chunks.push(chunk.text); },
  }).transform(new Response(html)).text();
  if (stateCount !== 1 || chunks.length === 0) {
    throw new ImportError("The Songsterr page has no readable script#state song metadata.", 502);
  }
  const metadata = parseBoundary(stateSchema, parseJson(chunks.join(""), "Songsterr page metadata"), "Songsterr page metadata").meta.current;
  if (metadata.songId !== expectedSongId) throw new ImportError("Songsterr returned a different song than requested.", 502);
  metadataCache.set(cacheKey, metadata);
  return metadata;
}

async function loadSelectedTrack(metadata: Metadata, selected: MetadataTrack): Promise<Pick<ImportResult, "track" | "warnings">> {
  const key = `${metadata.songId}/${metadata.revisionId}/${metadata.image}/${selected.partId}`;
  const cached = trackCache.get(key);
  if (cached) return structuredClone(cached);
  let lastError: ImportError | undefined;
  for (const host of cdnHosts) {
    const url = new URL(`https://${host}/${key}.json`);
    let text: string;
    try { text = await requestText(url, [host], `Songsterr part ${selected.partId} JSON`); }
    catch (error) {
      if (error instanceof HttpImportError && [403, 404].includes(error.responseStatus)) {
        lastError = error;
        continue;
      }
      throw error;
    }
    const revision = parseBoundary(revisionSchema, parseJson(text, "Songsterr part JSON"), "Songsterr part JSON");
    if ((revision.songId !== undefined && revision.songId !== metadata.songId) ||
        (revision.revisionId !== undefined && revision.revisionId !== metadata.revisionId)) {
      throw new ImportError("Songsterr returned mismatched song or revision data.", 502);
    }
    const normalized = normalizeParsedTrack(selected, revision);
    trackCache.set(key, structuredClone(normalized));
    return normalized;
  }
  throw lastError ?? new ImportError("The selected Songsterr part is unavailable.", 502);
}

export async function importSong(input: { url: string; partId?: number }): Promise<ImportResult> {
  const parsed = importRequestSchema.safeParse(input);
  if (!parsed.success || (parsed.data.partId !== undefined && !partIdSchema.safeParse(parsed.data.partId).success)) {
    throw new ImportError("Provide a Songsterr URL and an optional nonnegative part ID no greater than 4095.", 400);
  }
  const { url, songId, linkedPartId } = parseSongUrl(parsed.data.url);
  const metadata = await loadMetadata(url, songId);
  const explicitPart = parsed.data.partId;
  const selected = explicitPart !== undefined ? metadata.tracks.find((track) => track.partId === explicitPart) :
    metadata.tracks.find((track) => track.partId === linkedPartId) ??
    metadata.tracks.find((track) => track.isVocalTrack) ?? metadata.tracks[0];
  if (!selected) throw new ImportError("The requested part is not present in this Songsterr revision.", 400);
  const normalized = await loadSelectedTrack(metadata, selected);
  return importResultSchema.parse({
    song: {
      id: metadata.songId, revisionId: metadata.revisionId, title: metadata.title, artist: metadata.artist,
      sourceUrl: url.href,
      tracks: metadata.tracks.map((track) => track.partId === selected.partId ? {
        id: normalized.track.id, name: normalized.track.name, instrument: normalized.track.instrument,
        isVocal: normalized.track.isVocal, isPercussion: normalized.track.isPercussion, tuning: normalized.track.tuning,
      } : summarizeTrack(track)),
    },
    ...normalized,
  });
}
