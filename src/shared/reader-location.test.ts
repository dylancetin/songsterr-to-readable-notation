import { describe, expect, test } from "bun:test";
import { EXAMPLE_URL } from "./model";
import { createReaderUrl, DEFAULT_READER_SETTINGS, readReaderLocation, sourceUrlSchema } from "./reader-location";

const exampleUrl = sourceUrlSchema.parse(EXAMPLE_URL);

function locationUrl(params: Record<string, string> = {}) {
  const url = new URL("https://notes.example/");
  url.searchParams.set("song", EXAMPLE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

describe("reader URL state", () => {
  test("round-trips the source link, track zero, and every reading setting", () => {
    const sourceUrl = sourceUrlSchema.parse(`${EXAMPLE_URL}?t=5&revision=123#t5`);
    const settings = { transpose: -7, accidentalStyle: "flats", zoom: 125, bar: 4, showLyrics: false } satisfies
      Parameters<typeof createReaderUrl>[0]["settings"];
    const currentUrl = new URL("https://notes.example/?theme=paper#score-page");
    const url = createReaderUrl({ currentUrl, sourceUrl, trackId: 0, settings });

    expect(readReaderLocation(url)).toEqual({ kind: "score", url: sourceUrl, trackId: 0, settings });
    expect(url.searchParams.get("theme")).toBe("paper");
    expect(url.hash).toBe("#score-page");
    expect(currentUrl.href).toBe("https://notes.example/?theme=paper#score-page");
  });

  test("a source link alone restores defaults and leaves track selection to the importer", () => {
    expect(readReaderLocation(locationUrl())).toEqual({
      kind: "score", url: exampleUrl, trackId: null, settings: DEFAULT_READER_SETTINGS,
    });
  });

  test("returning settings to defaults removes stale and duplicated parameters", () => {
    const currentUrl = locationUrl({ track: "5", transpose: "12", accidentals: "flats", zoom: "150", bar: "8", lyrics: "0" });
    currentUrl.searchParams.append("track", "9");
    const url = createReaderUrl({ currentUrl, sourceUrl: EXAMPLE_URL, trackId: 0, settings: DEFAULT_READER_SETTINGS });

    expect([...url.searchParams.keys()]).toEqual(["song", "track"]);
    expect(url.searchParams.getAll("track")).toEqual(["0"]);
    expect(readReaderLocation(url)).toEqual({
      kind: "score", url: exampleUrl, trackId: 0, settings: DEFAULT_READER_SETTINGS,
    });
  });

  test("invalid settings fall back independently without discarding valid ones", () => {
    expect(readReaderLocation(locationUrl({
      track: "-1", transpose: "13", accidentals: "flats", zoom: "110", bar: "0", lyrics: "false",
    }))).toEqual({
      kind: "score", url: exampleUrl, trackId: null,
      settings: { ...DEFAULT_READER_SETTINGS, accidentalStyle: "flats" },
    });
  });

  test("numeric parameters reject coercion tricks and unsafe integers", () => {
    for (const value of ["", " ", "0x4", "1e2", "1.5", "Infinity", "9007199254740992"]) {
      expect(readReaderLocation(locationUrl({ track: value, transpose: value, zoom: value, bar: value }))).toEqual({
        kind: "score", url: exampleUrl, trackId: null, settings: DEFAULT_READER_SETTINGS,
      });
    }
    expect(readReaderLocation(locationUrl({ track: "4096" }))).toMatchObject({ trackId: null });
  });

  test("accepts the limits supported by the reader", () => {
    expect(readReaderLocation(locationUrl({ track: "4095", transpose: "-12", zoom: "75", bar: "1", lyrics: "1" })))
      .toMatchObject({ trackId: 4095, settings: { transpose: -12, zoom: 75, bar: 1, showLyrics: true } });
    expect(readReaderLocation(locationUrl({ transpose: "12", zoom: "150" })))
      .toMatchObject({ settings: { transpose: 12, zoom: 150 } });
  });

  test("missing and unsafe source links do not trigger an import", () => {
    expect(readReaderLocation(new URL("https://notes.example/?track=0"))).toEqual({ kind: "empty" });
    for (const song of [
      "https://example.com/song", "http://www.songsterr.com/song", "https://songsterr.com.evil.example/song",
      "https://user:password@www.songsterr.com/song", "https://www.songsterr.com:8080/song", "not a URL",
    ]) {
      expect(readReaderLocation(locationUrl({ song }))).toEqual({ kind: "empty" });
    }
  });
});
