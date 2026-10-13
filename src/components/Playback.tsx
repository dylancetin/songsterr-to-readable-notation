import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Pause, Play, Square, Volume2, VolumeX } from "lucide-react";
import { ScorePlayer } from "../audio/player";
import type { PlaybackState } from "../audio/player";
import { buildPlaybackTimeline, formatPlaybackTime, playbackMeasureAt } from "../audio/timeline";
import type { ScoreTrack } from "../shared/model";

type PlaybackProps = {
  track: ScoreTrack;
  transpose: number;
  seekMeasure: number | null;
  onMeasureChange: (measure: number | null) => void;
};

export function Playback({ track, transpose, seekMeasure, onMeasureChange }: PlaybackProps) {
  const timeline = useMemo(() => buildPlaybackTimeline(track), [track]);
  const player = useRef<ScorePlayer | null>(null);
  const [state, setState] = useState<PlaybackState>({ kind: "stopped", position: 0 });
  const [volume, setVolume] = useState(80);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  useEffect(() => {
    const current = new ScorePlayer(timeline, setState);
    current.setVolume(volumeRef.current / 100);
    player.current = current;
    setState({ kind: "stopped", position: 0 });
    return () => { current.dispose(); player.current = null; };
  }, [timeline]);
  useEffect(() => { player.current?.setTranspose(transpose); }, [transpose, timeline]);
  useEffect(() => { player.current?.setVolume(volume / 100); }, [volume]);
  useEffect(() => {
    if (seekMeasure === null) return;
    const measure = timeline.measures.find((item) => item.number === seekMeasure);
    if (measure) player.current?.seek(measure.start);
  }, [seekMeasure, timeline]);
  const measure = playbackMeasureAt(timeline, state.position);
  const activeMeasure = state.kind === "playing" || state.kind === "paused" ? measure?.number ?? null : null;
  useEffect(() => {
    onMeasureChange(activeMeasure);
    return () => onMeasureChange(null);
  }, [activeMeasure, onMeasureChange]);
  const playing = state.kind === "playing";
  const starting = state.kind === "starting";
  const hasNotes = timeline.notes.length > 0;
  const elapsed = formatPlaybackTime(state.position);
  const total = formatPlaybackTime(timeline.duration);

  return <div className="playback-controls" role="group" aria-label="Score playback">
    <div className="playback-transport">
      <button className="button playback-play" type="button" disabled={!hasNotes || starting}
        aria-label={playing ? "Pause playback" : state.kind === "paused" ? "Resume playback" : "Play selected part"}
        onClick={() => { if (playing) player.current?.pause(); else void player.current?.play(); }}>
        {starting ? <LoaderCircle className="spin" size={16} aria-hidden="true" />
          : playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        <span>{starting ? "Starting" : playing ? "Pause" : "Play"}</span>
      </button>
      <button className="icon-button playback-stop" type="button" aria-label="Stop playback" title="Stop and return to the beginning"
        disabled={state.kind === "stopped"} onClick={() => player.current?.stop()}>
        <Square size={14} aria-hidden="true" />
      </button>
    </div>
    <div className="playback-progress">
      <div className="playback-caption">
        <span>{hasNotes ? `Selected part, ${track.isPercussion ? "percussion" : "piano"} sound` : "This part has no notes"}</span>
        <output className="playback-time" aria-label="Playback time">{elapsed}<span> / {total}</span></output>
      </div>
      <input className="playback-seek" type="range" min="0" max={timeline.duration} step="0.01" value={state.position}
        aria-label="Playback position" aria-valuetext={`${elapsed} of ${total}, bar ${measure?.number ?? 1}`} disabled={!hasNotes}
        onChange={(event) => player.current?.seek(Number(event.target.value))} />
    </div>
    <span className="playback-bar">Bar {measure?.number ?? 1}<span> / {track.measures.at(-1)?.number ?? 1}</span></span>
    <label className="playback-volume">
      {volume === 0 ? <VolumeX size={17} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}
      <span className="sr-only">Playback volume</span>
      <input type="range" min="0" max="100" step="1" value={volume} aria-valuetext={`${volume}%`}
        onChange={(event) => setVolume(Number(event.target.value))} />
    </label>
    {state.kind === "error" && <p className="playback-error" role="alert">{state.message}</p>}
  </div>;
}
