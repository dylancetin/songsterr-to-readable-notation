import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { noteParts } from "../shared/model";
import type { AccidentalStyle, Lyric, Measure, ScoreNote, ScoreTrack } from "../shared/model";
import {
  beamGroups, chordStep, describeBeat, layoutMeasure, layoutSystems, layoutTieSegments, noteLabelY,
  rhythmFor, tieLinks, tupletGroups, xAtTime,
} from "./score-layout";
import type { MeasureLayout, PlacedBeat } from "./score-layout";

export type ScoreProps = {
  track: ScoreTrack;
  transpose: number;
  accidentalStyle: AccidentalStyle;
  zoom: number;
  focusMeasure: number | null;
  showLyrics: boolean;
  playbackMeasure?: number | null;
};

const ink = "#2966a2";
const rhythmInk = "#263746";
const guideInk = "#e5ebf0";
const mutedInk = "#7e8d9b";
const stemLength = 40;

type Lane = { top: number; labelY: number; lyricY: number | null; bottom: number };

function RestGlyph({ denominator, fullBar = false, x, y }: {
  denominator: number; fullBar?: boolean; x: number; y: number;
}) {
  if (fullBar || denominator <= 2) {
    const whole = fullBar || denominator <= 1;
    return <g transform={`translate(${x} ${y})`} aria-hidden="true">
      <path d={`M -10 0 H 10 M -6 ${whole ? 0 : -5} H 6 V ${whole ? 5 : 0} H -6 Z`}
        fill={rhythmInk} stroke={rhythmInk} strokeWidth="1.3" />
    </g>;
  }
  if (denominator < 8) return <path aria-hidden="true" transform={`translate(${x} ${y})`}
    d="M -2 -15 L 5 -8 L 0 -1 L 5 6 Q -5 3 -4 10 L -1 15 Q -10 10 -6 3 L -1 0 L -6 -7 L -1 -11 Z"
    fill={rhythmInk} />;
  const rhythm = rhythmFor(denominator);
  const flags = rhythm.kind === "stem" ? rhythm.flags : 1;
  return <g aria-hidden="true" transform={`translate(${x} ${y - (flags - 1) * 4})`}>
    <path d={`M 5 -11 L ${-2 - (flags - 1) * 2} ${12 + (flags - 1) * 8}`}
      stroke={rhythmInk} strokeWidth="1.7" />
    {Array.from({ length: flags }, (_, index) => <path key={index}
      d={`M ${5 - index * 2} ${-10 + index * 8} Q ${index * -2} ${-3 + index * 8} ${-5 - index * 2} ${-7 + index * 8}`}
      fill="none" stroke={rhythmInk} strokeWidth="2.5" strokeLinecap="round" />)}
    {Array.from({ length: flags }, (_, index) => <circle key={index}
      cx={-5 - index * 2} cy={-8 + index * 8} r="2.5" fill={rhythmInk} />)}
  </g>;
}

function Pitch({ note, x, y, transpose, accidentalStyle, grace }: {
  note: ScoreNote; x: number; y: number; transpose: number; accidentalStyle: AccidentalStyle; grace: boolean;
}) {
  if (note.kind === "percussion") return <text x={x} y={y} fill={ink}
    fontSize={grace ? 13 : 17} fontWeight="600" textAnchor="middle">{note.label}</text>;
  const { name, octave } = noteParts(note.midi + transpose, accidentalStyle);
  return <text x={x} y={y} fill={ink} fontSize={grace ? 13.5 : 18}
    fontWeight="650" textAnchor="middle">
    {name}<tspan fontSize={grace ? 8 : 11} dy={grace ? 3 : 4} fontWeight="550">{octave}</tspan>
  </text>;
}

