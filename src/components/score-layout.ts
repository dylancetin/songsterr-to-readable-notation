import { noteLabel } from "../shared/model";
import type { AccidentalStyle, Beat, Lyric, Measure, ScoreNote, ScoreTrack } from "../shared/model";

export type Rhythm = { kind: "whole" } | { kind: "half" } | { kind: "stem"; flags: number };

export function rhythmFor(denominator: number): Rhythm {
  if (denominator <= 1) return { kind: "whole" };
  if (denominator <= 2) return { kind: "half" };
  return { kind: "stem", flags: Math.max(0, Math.ceil(Math.log2(denominator)) - 2) };
}

export function measureDuration(measure: Measure): number {
  return 4 * measure.timeSignature.beats / measure.timeSignature.unit;
}

export function sortedNotes(beat: Beat): ScoreNote[] {
  return beat.kind === "notes" ? [...beat.notes].sort((a, b) => b.midi - a.midi) : [];
}

export function pitchLabel(note: ScoreNote, transpose: number, accidentalStyle: AccidentalStyle): string {
  return note.kind === "pitch" ? noteLabel(note.midi + transpose, accidentalStyle) : note.label;
}

export type PlacedBeat = { beat: Beat; x: number; labelWidth: number; notes: ScoreNote[] };
export const chordStep = 28;

export function noteLabelY({ placed, noteIndex, laneLabelY }: {
  placed: PlacedBeat; noteIndex: number; laneLabelY: number;
}): number {
  return laneLabelY - (placed.notes.length - noteIndex - 1) * chordStep * (placed.beat.grace ? 0.75 : 1);
}
export type MeasureLayout = {
  measure: Measure;
  width: number;
  contentStart: number;
  contentEnd: number;
  showMeter: boolean;
  showFeel: boolean;
  positions: { time: number; x: number }[];
  voices: { beats: PlacedBeat[]; fullRest: boolean }[];
};

const epsilon = 0.00001;

function labelWidth(beat: Beat, transpose: number, accidentalStyle: AccidentalStyle): number {
  if (beat.kind === "rest") return 24;
  const width = Math.max(24, ...beat.notes.map((note) => {
    const label = pitchLabel(note, transpose, accidentalStyle);
    return note.kind === "pitch" ? label.length * 10 + 4 : label.length * 10;
  }));
  return (beat.grace ? width * 0.75 : width) + beat.dots * 6;
}

export function lyricWidth(lyric: Lyric | null): number {
  if (!lyric) return 0;
  return lyric.kind === "hold" ? 24 : Array.from(lyric.text).length * 8 + (lyric.hyphen ? 14 : 0) + 8;
}

