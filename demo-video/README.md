# Demo video

A [HyperFrames](https://hyperframes.heygen.com) film: HTML and GSAP, rendered to MP4.

| File | Owns |
|---|---|
| `SCRIPT.md` | The words. One paragraph is one scene, and the bold line under it is the visual hint. |
| `assets/narration.mp3`, `assets/narration-timing.json` | The voiceover, and when each word of it happens, from ElevenLabs. |
| `scenes.json` | The scenes, in the same order as the paragraphs. Scenes start and end on the words they cover. |
| `compositions/<id>.html` | Each scene's pictures. |
| `assets/lib.js`, `assets/style.css` | The shared art: robot, cards, grid, booth, rocket. |
| `index.html`, `compositions/captions.html`, `subtitles.srt`, `subtitles.vtt` | Generated. Don't edit them. |

```sh
npm install
node build.mjs                 # after changing SCRIPT.md or scenes.json
npx hyperframes preview        # edit and scrub in the browser
npx hyperframes check          # lint, layout, and motion
npx hyperframes render -o renders/selfie-demo.mp4
```

## Changing the voiceover

Replace the two `assets/narration*` files with a new take, and run `node build.mjs`. Scene lengths, subtitles and any beat written as `w("word")` all follow the words. The build stops with an error if `SCRIPT.md` and the audio disagree on a word.

To turn burned-in subtitles off, remove the captions host from the template in `build.mjs`.