function BeatNotation({ placed, lane, beamed, transpose, accidentalStyle, beatUnit }: {
  placed: PlacedBeat; lane: Lane; beamed: boolean; transpose: number; accidentalStyle: AccidentalStyle; beatUnit: number;
}) {
  const { beat, x, notes } = placed;
  const rhythm = rhythmFor(beat.denominator);
  const scale = beat.grace ? 0.75 : 1;
  const stemX = x + 4 * scale;
  const y = lane.labelY;
  const stemBottom = y + stemLength * scale + 7;
  const description = describeBeat(beat, transpose, accidentalStyle, beatUnit, lane.lyricY !== null);
  return <g className="score-beat" data-beat={beat.id} role="img" aria-label={description}>
    <title>{description}</title>
    <g aria-hidden="true">
      {beat.kind === "rest" ? <RestGlyph denominator={beat.denominator} x={x} y={y + 23} />
        : <>
          {notes.map((note, index) => <Pitch key={`${note.kind}-${note.midi}-${index}`}
            note={note} x={x} y={noteLabelY({ placed, noteIndex: index, laneLabelY: y })}
            transpose={transpose} accidentalStyle={accidentalStyle} grace={beat.grace} />)}
          {rhythm.kind === "whole" ? <ellipse cx={x} cy={y + 13 * scale} rx={7 * scale} ry={4 * scale}
            fill="none" stroke={rhythmInk} strokeWidth="1.7" />
            : <>
              {rhythm.kind === "half" && <circle cx={x} cy={y + 11 * scale} r={4.5 * scale}
                fill="none" stroke={rhythmInk} strokeWidth="1.6" />}
              <path d={`M ${stemX} ${y + (rhythm.kind === "half" ? 12 : 7) * scale} V ${stemBottom}`}
                stroke={rhythmInk} strokeWidth="1.6" />
              {rhythm.kind === "stem" && !beamed && Array.from({ length: rhythm.flags }, (_, index) => {
                const flagY = stemBottom - index * 8 * scale;
                return <path key={index}
                  d={`M ${stemX} ${flagY} C ${stemX - 2 * scale} ${flagY - 8 * scale}, ${stemX - 13 * scale} ${flagY - 7 * scale}, ${stemX - 9 * scale} ${flagY - 21 * scale} C ${stemX - 17 * scale} ${flagY - 8 * scale}, ${stemX - 3 * scale} ${flagY - 5 * scale}, ${stemX} ${flagY - 3 * scale} Z`}
                  fill={rhythmInk} />;
              })}
              {beat.grace && <path d={`M ${stemX - 7} ${stemBottom - 8} l 14 -12`}
                stroke={rhythmInk} strokeWidth="1.3" />}
            </>}
        </>}
      {Array.from({ length: beat.dots }, (_, index) => <circle key={index}
        cx={x + (beat.kind === "rest" ? 14 : 13) + index * 6} cy={y + (beat.kind === "rest" ? 22 : 12)}
        r="1.8" fill={rhythmInk} />)}
      {beat.kind === "notes" && beat.lyric && lane.lyricY !== null &&
        <BeatLyric lyric={beat.lyric} x={x} y={lane.lyricY} beatId={beat.id} />}
    </g>
  </g>;
}

function BeatLyric({ lyric, x, y, beatId }: { lyric: Lyric; x: number; y: number; beatId: string }) {
  if (lyric.kind === "hold") return <path className="score-lyric lyric-hold" data-lyric-beat={beatId}
    d={`M ${x - 10} ${y + 3} H ${x + 10}`} stroke={mutedInk} strokeWidth="1" />;
  return <g className="score-lyric lyric-syllable" data-lyric-beat={beatId}>
    <text x={x} y={y} textAnchor="middle" fontSize="13.5" fill={rhythmInk}>{lyric.text}</text>
    {lyric.hyphen && <text x={x + Array.from(lyric.text).length * 4 + 8} y={y}
      textAnchor="middle" fontSize="13.5" fill={mutedInk}>-</text>}
  </g>;
}

function Beams({ groups, lane }: { groups: PlacedBeat[][]; lane: Lane }) {
  return <g aria-hidden="true" fill={rhythmInk}>
    {groups.map((group) => {
      const levels = Math.max(...group.map((placed) => {
        const rhythm = rhythmFor(placed.beat.denominator);
        return rhythm.kind === "stem" ? rhythm.flags : 0;
      }));
      const flagsAt = (index: number) => {
        const placed = group[index];
        if (!placed) return 0;
        const rhythm = rhythmFor(placed.beat.denominator);
        return rhythm.kind === "stem" ? rhythm.flags : 0;
      };
      return Array.from({ length: levels }, (_, level) => group.map((placed, index) => {
        if (flagsAt(index) <= level) return null;
        const next = group[index + 1];
        const previous = group[index - 1];
        let toX: number;
        if (next && flagsAt(index + 1) > level) toX = next.x + 4;
        else if (previous && flagsAt(index - 1) > level) return null;
        else if (next) toX = placed.x + 4 + Math.min(12, (next.x - placed.x) / 2);
        else if (previous) toX = placed.x + 4 - Math.min(12, (placed.x - previous.x) / 2);
        else return null;
        const y = lane.labelY + stemLength + 7 - level * 8;
        return <path key={`${placed.beat.id}-${level}`} d={`M ${placed.x + 4} ${y - 2} H ${toX} V ${y + 2} H ${placed.x + 4} Z`} />;
      }));
    })}
  </g>;
}