export function layoutMeasure({ measure, previous, transpose, accidentalStyle, showLyrics = true }: {
  measure: Measure;
  previous?: Measure;
  transpose: number;
  accidentalStyle: AccidentalStyle;
  showLyrics?: boolean;
}): MeasureLayout {
  const beatWidth = (beat: Beat) => Math.max(labelWidth(beat, transpose, accidentalStyle),
    showLyrics && beat.kind === "notes" ? lyricWidth(beat.lyric) : 0);
  const showMeter = !previous || previous.timeSignature.beats !== measure.timeSignature.beats
    || previous.timeSignature.unit !== measure.timeSignature.unit;
  const showFeel = measure.tripletFeel !== null && (!previous || previous.tripletFeel !== measure.tripletFeel);
  const contentStart = showMeter ? 64 : measure.repeatStart ? 40 : 28;
  const endPadding = measure.repeatCount > 0 ? 32 : 24;
  const duration = measureDuration(measure);
  const times = [...new Set([0, ...measure.voices.flatMap((voice) => voice.beats.map((beat) => beat.start))])]
    .sort((a, b) => a - b);
  const positions: MeasureLayout["positions"] = [];
  const anchorWidths = new Map<number, number>();
  let cursor = contentStart;
  for (const [index, time] of times.entries()) {
    const atTime = measure.voices.map((voice) => voice.beats.filter((beat) => Math.abs(beat.start - time) < epsilon));
    const graceSpace = Math.max(0, ...atTime.map((beats) => beats.filter((beat) => beat.grace)
      .reduce((sum, beat) => sum + beatWidth(beat) + 12, 0)));
    const width = Math.max(24, ...atTime.flatMap((beats) => beats.filter((beat) => !beat.grace)
      .map(beatWidth)));
    const x = cursor + graceSpace + width / 2;
    positions.push({ time, x });
    anchorWidths.set(time, width);
    const nextTime = times[index + 1] ?? duration;
    cursor += Math.max(graceSpace + width + 22, Math.max(0, nextTime - time) / duration * 180);
  }
  const infoWidth = Math.max(
    (measure.marker?.length ?? 0) * 8 + 66,
    (measure.tripletFeel?.length ?? 0) * 7 + 44,
    measure.alternateEndings.join(", ").length * 8 + 66,
  );
  const width = Math.max(218, cursor + endPadding, infoWidth);
  const contentEnd = width - endPadding;
  const voices = measure.voices.map((voice) => {
    const graceOffsets = new Map<number, number>();
    const beats = voice.beats.map((beat): PlacedBeat => {
      const position = positions.find((item) => Math.abs(item.time - beat.start) < epsilon);
      let x = position?.x ?? contentStart;
      const width = labelWidth(beat, transpose, accidentalStyle);
      if (beat.grace) {
        const preceding = graceOffsets.get(beat.start) ?? (voice.beats.filter((item) => item.grace && item.start === beat.start)
          .reduce((sum, item) => sum + labelWidth(item, transpose, accidentalStyle) + 12, 0)
          + (anchorWidths.get(beat.start) ?? 24) / 2);
        x -= preceding - width / 2;
        graceOffsets.set(beat.start, preceding - width - 12);
      }
      return { beat, x, labelWidth: width, notes: sortedNotes(beat) };
    });
    const first = voice.beats[0];
    const fullRest = !first || (voice.beats.length === 1 && first.kind === "rest"
      && first.start < epsilon && first.duration >= duration - epsilon);
    return { beats, fullRest };
  });
  return { measure, width, contentStart, contentEnd, showMeter, showFeel, positions, voices };
}

export function xAtTime(layout: MeasureLayout, time: number): number {
  const first = layout.positions[0];
  if (!first) return layout.contentStart;
  if (time <= first.time) return first.x;
  for (const [index, left] of layout.positions.entries()) {
    const right = layout.positions[index + 1] ?? { time: measureDuration(layout.measure), x: layout.contentEnd };
    if (time <= right.time && right.time > left.time) {
      return left.x + (right.x - left.x) * (time - left.time) / (right.time - left.time);
    }
  }
  return layout.contentEnd;
}

function stretchMeasure(layout: MeasureLayout, width: number): MeasureLayout {
  const contentEnd = layout.contentEnd + width - layout.width;
  const ratio = (contentEnd - layout.contentStart) / (layout.contentEnd - layout.contentStart);
  const move = (x: number) => layout.contentStart + (x - layout.contentStart) * ratio;
  return {
    ...layout, width, contentEnd,
    positions: layout.positions.map((position) => ({ ...position, x: move(position.x) })),
    voices: layout.voices.map((voice) => ({
      ...voice, beats: voice.beats.map((beat) => ({ ...beat, x: move(beat.x) })),
    })),
  };
}

export function layoutSystems({ measures, availableWidth, maxMeasures }: {
  measures: MeasureLayout[];
  availableWidth: number;
  maxMeasures: number;
}): { measures: MeasureLayout[]; width: number }[] {
  const rows: MeasureLayout[][] = [];
  let row: MeasureLayout[] = [];
  let rowWidth = 0;
  for (const measure of measures) {
    if (row.length > 0 && (row.length >= maxMeasures || rowWidth + measure.width > availableWidth)) {
      rows.push(row);
      row = [];
      rowWidth = 0;
    }
    row.push(measure);
    rowWidth += measure.width;
  }
  if (row.length) rows.push(row);
  return rows.map((measures) => {
    const naturalWidth = measures.reduce((sum, measure) => sum + measure.width, 0);
    const width = Math.max(naturalWidth, Math.min(availableWidth, naturalWidth * 1.6));
    return {
      width,
      measures: measures.map((measure) => stretchMeasure(measure, measure.width * width / naturalWidth)),
    };
  });
}

