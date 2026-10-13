import { z } from "zod";
import type { Lyric } from "../shared/model";

export const lyricLineSchema = z.object({
  line: z.number().int().min(1).max(32),
  offset: z.number().int().min(0).max(10_000).default(1),
  text: z.string().max(1_000_000),
});

export const legacyLyricsSchema = z.array(z.object({ text: z.string().max(1_000_000) })).max(32);

type LyricToken =
  | { kind: "syllable"; lyric: Extract<Lyric, { kind: "syllable" }> }
  | { kind: "space"; newline: boolean; commentAdjacent: boolean };

export function syllable(text: string): Lyric | null {
  const value = text.replace(/\+/g, " ").trim();
  if (!value) return null;
  if (/^_+$/.test(value)) return { kind: "hold" };
  const hyphen = value.endsWith("-");
  const word = (hyphen ? value.slice(0, -1) : value).trim();
  return word ? { kind: "syllable", text: word, hyphen } : null;
}

function tokenize(text: string): LyricToken[] {
  const source = `${text.replace(/\t/g, " ").replace(/_+/g, "\u00a0").replace(/[()]/g, "")}\n`;
  const tokens: LyricToken[] = [];
  let start = 0;
  let afterComment = false;
  for (const match of source.matchAll(/\[.*?\]|\s?-\s?|\r\n|\n|\s/g)) {
    const separator = match[0];
    const comment = separator.startsWith("[");
    if (match.index > start) {
      const lyric = syllable(source.slice(start, match.index) + (!comment && separator.includes("-") ? "-" : ""));
      if (lyric?.kind === "syllable") tokens.push({ kind: "syllable", lyric });
      afterComment = false;
    }
    start = match.index + separator.length;
    if (comment) {
      const previous = tokens.at(-1);
      if (previous?.kind === "space") previous.commentAdjacent = true;
      afterComment = true;
    } else {
      tokens.push({ kind: "space", newline: separator === "\n" || separator === "\r\n", commentAdjacent: afterComment });
      afterComment = false;
    }
  }
  return tokens;
}

export class LyricCursor {
  private readonly tokens: LyricToken[];
  private index = 0;
  private previous: LyricToken | undefined;
  private lastSyllable: Extract<Lyric, { kind: "syllable" }> | null = null;
  readonly startMeasure: number;

  constructor(line: z.infer<typeof lyricLineSchema>) {
    this.tokens = tokenize(line.text);
    this.startMeasure = Math.max(1, line.offset);
  }

  next({ tied }: { tied: boolean }): Lyric | null {
    while (this.index < this.tokens.length) {
      const token = this.tokens[this.index];
      if (!token) return null;
      if (token.kind === "syllable") {
        if (tied) return this.hold();
        this.index++;
        this.previous = token;
        this.lastSyllable = token.lyric;
        return token.lyric;
      }
      const previous = this.previous;
      this.index++;
      this.previous = token;
      if (previous?.kind === "space" && !previous.newline) {
        return previous.commentAdjacent || token.commentAdjacent ? null : this.hold();
      }
    }
    return tied ? this.hold() : null;
  }

  private hold(): Lyric | null {
    return this.lastSyllable && !this.lastSyllable.hyphen ? { kind: "hold" } : null;
  }
}
