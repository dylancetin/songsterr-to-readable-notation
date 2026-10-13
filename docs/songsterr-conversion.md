# Songsterr conversion

The reader imports Songsterr's structured score data directly. This keeps written rhythm and measure structure without reconstructing notation from MIDI note events.

## Downloader pipeline

The inspected [downloader service](https://github.com/Metaphysics0/songsterr-downloader/blob/097ee38212715307929b54627c79fbd8af9e41cc/src/lib/server/services/download-tab.service.ts) uses this pipeline:

1. Fetch the song page and parse the JSON in `script#state`. The [revision service](https://github.com/Metaphysics0/songsterr-downloader/blob/097ee38212715307929b54627c79fbd8af9e41cc/src/lib/server/services/songsterr-revision-json.service.ts) reads `meta.current` for the song ID, revision ID, image token, and track list.
2. Fetch each part's revision JSON from the CDN at `/{songId}/{revisionId}/{image}/{partId}.json`. The primary host is `dqsljvtekg760.cloudfront.net`, with `d3d3l6a6rcgkaf.cloudfront.net` as the alternate.
3. Build an alphaTab score with the [Songsterr converter](https://github.com/Metaphysics0/songsterr-downloader/blob/097ee38212715307929b54627c79fbd8af9e41cc/src/lib/server/services/converter/songsterr-to-alphatab.converter.ts). The converter maps tracks, tuning, measures, voices, beats, notes, and supported effects.
4. Export Guitar Pro 7 through `Gp7Exporter`, or generate MIDI through `MidiFileGenerator`. MIDI export can separate tracks and include track names.

The reader follows the same page and CDN discovery in [src/server/songsterr.ts](../src/server/songsterr.ts), then normalizes the selected part directly into its [score model](../src/shared/model.ts). It fetches one part at a time rather than exporting the arrangement through alphaTab.

The browser sends `POST /api/import` with `{url, partId?}`. An explicit `partId` takes priority over a part linked in the URL. Otherwise, selection falls back to the first vocal track, then the first track. Bun serves the app at `/` and exposes `/api/health` from [index.ts](../index.ts).

## Pitch and octave labels

For pitched notes, Songsterr's zero-based `string` indexes the supplied tuning array. The reader prefers revision tuning and falls back to track metadata. It does not assume standard guitar tuning.

The pitch and scientific octave are:

```text
midi = tuning[string] + fret
octave = floor(midi / 12) - 1
```

MIDI 60 is `C4`, middle C. MIDI 61 is `C♯4` or `D♭4`, and MIDI 62 is `D4`. The actual opening notes of Carl Wilson's lead vocal in the included God Only Knows example are `D4 C♯4 D4` in bar 9. Each is a quarter-note triplet lasting `2/3` of a quarter note.

Transposition adds semitones before the reader calculates the label. The accidental preference chooses sharp or flat spelling without changing the MIDI pitch. Percussion instead treats `fret` as a drum MIDI number and displays a drum name.

## Rhythm without double tuplets

Songsterr's rational `duration: [numerator, denominator]` is a fraction of a whole note. The reader stores duration and start position in quarter-note units:

```text
duration = 4 * numerator / denominator
```

For example, `[1, 4]` lasts one quarter, `[3, 8]` lasts 1.5 quarters, and `[1, 6]` lasts `2/3` of a quarter. The rational duration already includes dots and tuplet scaling. The reader does not apply either factor again.

The source `type`, `dots`, and `tuplet` describe the written rhythm. The renderer uses them for stems, flags, dots, and tuplet brackets. If the rational duration is missing, the importer reconstructs timing from valid source notation and reports a warning. Conflicting notation keeps the rational timing and also produces a warning.

The downloader's [duration mapper](https://github.com/Metaphysics0/songsterr-downloader/blob/097ee38212715307929b54627c79fbd8af9e41cc/src/lib/server/services/converter/duration-mapper.ts) maps fractions to alphaTab note values and can approximate unsupported durations. For tuplets, the converter uses the base `type` and lets alphaTab apply the tuplet ratio once. Direct JSON avoids that export approximation and preserves explicit rests, ties, voices, and notation choices that MIDI events do not fully describe.

## Lyrics aligned to notes

The importer reads a track's `newLyrics` text and its one-based `offset` start bar. It uses the first entry, or the sixth entry when Songsterr supplies an override after the five original lyric lines. Older revisions can also supply `lyrics` directly on a beat.

Track lyrics follow the first voice. A space separates syllables, a hyphen splits a word, and `+` joins words on one note. Additional spaces reserve note positions for held syllables. Bracketed comments and line breaks do not supply words. Rests and grace notes do not consume syllables. Tied notes continue the previous word, while explicit empty positions can still consume held-note spacing.

The importer assigns lyrics before it skips malformed notes or durations, so omitted source beats do not move later words. The renderer centers a syllable below its note and widens the bar to fit long words. Underlines mark continued syllables. The **Lyrics** control hides or shows lyrics, and printing uses the same setting.

The [opening In My Life fixture](../src/server/fixtures/songsterr-in-my-life-opening.json) contains the first eight bars and opening lyric text from song 2814, revision 8628464, part 0. Its regression test checks lyric positions against the Songsterr vocal display, including the pickup in bar 4 and the held word in bar 7.

## Score structure and current limits

[Score.tsx](../src/components/Score.tsx) and [score-layout.ts](../src/components/score-layout.ts) render every measure and every imported voice of the selected track. Voices have separate lanes and independent timing. Chords stack their pitches. Full-measure rests remain visible, so opening silence stays in the score.

The reader draws ties between adjacent matching pitches in the same voice, including across bars and rows. It also renders dots, beams, tuplets, grace notes, meter changes, section markers, repeats, alternate endings, and swing indications. Grace notes do not advance a voice's timing. The model retains tempo changes, while the page header shows the first tempo.

The current reader parser does not preserve bends, slides, harmonics, hammer-ons, pull-offs, vibrato, dynamics, or other performance articulations. Some have mappings in the downloader's alphaTab converter, but those mappings are not part of the reader. A harmonic label therefore reflects `tuning[string] + fret`, not a calculated harmonic sounding pitch. Unsupported effects can disappear without an import warning.

Malformed or unpitched dead notes are skipped with warnings. A beat with no decodable notes retains its elapsed timing when its duration is valid. Invalid timing can cause a beat to be skipped. Measure-total mismatches appear in **Import notes** rather than causing the importer to add filler beats. The app supports reading and printing, with no playback or score editing.