function Tuplets({ beats, lane }: { beats: PlacedBeat[]; lane: Lane }) {
  return <g aria-hidden="true" fill={rhythmInk}>
    {tupletGroups(beats).map((group) => {
      const first = group.beats[0];
      const last = group.beats[group.beats.length - 1];
      if (!first || !last) return null;
      const left = first.x - 12;
      const right = last.x + 12;
      const center = (left + right) / 2;
      const y = lane.top + 6;
      return <g key={first.beat.id} className="score-tuplet"
        data-from-beat={first.beat.id} data-to-beat={last.beat.id} data-count={group.count}>
        <path d={`M ${left} ${y + 5} V ${y} H ${center - 9} M ${center + 9} ${y} H ${right} V ${y + 5}`}
          fill="none" stroke={rhythmInk} strokeWidth="1" />
        <text x={center} y={y + 4} fontSize="12" fontWeight="650" textAnchor="middle">{group.count}</text>
      </g>;
    })}
  </g>;
}

function measureDescription(measure: Measure): string {
  return `Measure ${measure.number}, ${measure.timeSignature.beats}/${measure.timeSignature.unit}. ${measure.marker ? `${measure.marker}. ` : ""}${measure.repeatStart ? "Repeat starts. " : ""}${measure.repeatCount ? `Repeat ${measure.repeatCount} times. ` : ""}${measure.alternateEndings.length ? `Ending ${measure.alternateEndings.join(", ")}. ` : ""}${measure.tripletFeel ? `${measure.tripletFeel}. ` : ""}${measure.voices.length} ${measure.voices.length === 1 ? "voice" : "voices"}.`;
}

