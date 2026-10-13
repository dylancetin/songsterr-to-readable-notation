import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Drum,
  ExternalLink,
  ListMusic,
  LoaderCircle,
  MapPin,
  MessageSquareText,
  Mic2,
  Minus,
  Music2,
  Plus,
  Printer,
  Search,
  X,
} from "lucide-react";
import { z } from "zod";
import { Score } from "./components/Score";
import { Playback } from "./components/Playback";
import { EXAMPLE_URL, importResultSchema, noteLabel } from "./shared/model";
import type { ImportResult, ScoreTrack, TrackSummary } from "./shared/model";
import { createReaderUrl, DEFAULT_READER_SETTINGS, readReaderLocation, sourceUrlSchema } from "./shared/reader-location";
import type { ReaderLocation, ReaderSettings, ScoreReaderLocation, SourceUrl } from "./shared/reader-location";

const apiErrorSchema = z.object({ error: z.string().min(1) });
type ImportIntent =
  | { kind: "song"; url: SourceUrl }
  | { kind: "track"; url: string; partId: TrackSummary["id"]; name: string }
  | { kind: "restore"; location: ScoreReaderLocation };
type LoadState =
  | { kind: "idle" }
  | { kind: "loading"; request: ImportIntent }
  | { kind: "error"; message: string; retry: ImportIntent | null };
type TrackFilter = "all" | "vocals";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function transposeDescription(transpose: number) {
  if (transpose === 0) return "Original pitch";
  const amount = Math.abs(transpose);
  return `Transposed ${transpose > 0 ? "up" : "down"} ${amount} ${amount === 1 ? "semitone" : "semitones"}`;
}

function firstNoteMeasure(track: ScoreTrack) {
  return track.measures.find((measure) =>
    measure.voices.some((voice) => voice.beats.some((beat) => beat.kind === "notes")),
  );
}

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 38 38" aria-hidden="true">
      <path d="M5 27h28M5 19h28M5 11h28" className="brand-lines" />
      <path d="M24 7v18" className="brand-stem" />
      <ellipse cx="19" cy="26" rx="5.5" ry="3.8" transform="rotate(-22 19 26)" />
    </svg>
  );
}

function RhythmMark({ flagged = false }: { flagged?: boolean }) {
  return (
    <svg className="rhythm-mark" viewBox="0 0 22 30" aria-hidden="true">
      <ellipse cx="7" cy="24" rx="5" ry="3.2" transform="rotate(-22 7 24)" fill="currentColor" />
      <path d="M11 23V3" fill="none" stroke="currentColor" strokeWidth="1.7" />
      {flagged && <path d="M11 3c1 6 10 6 5 15 1-7-4-5-5-9" fill="currentColor" />}
    </svg>
  );
}

function NotationSample() {
  return (
    <figure className="notation-sample">
      <figcaption>Notation sample</figcaption>
      <svg
        viewBox="0 0 390 126"
        role="img"
        aria-label="Sample notation: D4 quarter note, C sharp 4 eighth note, D4 eighth note."
      >
        <path d="M26 20v92M364 20v92" className="sample-barline" />
        <path d="M92 63v40M208 63v40M303 63v40" className="sample-stem" />
        <path d="M208 101h95v4h-95z" className="sample-beam" />
        <text x="88" y="56">D<tspan className="sample-octave" dy="4">4</tspan></text>
        <text x="204" y="56">C♯<tspan className="sample-octave" dy="4">4</tspan></text>
        <text x="299" y="56">D<tspan className="sample-octave" dy="4">4</tspan></text>
      </svg>
      <p>Letters give the pitch. Stems and beams keep the rhythm.</p>
    </figure>
  );
}

function TrackIcon({ track }: { track: TrackSummary }) {
  if (track.isVocal) return <Mic2 size={17} aria-hidden="true" />;
  if (track.isPercussion) return <Drum size={17} aria-hidden="true" />;
  return <Music2 size={17} aria-hidden="true" />;
}

