import { describe, expect, test } from "bun:test";
import { LyricCursor, syllable } from "./lyrics";

function cursor(text: string) {
  return new LyricCursor({ line: 1, offset: 1, text });
}

describe("Songsterr lyric syllables", () => {
  test("ignores section comments and line breaks while retaining syllable hyphens and joined words", () => {
    const lyrics = cursor("[Verse 1]\r\nThere are pla-ces\n[Bridge]\nall+of+us");
    expect(Array.from({ length: 6 }, () => lyrics.next({ tied: false }))).toEqual([
      { kind: "syllable", text: "There", hyphen: false },
      { kind: "syllable", text: "are", hyphen: false },
      { kind: "syllable", text: "pla", hyphen: true },
      { kind: "syllable", text: "ces", hyphen: false },
      { kind: "syllable", text: "all of us", hyphen: false },
      null,
    ]);
  });

  test("spaces extend a syllable onto successive notes, including tied notes", () => {
    const lyrics = cursor("life,     though");
    expect(lyrics.next({ tied: false })).toEqual({ kind: "syllable", text: "life,", hyphen: false });
    expect(lyrics.next({ tied: true })).toEqual({ kind: "hold" });
    expect(lyrics.next({ tied: false })).toEqual({ kind: "hold" });
    expect(lyrics.next({ tied: false })).toEqual({ kind: "hold" });
    expect(lyrics.next({ tied: true })).toEqual({ kind: "hold" });
    expect(lyrics.next({ tied: true })).toEqual({ kind: "hold" });
    expect(lyrics.next({ tied: false })).toEqual({ kind: "syllable", text: "though", hyphen: false });
  });

  test("a tied note does not take the next syllable and a hyphen does not turn into a word underline", () => {
    const lyrics = cursor("pla-  ces next");
    expect(lyrics.next({ tied: false })).toEqual({ kind: "syllable", text: "pla", hyphen: true });
    expect(lyrics.next({ tied: false })).toBeNull();
    expect(lyrics.next({ tied: true })).toBeNull();
    expect(lyrics.next({ tied: false })).toEqual({ kind: "syllable", text: "ces", hyphen: false });
    expect(lyrics.next({ tied: true })).toEqual({ kind: "hold" });
    expect(lyrics.next({ tied: false })).toEqual({ kind: "syllable", text: "next", hyphen: false });
  });

  test("leading spaces skip notes and comment spacing does not add an underline", () => {
    const lyrics = cursor("  [Verse] sing  [Bridge] next");
    expect(lyrics.next({ tied: false })).toBeNull();
    expect(lyrics.next({ tied: false })).toBeNull();
    expect(lyrics.next({ tied: false })).toEqual({ kind: "syllable", text: "sing", hyphen: false });
    expect(lyrics.next({ tied: false })).toBeNull();
    expect(lyrics.next({ tied: false })).toBeNull();
    expect(lyrics.next({ tied: false })).toEqual({ kind: "syllable", text: "next", hyphen: false });
  });

  test("keeps Unicode lyrics, punctuation, and the final hyphen", () => {
    const lyrics = cursor("(café) déjà-vu!");
    expect(lyrics.next({ tied: false })).toEqual({ kind: "syllable", text: "café", hyphen: false });
    expect(lyrics.next({ tied: false })).toEqual({ kind: "syllable", text: "déjà", hyphen: true });
    expect(lyrics.next({ tied: false })).toEqual({ kind: "syllable", text: "vu!", hyphen: false });
    expect(cursor("sing-").next({ tied: false })).toEqual({ kind: "syllable", text: "sing", hyphen: true });
    expect(syllable("___")).toEqual({ kind: "hold" });
  });
});