function MeasureNotation({ layout, lanes, transpose, accidentalStyle, final, playing }: {
  layout: MeasureLayout; lanes: Lane[]; transpose: number; accidentalStyle: AccidentalStyle; final: boolean; playing: boolean;
}) {
  const { measure, width } = layout;
  const bottom = lanes[lanes.length - 1]?.bottom ?? 180;
  return <g id={`measure-${measure.number}`} className="score-measure" data-measure={measure.number} data-playing={playing || undefined}
    role="group" aria-label={measureDescription(measure)}>
    <title>{measureDescription(measure)}</title>
    {playing && <rect className="playback-measure-highlight" x="1" y="1" width={width - 3} height={bottom + 5} rx="5" aria-hidden="true" />}
    <g aria-hidden="true">
      <text x="10" y="22" fontSize="12" fill={mutedInk}>{measure.number}</text>
      {measure.marker && <text x="40" y="22" fontSize="14" fontWeight="650" fill={rhythmInk}>{measure.marker}</text>}
      {layout.showFeel && <text x="10" y="43" fontSize="11" fill={mutedInk}>
        {measure.tripletFeel === "8th" ? "Swing eighths" : measure.tripletFeel === "16th" ? "Swing sixteenths" : measure.tripletFeel === "off" ? "Straight" : measure.tripletFeel}
      </text>}
      {measure.alternateEndings.length > 0 && <>
        <path d={`M ${layout.contentStart} 43 V 32 H ${width - 12}`} fill="none" stroke={mutedInk} strokeWidth="1" />
        <text x={layout.contentStart + 5} y="44" fontSize="11" fill={rhythmInk}>{measure.alternateEndings.join(", ")}.</text>
      </>}
      {measure.repeatCount > 0 && <text x={width - 12} y="43" textAnchor="end" fontSize="10" fill={mutedInk}>
        ×{measure.repeatCount}
      </text>}
      <path d={`M ${width - 1} 54 V ${bottom - 17}`} stroke={final || measure.repeatCount ? rhythmInk : "#bdcbd6"}
        strokeWidth={final || measure.repeatCount ? 2.4 : 1} />
      {(final || measure.repeatCount > 0) && <path d={`M ${width - 7} 54 V ${bottom - 17}`}
        stroke={rhythmInk} strokeWidth="1" />}
      {measure.repeatStart && <path d={`M 7 54 V ${bottom - 17} M 13 54 V ${bottom - 17}`}
        stroke={rhythmInk} strokeWidth="1.7" />}
    </g>
    {layout.voices.map((voice, voiceIndex) => {
      const lane = lanes[voiceIndex];
      if (!lane) return null;
      const groups = beamGroups(voice.beats, measure);
      const beamed = new Set(groups.flatMap((group) => group.map((placed) => placed.beat.id)));
      const beats = measure.timeSignature.beats;
      const centered = (layout.contentStart + layout.contentEnd) / 2;
      return <g key={voiceIndex} className="score-voice" role="group" aria-label={`Voice ${voiceIndex + 1}`}>
        <g aria-hidden="true">
          {lanes.length > 1 && <text x={measure.repeatStart ? 24 : 9} y={lane.top + 18}
            fill={mutedInk} fontSize="9">v{voiceIndex + 1}</text>}
          {!voice.fullRest && Array.from({ length: beats }, (_, index) => {
            const x = xAtTime(layout, index * 4 / measure.timeSignature.unit);
            return <g key={index}>
              <path d={`M ${x} ${lane.labelY + 18} V ${lane.labelY + 48}`} stroke={guideInk} strokeWidth="1" />
              <text x={x} y={lane.bottom - 4} textAnchor="middle" fontSize="10" fill={mutedInk}>{index + 1}</text>
            </g>;
          })}
          {measure.repeatStart && <>
            <circle cx="20" cy={lane.labelY + 18} r="2" fill={rhythmInk} />
            <circle cx="20" cy={lane.labelY + 29} r="2" fill={rhythmInk} />
          </>}
          {measure.repeatCount > 0 && <>
            <circle cx={width - 15} cy={lane.labelY + 18} r="2" fill={rhythmInk} />
            <circle cx={width - 15} cy={lane.labelY + 29} r="2" fill={rhythmInk} />
          </>}
          {layout.showMeter && voiceIndex === 0 && <text x={measure.repeatStart ? 42 : 27} y={lane.labelY + 5}
            fontSize="17" fontWeight="600" textAnchor="middle" fill={rhythmInk}>
            <tspan x={measure.repeatStart ? 42 : 27}>{beats}</tspan>
            <tspan x={measure.repeatStart ? 42 : 27} dy="19">{measure.timeSignature.unit}</tspan>
          </text>}
        </g>
        {voice.fullRest ? <g role="img" aria-label={`Full measure rest, no notes, ${beats}/${measure.timeSignature.unit}`}>
          <title>Full measure rest. No notes.</title>
          <text aria-hidden="true" x={centered} y={lane.labelY} textAnchor="middle" fontSize="12" fill={mutedInk}>No notes</text>
          <RestGlyph denominator={1} fullBar x={centered} y={lane.labelY + 23} />
        </g> : <>
          <Tuplets beats={voice.beats} lane={lane} />
          {voice.beats.map((placed) => <BeatNotation key={placed.beat.id} placed={placed} lane={lane}
            beamed={beamed.has(placed.beat.id)} transpose={transpose} accidentalStyle={accidentalStyle}
            beatUnit={measure.timeSignature.unit} />)}
          <Beams groups={groups} lane={lane} />
        </>}
      </g>;
    })}
  </g>;
}

function SystemTies(props: Parameters<typeof layoutTieSegments>[0]) {
  return <g className="score-ties" aria-hidden="true" fill="none" stroke={ink} strokeWidth="1.2">
    {layoutTieSegments(props).map(({ link, kind, path }) => <path
      key={`${link.from.beatId}-${link.to.beatId}-${link.to.noteIndex}`}
      data-from-beat={link.from.beatId} data-to-beat={link.to.beatId} data-tie-kind={kind}
      d={path} />)}
  </g>;
}

