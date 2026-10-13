// ==UserScript==
// @name         Songsterr → Note / line
// @namespace    note-line
// @version      1.1.0
// @description  Open the current Songsterr track as readable letter notes.
// @match        https://www.songsterr.com/*
// @match        https://songsterr.com/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const SERVER_URL = "http://beelinkk.tail750ac6.ts.net:4813/";
  const BUTTON_ID = "note-line-songsterr-button";
  const ROW_ID = "note-line-songsterr-row";

  const style = document.createElement("style");
  style.textContent = `
      #${ROW_ID} { display: flex; justify-content: center; margin: 12px 0 8px; }
      #${BUTTON_ID} {
        display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        box-sizing: border-box; min-height: 36px; padding: 7px 13px;
        border: 1px solid var(--text-second, #737373); border-radius: 8px;
        background: var(--controls-button-surface, #ededef); color: var(--text, #323232);
        font: 600 14px/20px var(--system, system-ui, sans-serif);
        text-decoration: none; white-space: nowrap; cursor: pointer;
      }
      #${BUTTON_ID}:hover { border-color: var(--green-active-color, #329e00); color: var(--green-active-color, #329e00); }
      #${BUTTON_ID}:focus-visible { outline: 2px solid var(--blue-color, #007aff); outline-offset: 3px; }
      #${BUTTON_ID} svg { width: 18px; height: 18px; flex: none; }
      @media (max-width: 600px) { #${BUTTON_ID} { min-height: 44px; } }
      @media print { #${ROW_ID} { display: none; } }
  `;
  document.head.append(style);

  // A nav avoids Songsterr's promotion-placement logic for header divs.
  const row = document.createElement("nav");
  row.id = ROW_ID;
  row.setAttribute("aria-label", "Readable notation");
  const button = document.createElement("a");
  button.id = BUTTON_ID;
  button.rel = "noreferrer";
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7h18M3 12h18M3 17h18M16 3v12"/><ellipse cx="13" cy="17" rx="3" ry="2" fill="currentColor"/></svg><span>Read letter notes</span>';
  row.append(button);

  function update() {
    const header = document.querySelector("#header");
    if (!header?.querySelector("#song-ttl") || !/(?:^|[-/])s[1-9]\d*(?:t\d+)?(?=$|[-/])/.test(window.location.pathname)) {
      row.remove();
      return;
    }
    const target = new URL(SERVER_URL);
    target.searchParams.set("song", window.location.href);
    if (button.href !== target.href) button.href = target.href;
    if (row.parentElement !== header) header.append(row);
  }

  // Keep the link current when Songsterr navigates without reloading.
  window.setInterval(update, 750);
  update();
})();
