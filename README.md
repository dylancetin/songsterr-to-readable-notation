# Read a Songsterr score

Note / line turns a Songsterr track into letter notes with octave labels, rhythm, and aligned lyrics when the source includes them. It is a reading-only app built with Bun 1.4.2, Vite, React 19, and TypeScript, with no playback or score editing.

## Start the app

With [Bun 1.4.2](https://bun.com) installed, run these commands from the project directory:

```bash
bun install
bun run dev
```

Open <http://localhost:4813>. The dev command starts Vite with `--host` and the Bun import API on `127.0.0.1:3001`. Vite proxies `/api` requests to Bun.

For Tailscale access, open `http://<tailscale-ip>:4813` or `http://<magicdns-name>.ts.net:4813` on another device in your tailnet.

To change Vite's port, start the API and Vite in separate terminals:

```bash
bun run dev:api
bun run dev:vite --port 4814
```

To build the frontend into `dist`, run:

```bash
bun run build
```

To build and run production with the same network access and port as dev, use:

```bash
bun run prod
```

Open <http://localhost:4813> or <http://beelinkk.tail750ac6.ts.net:4813> from your tailnet. This command builds `dist` and serves the built frontend and import API on `0.0.0.0:4813` (the equivalent of Vite's `--host`). Stop dev first, since both use port `4813`. Override the port with `PORT=4814 bun run prod`, or restrict the interface with `HOST=127.0.0.1 bun run prod`.

To run an existing build without rebuilding, use:

```bash
bun run start
```

The standalone `start` command uses port `3000` by default and also binds to all interfaces. To change it, set `PORT`:

```bash
PORT=3002 bun run start
```

## Open the current track from Songsterr

1. Start the production server with `bun run prod`.
2. With Tampermonkey installed, open <http://beelinkk.tail750ac6.ts.net:4813/songsterr-note-line.user.js> and choose **Install**. Alternatively, copy [`scripts/songsterr-note-line.user.js`](scripts/songsterr-note-line.user.js) into a new Tampermonkey script.
3. Open a Songsterr tab. Click **Read letter notes** below its song title. The same browser tab opens Note / line and automatically imports the current Songsterr link.

The userscript defaults to `http://beelinkk.tail750ac6.ts.net:4813/`. To use localhost, another host, or another port, edit `SERVER_URL` near the top of [`scripts/songsterr-note-line.user.js`](scripts/songsterr-note-line.user.js).

The button is a normal `<a href>` carrying the current Songsterr URL in `?song=...`. Its link updates during in-page navigation, with no custom click handler, requests, or Tampermonkey permissions. Track IDs encoded in the Songsterr link are preserved; links without a track ID use the reader's default track. Your device needs network access to the configured server.

## Import and read a track

1. Paste a complete HTTPS Songsterr song link into the URL field.
2. Click **Import song**. To use the included example, click **Try God Only Knows** instead.
3. Choose a track in **Arrangement**. Use **Vocals** or **Search tracks** to find a part. On a narrow screen, open **Tracks** first.
4. Click **First note** to jump to the first bar containing notes and skip opening rests. To jump elsewhere, enter a number in **Bar** and click its arrow.
5. Read left to right. Each label gives a pitch and its octave. `C4` is middle C. Stacked labels form a chord, and rest symbols mark silence.

Stems, flags, beams, dots, and tuplet numbers give the rhythm. Open **How to read this notation** for the reading key.

For vocal lyrics, import [In My Life by The Beatles](https://www.songsterr.com/a/wsa/beatles-in-my-life-vocal-tab-s2814) and choose **John Lennon | Double-Tracked Lead Vocals**. The opening words appear in bar 4. Each syllable sits below its note. Hyphens split words across notes, and underlines continue the previous syllable. Click **Lyrics** to hide or show the words. Tracks without source lyrics display a message.

To adjust the score or print it, use the reading controls:

- Use **Transpose** to shift pitched notes by semitones, up to one octave in either direction. Drum labels stay unchanged.
- Choose **Accidentals** `♯` or `♭` to change note spelling without changing pitch.
- Use **Zoom** to set the score size from 75% to 150%.
- Click **Print** to print the selected track or save it as a PDF through your browser. The print view hides navigation and reading controls.

If **Import notes** appears, expand it to inspect source-data warnings. See [Songsterr conversion](docs/songsterr-conversion.md) for pitch, rhythm, and support limits.

## Check the project

Run the type check and offline tests:

```bash
bun run typecheck
bun run test
```

To also test an import against Songsterr and its CDN, run:

```bash
SONGSTERR_LIVE=1 bun test src/server/songsterr.test.ts
```