export function Score({ track, transpose, accidentalStyle, zoom, focusMeasure, showLyrics, playbackMeasure = null }: ScoreProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);
  const [printing, setPrinting] = useState(() => typeof window !== "undefined" && window.matchMedia("print").matches);
  const printingRef = useRef(printing);
  const scale = printing ? 1 : Number.isFinite(zoom) && zoom > 0 ? zoom / 100 : 1;
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const update = () => {
      if (!printingRef.current) setWidth(sheet.clientWidth || 1100);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const media = window.matchMedia("print");
    const changeMode = (print: boolean) => {
      printingRef.current = print;
      flushSync(() => setPrinting(print));
    };
    const beforePrint = () => changeMode(true);
    const afterPrint = () => changeMode(false);
    const mediaChanged = (event: MediaQueryListEvent) => changeMode(event.matches);
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    media.addEventListener("change", mediaChanged);
    printingRef.current = media.matches;
    setPrinting(media.matches);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
      media.removeEventListener("change", mediaChanged);
    };
  }, []);
  const measures = useMemo(() => track.measures.map((measure, index) => layoutMeasure({
    measure, previous: track.measures[index - 1], transpose, accidentalStyle, showLyrics,
  })), [track, transpose, accidentalStyle, showLyrics]);
  const links = useMemo(() => tieLinks(track), [track]);
  const systems = useMemo(() => layoutSystems({
    measures, availableWidth: printing ? 1000 : width / scale,
    maxMeasures: printing ? 4 : width >= 1000 ? 4 : width >= 620 ? 2 : 1,
  }), [measures, width, scale, printing]);
  useEffect(() => {
    if (focusMeasure === null) return;
    const measure = sheetRef.current?.querySelector(`#measure-${focusMeasure}`);
    measure?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center", inline: "center",
    });
  }, [focusMeasure, track]);

  return <div ref={sheetRef} className="score-sheet" data-layout={printing ? "print" : "screen"}
    aria-label={`${track.name} letter-note score`}
    style={{ minWidth: 0, width: "100%" }}>
    {systems.map((system, systemIndex) => {
      const voiceCount = Math.max(...system.measures.map((layout) => layout.voices.length));
      let top = 60;
      const lanes: Lane[] = Array.from({ length: voiceCount }, (_, voiceIndex) => {
        const chordSize = Math.max(1, ...system.measures.flatMap((layout) =>
          layout.voices[voiceIndex]?.beats.map((placed) => placed.notes.length) ?? []));
        const labelY = top + 40 + (chordSize - 1) * chordStep;
        const hasLyrics = showLyrics && system.measures.some((layout) => layout.voices[voiceIndex]?.beats
          .some(({ beat }) => beat.kind === "notes" && beat.lyric !== null));
        const lane = { top, labelY, lyricY: hasLyrics ? labelY + 80 : null,
          bottom: labelY + 88 + chordSize * 5 + (hasLyrics ? 27 : 0) };
        top = lane.bottom + 18;
        return lane;
      });
      let x = 0;
      const placedMeasures = system.measures.map((layout) => {
        const placed = { layout, x };
        x += layout.width;
        return placed;
      });
      const first = system.measures[0];
      const last = system.measures[system.measures.length - 1];
      const height = (lanes[lanes.length - 1]?.bottom ?? 180) + 10;
      return <div key={first?.measure.number ?? systemIndex} className="score-system"
        style={{ overflowX: "auto", overflowY: "hidden", marginBottom: 18 * scale }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${system.width} ${height}`}
          width={system.width * scale} height={height * scale} role="group"
          aria-label={`Measures ${first?.measure.number ?? 1} to ${last?.measure.number ?? 1}`}
          style={{ display: "block", fontFamily: "Manrope, sans-serif", flexShrink: 0 }}>
          {placedMeasures.map(({ layout, x }) => <g key={layout.measure.number} transform={`translate(${x} 0)`}>
            <MeasureNotation layout={layout} lanes={lanes} transpose={transpose} accidentalStyle={accidentalStyle}
              final={systemIndex === systems.length - 1 && layout === last} playing={!printing && playbackMeasure === layout.measure.number} />
          </g>)}
          <SystemTies links={links} measures={placedMeasures} lanes={lanes} width={system.width} />
        </svg>
      </div>;
    })}
  </div>;
}