export function beamGroups(beats: PlacedBeat[], measure: Measure): PlacedBeat[][] {
  const { beats: count, unit } = measure.timeSignature;
  const groupDuration = count > 3 && count % 3 === 0 && unit >= 8 ? 12 / unit : 4 / unit;
  const groups: PlacedBeat[][] = [];
  let group: PlacedBeat[] = [];
  let explicit = false;
  function flush() {
    if (group.length > 1) groups.push(group);
    group = [];
    explicit = false;
  }
  for (const placed of beats) {
    const { beat } = placed;
    const rhythm = rhythmFor(beat.denominator);
    if (beat.kind === "rest" || beat.grace || rhythm.kind !== "stem" || rhythm.flags === 0) {
      flush();
      continue;
    }
    const previous = group[group.length - 1];
    const crossesBeat = previous && Math.floor((previous.beat.start + epsilon) / groupDuration)
      !== Math.floor((beat.start + epsilon) / groupDuration);
    const hasGap = previous && Math.abs(previous.beat.start + previous.beat.duration - beat.start) > epsilon;
    if (beat.beamStart || hasGap || (!explicit && crossesBeat)) flush();
    if (beat.beamStart) explicit = true;
    group.push(placed);
    if (beat.beamStop) flush();
  }
  flush();
  return groups;
}

export function tupletGroups(beats: PlacedBeat[]): { count: number; beats: PlacedBeat[] }[] {
  const groups: ReturnType<typeof tupletGroups> = [];
  let group: PlacedBeat[] = [];
  let count = 0;
  let explicit = false;
  function flush() {
    if (group.length) {
      if (explicit) groups.push({ count, beats: group });
      else {
        const unit = Math.min(...group.map((placed) => 4 / placed.beat.denominator));
        const minimumSpan = count * unit;
        let span = minimumSpan;
        let writtenDuration = 0;
        let inferred: PlacedBeat[] = [];
        for (const placed of group) {
          inferred.push(placed);
          writtenDuration += 4 / placed.beat.denominator * (2 - 2 ** -placed.beat.dots);
          while (writtenDuration > span * (1 + epsilon)) span *= 2;
          if (writtenDuration >= span * (1 - epsilon)) {
            groups.push({ count, beats: inferred });
            inferred = [];
            writtenDuration = 0;
            span = minimumSpan;
          }
        }
        if (inferred.length) groups.push({ count, beats: inferred });
      }
    }
    group = [];
    explicit = false;
  }
  for (const placed of beats) {
    const value = placed.beat.tuplet;
    const previous = group[group.length - 1];
    if (value === null || value <= 1 || placed.beat.grace) {
      flush();
      count = 0;
      continue;
    }
    if (value !== count || placed.beat.tupletStart || (previous
      && Math.abs(previous.beat.start + previous.beat.duration - placed.beat.start) > epsilon)) flush();
    count = value;
    explicit ||= placed.beat.tupletStart || placed.beat.tupletStop;
    group.push(placed);
    if (placed.beat.tupletStop) flush();
  }
  flush();
  return groups;
}

type TieEndpoint = { measureIndex: number; voiceIndex: number; beatId: string; noteIndex: number };
export type TieLink = { from: TieEndpoint; to: TieEndpoint };

export function tieLinks(track: Pick<ScoreTrack, "measures">): TieLink[] {
  const links: TieLink[] = [];
  const previous = new Map<number, { measure: Measure; beat: Beat }>();
  for (const measure of track.measures) {
    for (const [voiceIndex, voice] of measure.voices.entries()) {
      for (const beat of voice.beats) {
        if (beat.grace) continue;
        const source = previous.get(voiceIndex);
        if (source && beat.kind === "notes" && source.beat.kind === "notes") {
          const adjacent = source.measure.index === measure.index
            ? Math.abs(source.beat.start + source.beat.duration - beat.start) < epsilon
            : measure.index === source.measure.index + 1 && beat.start < epsilon
              && Math.abs(source.beat.start + source.beat.duration - measureDuration(source.measure)) < epsilon;
          if (adjacent) {
            const sourceNotes = sortedNotes(source.beat);
            for (const [noteIndex, note] of sortedNotes(beat).entries()) {
              if (!note.tie) continue;
              const sourceIndex = sourceNotes.findIndex((candidate) => candidate.kind === note.kind && candidate.midi === note.midi);
              if (sourceIndex >= 0) links.push({
                from: { measureIndex: source.measure.index, voiceIndex, beatId: source.beat.id, noteIndex: sourceIndex },
                to: { measureIndex: measure.index, voiceIndex, beatId: beat.id, noteIndex },
              });
            }
          }
        }
        previous.set(voiceIndex, { measure, beat });
      }
      if (!voice.beats.some((beat) => !beat.grace)) previous.delete(voiceIndex);
    }
    for (const voiceIndex of previous.keys()) {
      if (voiceIndex >= measure.voices.length) previous.delete(voiceIndex);
    }
  }
  return links;
}

