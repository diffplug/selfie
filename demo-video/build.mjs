// Generates index.html, compositions/captions.html and the subtitle files from SCRIPT.md, scenes.json and the voiceover.
// SCRIPT.md owns the words, the voiceover's timing file owns when they happen, compositions/<id>.html owns the pictures.
import { readFileSync, writeFileSync } from "node:fs";

const AUDIO = "assets/narration.mp3";
const LEAD_IN = 0.08; // A scene's picture arrives just before its first word.

const { scenes, draftScript = false } = JSON.parse(readFileSync("scenes.json", "utf8"));
const lines = readFileSync("SCRIPT.md", "utf8").split("\n").map((l) => l.trim());
const narration = lines.filter((l) => l && !l.startsWith("#") && !l.startsWith("**"));
if (narration.length !== scenes.length) {
  throw new Error(`SCRIPT.md has ${narration.length} paragraphs, scenes.json has ${scenes.length}`);
}

// The timing file spells some words its own way, so compare them in a plain form.
const plain = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, "");
const SPOKEN_AS = { storybookjs: ["storybook", "js"], 8: ["eight"] };
const spoken = JSON.parse(readFileSync("assets/narration-timing.json", "utf8"))
  .segments.flatMap((s) => s.words)
  .filter((w) => w.text.trim())
  .map((w) => ({ word: plain(w.text), start: w.start_time, end: w.end_time }));

// Each word of the script takes its time from what the voice said, and a difference is an error.
// With "draftScript" in scenes.json, a paragraph that differs keeps its slot in the take instead, so later scenes don't drift.
// The words it shares with the take keep their times, and the rest share what's left of the slot by length.
const expect = (text) => SPOKEN_AS[plain(text)] ?? [plain(text)];
const saidAt = (at, tokens) => tokens.every((t, i) => spoken[at + i]?.word === t);
function endOfParagraph(from, later) {
  for (const paragraph of later) {
    const opening = paragraph.split(/\s+/).slice(0, 4).flatMap(expect);
    for (let at = from; at < spoken.length; at++) if (saidAt(at, opening)) return at;
  }
  return spoken.length;
}
let cursor = 0;
const edited = [];
const wordsByScene = narration.map((paragraph, i) => {
  const words = paragraph.split(/\s+/);
  const tokens = words.flatMap(expect);
  if (saidAt(cursor, tokens) && (i + 1 < narration.length || cursor + tokens.length === spoken.length)) {
    return words.map((text) => {
      const n = expect(text).length, first = spoken[cursor], last = spoken[cursor + n - 1];
      cursor += n;
      return { text, start: first.start, end: last.end };
    });
  }
  if (!draftScript) {
    throw new Error(`Paragraph ${i + 1} of SCRIPT.md doesn't match the voiceover at ${spoken[cursor]?.start} s: "${paragraph}". Regenerate the audio, or set "draftScript" in scenes.json for now.`);
  }
  edited.push(i + 1);
  const end = endOfParagraph(cursor, narration.slice(i + 1));
  const timedWords = Array(words.length);
  let head = 0, at = cursor;
  while (head < words.length && saidAt(at, expect(words[head]))) {
    const n = expect(words[head]).length;
    timedWords[head++] = { text: words[head - 1], start: spoken[at].start, end: spoken[at + n - 1].end };
    at += n;
  }
  let tail = words.length, back = end;
  while (tail > head && back - expect(words[tail - 1]).length >= at && saidAt(back - expect(words[tail - 1]).length, expect(words[tail - 1]))) {
    const n = expect(words[tail - 1]).length;
    back -= n;
    timedWords[--tail] = { text: words[tail], start: spoken[back].start, end: spoken[back + n - 1].end };
  }
  const from = at < spoken.length ? spoken[at].start : spoken.at(-1).end;
  const to = back > at ? spoken[back - 1].end : from;
  const chars = words.slice(head, tail).reduce((n, w) => n + w.length + 1, 0);
  let clock = from;
  for (let k = head; k < tail; k++) {
    const length = ((to - from) * (words[k].length + 1)) / chars;
    timedWords[k] = { text: words[k], start: clock, end: clock + length };
    clock += length;
  }
  cursor = end;
  return timedWords;
});
if (cursor !== spoken.length) throw new Error(`The voiceover goes on after SCRIPT.md ends, at "${spoken[cursor].word}".`);
if (edited.length) console.warn(`DRAFT: paragraphs ${edited.join(", ")} don't match the voiceover, so their audio is out of date. Regenerate it before publishing.`);

const timed = scenes.map((s, i) => {
  const start = i === 0 ? 0 : wordsByScene[i][0].start - LEAD_IN;
  const end = i + 1 < scenes.length ? wordsByScene[i + 1][0].start - LEAD_IN : wordsByScene[i].at(-1).end + (s.hold ?? 0.35);
  return { id: s.id, start: +start.toFixed(3), dur: +(end - start).toFixed(3), words: wordsByScene[i], text: narration[i] };
});
const total = +(timed.at(-1).start + timed.at(-1).dur).toFixed(3);