export default function App() {
  const [initialLocation] = useState(() => readReaderLocation(new URL(window.location.href)));
  const [urlInput, setUrlInput] = useState(initialLocation.kind === "score" ? initialLocation.url : EXAMPLE_URL);
  const [document, setDocument] = useState<ImportResult | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ kind: "idle" });
  const [trackFilter, setTrackFilter] = useState<TrackFilter>("all");
  const [trackSearch, setTrackSearch] = useState("");
  const [tracksOpen, setTracksOpen] = useState(false);
  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(
    initialLocation.kind === "score" ? initialLocation.settings : DEFAULT_READER_SETTINGS,
  );
  const { transpose, accidentalStyle, zoom, showLyrics } = readerSettings;
  const [measureInput, setMeasureInput] = useState("1");
  const [measureError, setMeasureError] = useState<string | null>(null);
  const [focusMeasure, setFocusMeasure] = useState<number | null>(null);
  const [playbackMeasure, setPlaybackMeasure] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpSection = useRef<HTMLElement | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const jumpFrame = useRef<number | null>(null);
  const urlHistoryMode = useRef<"push" | "replace">("replace");

  useEffect(() => {
    restoreLocation(initialLocation);
    return () => {
      activeRequest.current?.abort();
      if (jumpFrame.current !== null) window.cancelAnimationFrame(jumpFrame.current);
    };
  }, []);

  useEffect(() => {
    const restoreFromUrl = () => restoreLocation(readReaderLocation(new URL(window.location.href)));
    window.addEventListener("popstate", restoreFromUrl);
    return () => window.removeEventListener("popstate", restoreFromUrl);
  }, [document]);

  useEffect(() => {
    const request = loadState.kind === "loading" ? loadState.request : loadState.kind === "error" ? loadState.retry : null;
    if (!document || request?.kind === "restore") return;
    const url = createReaderUrl({
      currentUrl: new URL(window.location.href),
      sourceUrl: document.song.sourceUrl,
      trackId: document.track.id,
      settings: readerSettings,
    });
    if (url.href !== window.location.href) {
      if (urlHistoryMode.current === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    }
    urlHistoryMode.current = "replace";
  }, [document, readerSettings, loadState]);

  useEffect(() => {
    if (!helpOpen) return;
    helpSection.current?.scrollIntoView({
      block: "nearest",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [helpOpen]);

  async function importScore(request: ImportIntent) {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoadState({ kind: "loading", request });
    setMeasureError(null);

    try {
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          request.kind === "restore"
            ? { url: request.location.url, ...(request.location.trackId !== null ? { partId: request.location.trackId } : {}) }
            : request.kind === "track" ? { url: request.url, partId: request.partId } : { url: request.url },
        ),
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (controller.signal.aborted || activeRequest.current !== controller) return;

      const serverError = apiErrorSchema.safeParse(body);
      if (serverError.success) {
        setLoadState({ kind: "error", message: serverError.data.error, retry: request });
        return;
      }
      if (!response.ok) {
        setLoadState({
          kind: "error",
          message: "The import service could not read this song. Try again, or paste another Songsterr link.",
          retry: request,
        });
        return;
      }

      const result = importResultSchema.safeParse(body);
      if (!result.success) {
        setLoadState({
          kind: "error",
          message: "The song arrived with incomplete score data. Try importing it again.",
          retry: request,
        });
        return;
      }

      urlHistoryMode.current = request.kind === "restore" ? "replace" : "push";
      setDocument(result.data);
      setLoadState({ kind: "idle" });
      if (request.kind === "restore") {
        restoreSettings(request.location.settings, result.data.track);
      } else {
        setReaderSettings((settings) => ({
          ...settings,
          transpose: request.kind === "song" ? 0 : settings.transpose,
          bar: null,
        }));
        resetMeasurePosition(result.data.track);
      }
      setTracksOpen(false);
      if (request.kind !== "track") {
        setTrackSearch("");
        setTrackFilter("all");
      }
    } catch (error: unknown) {
      if (controller.signal.aborted || activeRequest.current !== controller) return;
      setLoadState({
        kind: "error",
        message:
          error instanceof SyntaxError
            ? "The import service returned an unreadable response. Try importing the song again."
            : "Could not reach the import service. Check your connection and try again.",
        retry: request,
      });
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }

  function resetMeasurePosition(track: ScoreTrack) {
    if (jumpFrame.current !== null) window.cancelAnimationFrame(jumpFrame.current);
    jumpFrame.current = null;
    setFocusMeasure(null);
    setMeasureInput(String(track.measures[0]?.number ?? 1));
  }

  function restoreSettings(settings: ReaderSettings, track: ScoreTrack) {
    const bar = track.measures.find((measure) => measure.number === settings.bar)?.number ?? null;
    setReaderSettings({ ...settings, bar });
    resetMeasurePosition(track);
    if (bar !== null) jumpToMeasure(bar);
  }

  function restoreLocation(location: ReaderLocation) {
    activeRequest.current?.abort();
    activeRequest.current = null;
    urlHistoryMode.current = "replace";
    setMeasureError(null);
    setTracksOpen(false);
    setTrackSearch("");
    setTrackFilter("all");
    if (location.kind === "empty") {
      if (jumpFrame.current !== null) window.cancelAnimationFrame(jumpFrame.current);
      jumpFrame.current = null;
      setDocument(null);
      setLoadState({ kind: "idle" });
      setUrlInput(EXAMPLE_URL);
      setReaderSettings(DEFAULT_READER_SETTINGS);
      setFocusMeasure(null);
      setMeasureInput("1");
      return;
    }
    setUrlInput(location.url);
    if (document?.song.sourceUrl === location.url && location.trackId === document.track.id) {
      setLoadState({ kind: "idle" });
      restoreSettings(location.settings, document.track);
      return;
    }
    void importScore({ kind: "restore", location });
  }

  function submitUrl(value: string) {
    const result = sourceUrlSchema.safeParse(value);
    if (!result.success) {
      activeRequest.current?.abort();
      activeRequest.current = null;
      setLoadState({
        kind: "error",
        message: result.error.issues[0]?.message ?? "Paste a complete Songsterr song link.",
        retry: null,
      });
      return;
    }
    setUrlInput(result.data);
    void importScore({ kind: "song", url: result.data });
  }

  function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitUrl(urlInput);
  }

  function selectTrack(track: TrackSummary) {
    if (!document) return;
    if (track.id === document.track.id) {
      activeRequest.current?.abort();
      activeRequest.current = null;
      setLoadState({ kind: "idle" });
      setTracksOpen(false);
      return;
    }
    if (
      loadState.kind === "loading" &&
      loadState.request.kind === "track" &&
      loadState.request.partId === track.id
    ) {
      setTracksOpen(false);
      return;
    }
    setTracksOpen(false);
    void importScore({ kind: "track", url: document.song.sourceUrl, partId: track.id, name: track.name });
  }

  function jumpToMeasure(number: number) {
    if (jumpFrame.current !== null) window.cancelAnimationFrame(jumpFrame.current);
    setMeasureInput(String(number));
    setMeasureError(null);
    setReaderSettings((settings) => ({ ...settings, bar: number }));
    setFocusMeasure(null);
    jumpFrame.current = window.requestAnimationFrame(() => {
      setFocusMeasure(number);
      jumpFrame.current = null;
    });
  }

  function handleMeasureJump(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!document) return;
    const number = Number(measureInput);
    const measure = document.track.measures.find((item) => item.number === number);
    if (!Number.isInteger(number) || !measure) {
      const first = document.track.measures[0]?.number ?? 1;
      const last = document.track.measures.at(-1)?.number ?? first;
      setMeasureError(`Enter a bar number from ${first} to ${last}.`);
      return;
    }
    jumpToMeasure(measure.number);
  }

  const isImporting = loadState.kind === "loading" && loadState.request.kind !== "track";
  const inputHasError = loadState.kind === "error" && loadState.retry === null;
  const search = trackSearch.trim().toLocaleLowerCase();
  const tracks = document?.song.tracks ?? [];
  const visibleTracks = tracks.filter(
    (track) =>
      (trackFilter === "all" || track.isVocal) &&
      `${track.name} ${track.instrument} ${track.isVocal ? "voice vocals" : ""}`
        .toLocaleLowerCase()
        .includes(search),
  );
  const firstNote = document ? firstNoteMeasure(document.track) : undefined;
  const timeSignatures = document
    ? [...new Set(document.track.measures.map((measure) => `${measure.timeSignature.beats}/${measure.timeSignature.unit}`))]
    : [];
  const tempo = document?.track.tempos[0];
  const hasLyrics = document?.track.measures.some((measure) => measure.voices.some((voice) =>
    voice.beats.some((beat) => beat.kind === "notes" && beat.lyric?.kind === "syllable"))) ?? false;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#score-page">Skip to score</a>
      <header className="app-header">
        <a className="brand" href="#" aria-label="Note / line home">
          <BrandMark />
          <span>Note <span className="brand-slash">/</span> line</span>
        </a>
        <form className="import-form" onSubmit={handleImport} noValidate>
          <label className="sr-only" htmlFor="song-url">Songsterr song URL</label>
          <div className={`url-field${inputHasError ? " has-error" : ""}`}>
            <Music2 size={17} aria-hidden="true" />
            <input
              id="song-url"
              type="url"
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
              placeholder="Paste a Songsterr song link"
              autoComplete="url"
              spellCheck={false}
              aria-invalid={inputHasError}
              aria-describedby={inputHasError ? "import-error" : "url-hint"}
            />
          </div>
          <button className="button button-primary import-button" type="submit" disabled={isImporting}>
            {isImporting ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}
            <span>{isImporting ? "Importing" : "Import song"}</span>
          </button>
        </form>
        <span id="url-hint" className="header-hint">A Songsterr link to readable notes</span>
      </header>

      {loadState.kind === "loading" && (
        <div className="feedback-bar loading-feedback" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={16} aria-hidden="true" />
          <span>
            {loadState.request.kind === "track"
              ? `Loading ${loadState.request.name}...`
              : "Importing the song and its arrangement..."}
            {document && <span className="feedback-secondary"> Your current score stays open.</span>}
          </span>
        </div>
      )}
      {loadState.kind === "error" && (
        <div id="import-error" className="feedback-bar error-feedback" role="alert">
          <span>{loadState.message}</span>
          {loadState.retry && (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                if (loadState.kind === "error" && loadState.retry) void importScore(loadState.retry);
              }}
            >
              Try again
            </button>
          )}
          <button className="icon-button feedback-dismiss" type="button" aria-label="Dismiss import error" onClick={() => setLoadState({ kind: "idle" })}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="mobile-navigation">
        <button className="button tracks-toggle" type="button" aria-expanded={tracksOpen} aria-controls="track-index" onClick={() => setTracksOpen((open) => !open)}>
          <ListMusic size={18} aria-hidden="true" />
          Tracks
          <ChevronDown size={15} className={tracksOpen ? "chevron-open" : ""} aria-hidden="true" />
        </button>
        <span className="mobile-track-name">{document ? document.track.name : "Choose a song to begin"}</span>
      </div>

      <div className="workspace">
        <aside id="track-index" className={`track-sidebar${tracksOpen ? " is-open" : ""}`} aria-label="Arrangement tracks">
          <div className="sidebar-heading">
            <h2>Arrangement</h2>
            {document && <span>{tracks.length} tracks</span>}
            <button className="icon-button close-tracks" type="button" aria-label="Close tracks" onClick={() => setTracksOpen(false)}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          {document ? (
            <>
              <div className="track-filters" role="group" aria-label="Filter tracks">
                <button type="button" aria-pressed={trackFilter === "all"} onClick={() => setTrackFilter("all")}>All tracks</button>
                <button type="button" aria-pressed={trackFilter === "vocals"} onClick={() => setTrackFilter("vocals")}>Vocals</button>
              </div>
              <label className="track-search">
                <Search size={15} aria-hidden="true" />
                <span className="sr-only">Search tracks</span>
                <input type="search" value={trackSearch} onChange={(event) => setTrackSearch(event.target.value)} placeholder="Search tracks" />
              </label>
              <nav aria-label="Select a track">
                <ul className="track-list">
                  {visibleTracks.map((track) => {
                    const selected = track.id === document.track.id;
                    const pending = loadState.kind === "loading" && loadState.request.kind === "track" && loadState.request.partId === track.id;
                    return (
                      <li key={track.id}>
                        <button className={`track-item${selected ? " is-selected" : ""}`} type="button" aria-pressed={selected} aria-busy={pending} onClick={() => selectTrack(track)}>
                          <span className="track-icon"><TrackIcon track={track} /></span>
                          <span className="track-copy">
                            <span className="track-name">{track.name}</span>
                            <span className="track-instrument">{track.isVocal ? "Voice" : track.instrument}</span>
                          </span>
                          {pending ? <LoaderCircle className="spin track-state" size={15} aria-hidden="true" /> : selected ? <Check className="track-state" size={15} aria-hidden="true" /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>
              {visibleTracks.length === 0 && (
                <div className="track-empty">
                  <p>{search ? "No tracks match your search." : "This arrangement has no vocal tracks."}</p>
                  <button className="text-button" type="button" onClick={() => { setTrackSearch(""); setTrackFilter("all"); }}>Show all tracks</button>
                </div>
              )}
              <p className="sidebar-note">Choose one part to read at a time.</p>
            </>
          ) : (
            <div className="sidebar-placeholder">
              <ListMusic size={23} strokeWidth={1.4} aria-hidden="true" />
              <p>The song's instruments and voices will appear here.</p>
              <span>Choose a part after importing.</span>
            </div>
          )}
        </aside>

        <main className="reader" aria-label="Score reader">
          {document && (
            <section className="reading-toolbar" aria-label="Reading controls">
              <Playback track={document.track} transpose={transpose} seekMeasure={focusMeasure} onMeasureChange={setPlaybackMeasure} />
              <div className="control-group transpose-control">
                <span className="control-label" id="transpose-label">Transpose</span>
                <div className="stepper" role="group" aria-labelledby="transpose-label">
                  <button className="icon-button" type="button" disabled={transpose <= -12} aria-label="Transpose down one semitone" onClick={() => setReaderSettings((settings) => ({ ...settings, transpose: clamp(settings.transpose - 1, -12, 12) }))}><Minus size={16} aria-hidden="true" /></button>
                  <output aria-live="polite" aria-label="Transposition in semitones">{transpose > 0 ? `+${transpose}` : transpose}<span> st</span></output>
                  <button className="icon-button" type="button" disabled={transpose >= 12} aria-label="Transpose up one semitone" onClick={() => setReaderSettings((settings) => ({ ...settings, transpose: clamp(settings.transpose + 1, -12, 12) }))}><Plus size={16} aria-hidden="true" /></button>
                </div>
              </div>
              <div className="control-group accidental-control">
                <span className="control-label" id="accidental-label">Accidentals</span>
                <div className="segmented-control" role="group" aria-labelledby="accidental-label">
                  <button type="button" aria-label="Use sharp note names" aria-pressed={accidentalStyle === "sharps"} onClick={() => setReaderSettings((settings) => ({ ...settings, accidentalStyle: "sharps" }))}>♯</button>
                  <button type="button" aria-label="Use flat note names" aria-pressed={accidentalStyle === "flats"} onClick={() => setReaderSettings((settings) => ({ ...settings, accidentalStyle: "flats" }))}>♭</button>
                </div>
              </div>
              <div className="control-group zoom-control">
                <span className="control-label" id="zoom-label">Zoom</span>
                <div className="stepper" role="group" aria-labelledby="zoom-label">
                  <button className="icon-button" type="button" disabled={zoom <= 75} aria-label="Zoom out" onClick={() => setReaderSettings((settings) => ({ ...settings, zoom: settings.zoom === 150 ? 125 : settings.zoom === 125 ? 100 : 75 }))}><Minus size={15} aria-hidden="true" /></button>
                  <output aria-live="polite" aria-label="Score zoom">{zoom}%</output>
                  <button className="icon-button" type="button" disabled={zoom >= 150} aria-label="Zoom in" onClick={() => setReaderSettings((settings) => ({ ...settings, zoom: settings.zoom === 75 ? 100 : settings.zoom === 100 ? 125 : 150 }))}><Plus size={15} aria-hidden="true" /></button>
                </div>
              </div>
              <div className="toolbar-spacer" />
              {hasLyrics && <button className="button button-quiet lyrics-button" type="button"
                aria-pressed={showLyrics} onClick={() => setReaderSettings((settings) => ({ ...settings, showLyrics: !settings.showLyrics }))}>
                <MessageSquareText size={16} aria-hidden="true" /><span>Lyrics</span>
              </button>}
              <form className="measure-jump" onSubmit={handleMeasureJump} noValidate>
                <label className="control-label" htmlFor="measure-jump">Bar</label>
                <div className="measure-field">
                  <input id="measure-jump" type="number" inputMode="numeric" min={document.track.measures[0]?.number ?? 1} max={document.track.measures.at(-1)?.number ?? 1} value={measureInput} onChange={(event) => { setMeasureInput(event.target.value); setMeasureError(null); }} aria-invalid={measureError !== null} aria-describedby={measureError ? "measure-error" : undefined} />
                  <button className="icon-button" type="submit" aria-label="Go to bar"><ArrowRight size={15} aria-hidden="true" /></button>
                </div>
              </form>
              <button className="button button-quiet first-note-button" type="button" disabled={!firstNote} aria-label={firstNote ? `Jump to first note in bar ${firstNote.number}` : "This track has no notes"} onClick={() => { if (firstNote) jumpToMeasure(firstNote.number); }}>
                <MapPin size={15} aria-hidden="true" />
                <span>First note{firstNote && <span className="first-note-number"> bar {firstNote.number}</span>}</span>
              </button>
              <button className="button button-quiet print-button" type="button" onClick={() => window.print()}><Printer size={16} aria-hidden="true" /><span>Print</span></button>
              <button className="icon-button help-button" type="button" aria-label="How to read this notation" aria-expanded={helpOpen} aria-controls="notation-help" title="How to read this notation" onClick={() => setHelpOpen((open) => !open)}><CircleHelp size={19} aria-hidden="true" /></button>
            </section>
          )}
          {measureError && <p id="measure-error" className="measure-error" role="alert">{measureError}</p>}
          <section ref={helpSection} id="notation-help" className="notation-help" hidden={!helpOpen} aria-label="Notation reading key">
            <div className="help-heading"><h2>A quick reading key</h2><button className="icon-button" type="button" aria-label="Close reading key" onClick={() => setHelpOpen(false)}><X size={16} aria-hidden="true" /></button></div>
            <div className="help-content">
              <p><span className="key-note">C4</span> is middle C. The number on every note is its octave.</p>
               <p><RhythmMark /><span>A plain stem is a quarter note. A hollow circle with a stem is a half note.</span></p>
              <p><RhythmMark flagged /><span>One flag is an eighth note. A beam can join the flags.</span></p>
            </div>
              <p className="help-footnote">Read left to right. Notes stacked together form a chord. A hollow oval without a stem is a whole note. A dot adds half the note's length, and rest symbols mark silence.</p>
              <p className="help-footnote">Lyrics sit below the notes they belong to. A hyphen splits a word across notes, and an underline continues the previous syllable.</p>
          </section>

          <article id="score-page" className={`score-paper${document ? "" : " empty-paper"}`} tabIndex={-1}>
            {document ? (
              <>
                <header className="paper-heading">
                  <div className="song-heading">
                    <div><h1>{document.song.title}</h1><p className="song-artist">{document.song.artist}</p></div>
                    <a className="source-link" href={document.song.sourceUrl} target="_blank" rel="noreferrer">Source <ExternalLink size={13} aria-hidden="true" /><span className="sr-only"> on Songsterr, opens in a new tab</span></a>
                  </div>
                  <div className="part-heading">
                    <div className="part-title"><TrackIcon track={document.track} /><h2>{document.track.name}</h2></div>
                    <p className="transposition-caption">{transposeDescription(transpose)}</p>
                  </div>
                  <dl className="score-metadata">
                    <div><dt className="sr-only">Time signature</dt><dd>{timeSignatures.join(", ")}</dd></div>
                    {tempo && <div><dt className="sr-only">Tempo</dt><dd><RhythmMark />{Number(tempo.bpm.toFixed(1))} bpm{document.track.tempos.length > 1 && <span className="tempo-change" title="The tempo changes later in this track"> at start</span>}</dd></div>}
                    {document.track.range && <div><dt>Range</dt><dd>{noteLabel(document.track.range.low + transpose, accidentalStyle)} to {noteLabel(document.track.range.high + transpose, accidentalStyle)}</dd></div>}
                    <div><dt className="sr-only">Length</dt><dd>{document.track.measures.length} measures</dd></div>
                  </dl>
                </header>
                {document.warnings.length > 0 && (
                  <details className="import-notes"><summary>Import notes <span>{document.warnings.length}</span></summary><ul>{document.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></details>
                )}
                <div className="score-content">
                  {document.track.isVocal && !hasLyrics && <p className="lyrics-unavailable">This Songsterr track has no lyrics.</p>}
                  <Score track={document.track} transpose={transpose} accidentalStyle={accidentalStyle} zoom={zoom} focusMeasure={focusMeasure} showLyrics={showLyrics} playbackMeasure={playbackMeasure} />
                </div>
              </>
            ) : (
              <div className="empty-content">
                <h1>Import a song to read its notes</h1>
                <p className="empty-instruction">Paste a Songsterr link above. Choose an instrument or voice, then read its pitches and rhythm on the page.</p>
                <button className="button button-example" type="button" disabled={isImporting} onClick={() => submitUrl(EXAMPLE_URL)}>
                  {isImporting ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Music2 size={17} aria-hidden="true" />}
                  Try God Only Knows
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
                <p className="example-caption">The Beach Boys, with the full arrangement to choose from.</p>
                <NotationSample />
                <button className="text-button empty-help-button" type="button" aria-expanded={helpOpen} aria-controls="notation-help" onClick={() => setHelpOpen((open) => !open)}><CircleHelp size={16} aria-hidden="true" />How to read the notation</button>
              </div>
            )}
          </article>
        </main>
      </div>
    </div>
  );
}