export type TieSegment = {
  link: TieLink;
  kind: "complete" | "outgoing" | "incoming";
  start: { x: number; y: number };
  end: { x: number; y: number };
  path: string;
};

export function layoutTieSegments({ links, measures, lanes, width }: {
  links: TieLink[];
  measures: { layout: MeasureLayout; x: number }[];
  lanes: { labelY: number }[];
  width: number;
}): TieSegment[] {
  const segments: TieSegment[] = [];
  for (const link of links) {
    const fromMeasure = measures.find((item) => item.layout.measure.index === link.from.measureIndex);
    const toMeasure = measures.find((item) => item.layout.measure.index === link.to.measureIndex);
    if (!fromMeasure && !toMeasure) continue;
    const from = fromMeasure?.layout.voices[link.from.voiceIndex]?.beats.find((item) => item.beat.id === link.from.beatId);
    const to = toMeasure?.layout.voices[link.to.voiceIndex]?.beats.find((item) => item.beat.id === link.to.beatId);
    const fromLane = lanes[link.from.voiceIndex];
    const toLane = lanes[link.to.voiceIndex];
    if ((fromMeasure && (!from || !fromLane)) || (toMeasure && (!to || !toLane))) continue;
    const fromY = from && fromLane ? noteLabelY({ placed: from, noteIndex: link.from.noteIndex, laneLabelY: fromLane.labelY }) + 7 : null;
    const toY = to && toLane ? noteLabelY({ placed: to, noteIndex: link.to.noteIndex, laneLabelY: toLane.labelY }) + 7 : null;
    const startY = fromY ?? toY;
    const endY = toY ?? fromY;
    if (startY === null || endY === null) continue;
    const start = { x: from && fromMeasure ? fromMeasure.x + from.x + from.labelWidth / 2 + 5 : 4, y: startY };
    const end = { x: to && toMeasure ? toMeasure.x + to.x - to.labelWidth / 2 - 5 : width - 4, y: endY };
    const distance = end.x - start.x;
    const depth = Math.min(9, Math.max(3, distance / 12));
    segments.push({
      link, kind: fromMeasure ? toMeasure ? "complete" : "outgoing" : "incoming", start, end,
      path: `M ${start.x} ${start.y} C ${start.x + distance / 3} ${start.y + depth}, ${end.x - distance / 3} ${end.y + depth}, ${end.x} ${end.y}`,
    });
  }
  return segments;
}

export function describeBeat(beat: Beat, transpose: number, accidentalStyle: AccidentalStyle, beatUnit = 4, showLyrics = true): string {
  const pitches = beat.kind === "rest" ? "Rest" : sortedNotes(beat)
    .map((note) => `${pitchLabel(note, transpose, accidentalStyle)}${note.tie ? ", tied" : ""}`).join(" and ");
  const rhythm = beat.denominator === 1 ? "whole" : beat.denominator === 2 ? "half"
    : beat.denominator === 4 ? "quarter" : beat.denominator === 8 ? "eighth"
      : beat.denominator === 16 ? "sixteenth" : `1/${beat.denominator}`;
  const lyric = showLyrics && beat.kind === "notes" ? beat.lyric : null;
  const words = lyric?.kind === "syllable" ? ` Lyric: ${lyric.text}${lyric.hyphen ? ", word continues" : ""}.`
    : lyric?.kind === "hold" ? " Continue the previous lyric syllable." : "";
  return `${beat.grace ? "Grace note. " : ""}${pitches}, ${rhythm}${beat.dots ? `, ${beat.dots} ${beat.dots === 1 ? "dot" : "dots"}` : ""}${beat.tuplet ? `, tuplet of ${beat.tuplet}` : ""}, at beat ${Number((beat.start * beatUnit / 4 + 1).toFixed(3))}.${words}`;
}