const MAX_CHARS = 58;
const MIN_CLAUSE = 24;
function groupsOf(text) {
  // A short clause joins the next one when they fit together, so "Now," never stands alone.
  const clauses = [];
  for (const sentence of text.split(/(?<=[.?!])\s+/)) {
    const parts = sentence.split(/(?<=[,:])\s+/);
    let line = "";
    for (const part of parts) {
      if (line && (line.length < MIN_CLAUSE || (part.length < MIN_CLAUSE && !line.endsWith(":")))) line += " " + part;
      else {
        if (line) clauses.push(line);
        line = part;
      }
    }
    clauses.push(line);
  }
  // A clause that is still too long is split into even lines at word boundaries.
  return clauses.flatMap((clause) => {
    if (clause.length <= MAX_CHARS) return [clause];
    const n = Math.ceil(clause.length / MAX_CHARS);
    const target = clause.length / n;
    const lines = [];
    let line = "";
    for (const word of clause.split(" ")) {
      if (line && lines.length < n - 1 && line.length + word.length / 2 >= target) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
    return lines;
  });
}

// A subtitle opens on its first word and stays until the next one opens, unless the voice pauses for long.
const MAX_LINGER = 0.5;
const flat = timed.flatMap((s) => groupsOf(s.text).reduce((out, text) => {
  const count = text.split(" ").length, from = out.used;
  out.groups.push({ text, first: s.words[from], last: s.words[from + count - 1] });
  out.used += count;
  return out;
}, { groups: [], used: 0 }).groups);
const captions = flat.map((g, i) => {
  const next = flat[i + 1]?.first.start ?? Infinity;
  const until = Math.min(next, g.last.end + MAX_LINGER);
  return { text: g.text, start: +g.first.start.toFixed(3), duration: +(until - g.first.start).toFixed(3) };
});

const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const hosts = timed
  .map(
    (s) => `      <div id="${s.id}" data-composition-id="${s.id}" data-composition-src="compositions/${s.id}.html" data-start="${s.start}" data-duration="${s.dur}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080"></div>`,
  )
  .join("\n");
const durations = Object.fromEntries(timed.map((s) => [s.id, s.dur]));
// What each scene's words are, at what time within the scene, so a beat can land on the word that names it.
const spokenInScene = Object.fromEntries(timed.map((s) => [s.id, s.words.map((w) => [plain(w.text), +(w.start - s.start).toFixed(3), +(w.end - s.start).toFixed(3)])]));

writeFileSync(
  "index.html",
  `<!doctype html>
<!-- Generated by build.mjs. Edit SCRIPT.md, scenes.json or compositions/, then run: node build.mjs -->
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <link rel="stylesheet" href="assets/style.css" />
    <script>window.SCENE_DURATIONS = ${JSON.stringify(durations)}; window.SCENE_WORDS = ${JSON.stringify(spokenInScene)};</script>
    <script src="assets/lib.js"></script>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="1920" data-height="1080">
${hosts}
      <div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="${total}" data-track-index="2" data-track-kind="captions" data-width="1920" data-height="1080"></div>
      <audio id="narration" src="${AUDIO}" data-start="0" data-track-index="3" data-volume="1"></audio>
    </div>
    <script>
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`,
);

writeFileSync(
  "compositions/captions.html",
  `<template>
  <!-- Generated by build.mjs from SCRIPT.md and scenes.json. -->
  <style>
    #root { position: absolute; inset: 0; z-index: 100; pointer-events: none; }
    .cap { position: absolute; left: 0; right: 0; bottom: 44px; text-align: center; }
    .cap span {
      display: inline-block; padding: 8px 26px 11px; border-radius: 10px;
      background: rgba(28, 28, 36, 0.9); color: #fff;
      font: 500 42px/1.2 "Jost", sans-serif; letter-spacing: 0.002em;
    }
  </style>
  <div id="root" data-composition-id="captions" data-width="1920" data-height="1080">
${captions
  .map(
    (c, i) => `    <div id="cap${i}" class="clip cap" data-start="${c.start}" data-duration="${c.duration}" data-track-index="2" data-layout-allow-caption-zone><span>${esc(c.text)}</span></div>`,
  )
  .join("\n")}
  </div>
  <script>
    window.__timelines["captions"] = gsap.timeline({ paused: true });
  </script>
</template>
`,
);

const stamp = (t, sep) => {
  const ms = Math.round(t * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`;
};
const cues = (sep) => captions.map((c) => `${stamp(c.start, sep)} --> ${stamp(c.start + c.duration, sep)}\n${c.text}\n`);
writeFileSync("subtitles.srt", cues(",").map((c, i) => `${i + 1}\n${c}`).join("\n"));
writeFileSync("subtitles.vtt", `WEBVTT\n\n${cues(".").join("\n")}`);

for (const s of timed) console.log(`${s.id.padEnd(10)} ${s.start.toFixed(2).padStart(7)}  ${s.dur.toFixed(2).padStart(6)} s`);
const words = narration.join(" ").split(/\s+/).length;
console.log(`${scenes.length} scenes, ${captions.length} captions, ${words} words, ${total.toFixed(1)} s (${((words / total) * 60).toFixed(0)} wpm)`);
