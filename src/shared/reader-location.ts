import { z } from "zod";
import { trackSummarySchema } from "./model";
import type { ImportResult, TrackSummary } from "./model";

export const sourceUrlSchema = z
  .string()
  .trim()
  .min(1, "Paste a Songsterr song link, or use Try God Only Knows below.")
  .max(2048, "This link is too long. Copy the song's address from Songsterr again.")
  .url("Enter a complete song link, starting with https://www.songsterr.com/.")
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          (url.hostname === "songsterr.com" || url.hostname === "www.songsterr.com") &&
          url.username === "" && url.password === "" &&
          (url.port === "" || url.port === "443")
        );
      } catch {
        return false;
      }
    },
    "Use a Songsterr song link. You can open the example with Try God Only Knows.",
  )
  .brand<"SongsterrUrl">();

const integerParameter = z.string().regex(/^-?\d+$/).transform(Number).pipe(z.number().int());
const trackParameter = integerParameter.pipe(trackSummarySchema.shape.id.max(4095)).nullable().catch(null);
const readerSettingsSchema = z.object({
  transpose: integerParameter.pipe(z.number().min(-12).max(12)).catch(0),
  accidentalStyle: z.enum(["sharps", "flats"]).catch("sharps"),
  zoom: integerParameter.pipe(z.union([z.literal(75), z.literal(100), z.literal(125), z.literal(150)])).catch(100),
  bar: integerParameter.pipe(z.number().positive()).nullable().catch(null),
  showLyrics: z.enum(["0", "1"]).transform((value) => value === "1").catch(true),
});

export type SourceUrl = z.infer<typeof sourceUrlSchema>;
export type ReaderSettings = z.infer<typeof readerSettingsSchema>;
export type ScoreReaderLocation = {
  kind: "score";
  url: SourceUrl;
  trackId: TrackSummary["id"] | null;
  settings: ReaderSettings;
};
export type ReaderLocation = { kind: "empty" } | ScoreReaderLocation;

export const DEFAULT_READER_SETTINGS: ReaderSettings = readerSettingsSchema.parse({});

export function readReaderLocation(url: URL): ReaderLocation {
  const params = url.searchParams;
  const source = sourceUrlSchema.safeParse(params.get("song"));
  if (!source.success) return { kind: "empty" };
  return {
    kind: "score",
    url: source.data,
    trackId: trackParameter.parse(params.get("track")),
    settings: readerSettingsSchema.parse({
      transpose: params.get("transpose"),
      accidentalStyle: params.get("accidentals"),
      zoom: params.get("zoom"),
      bar: params.get("bar"),
      showLyrics: params.get("lyrics"),
    }),
  };
}

export function createReaderUrl({ currentUrl, sourceUrl, trackId, settings }: {
  currentUrl: URL;
  sourceUrl: ImportResult["song"]["sourceUrl"];
  trackId: TrackSummary["id"];
  settings: ReaderSettings;
}): URL {
  const url = new URL(currentUrl);
  const params = url.searchParams;
  for (const key of ["song", "track", "transpose", "accidentals", "zoom", "bar", "lyrics"]) {
    params.delete(key);
  }
  params.set("song", sourceUrl);
  params.set("track", String(trackId));
  if (settings.transpose !== 0) params.set("transpose", String(settings.transpose));
  if (settings.accidentalStyle !== "sharps") params.set("accidentals", settings.accidentalStyle);
  if (settings.zoom !== 100) params.set("zoom", String(settings.zoom));
  if (settings.bar !== null) params.set("bar", String(settings.bar));
  if (!settings.showLyrics) params.set("lyrics", "0");
  return url;
}
