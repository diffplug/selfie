# Product demo

A [HyperFrames](https://hyperframes.heygen.com) film of the real product, reviewing its own Storybook.

| File | Owns |
|---|---|
| `SCRIPT.md` | The words. One paragraph is one scene, and the bold line under it is what's on screen. |
| `scenes.json` | The scenes, in the same order, and how long each holds after its last word. |
| `assets/narration.mp3`, `assets/narration-timing.json` | The voiceover, and when each word of it happens, once there is one. Until then, timing is estimated. |
| `compositions/<id>.html` | Each scene. Beats are written as `w("word")`, so they follow the voice. |
| `assets/ui/` | Screenshots of the real app, 2x, each one a state it was really in. `points.json` is where the pointer was. |
| `assets/lib.js`, `assets/style.css` | The app window, its pointer and camera, and the terminal. |
| `index.html`, `compositions/captions.html`, `subtitles.srt`, `subtitles.vtt` | Generated. Don't edit them. |

```sh
npm install
node build.mjs                 # after changing SCRIPT.md, scenes.json, or the voiceover
npx hyperframes preview        # edit and scrub in the browser
npx hyperframes check          # lint, layout, and motion
npx hyperframes render -o renders/selfie-product-demo.mp4
```

## Adding the voiceover

Generate the whole script as one take, then save its MP3 as `assets/narration.mp3` and its timing JSON as `assets/narration-timing.json`, and run `node build.mjs`. Scene lengths, subtitles, and beats all follow the words. The build stops with an error if the script and the audio disagree on a word; a word the voice spells differently goes in `SPOKEN_AS` in `build.mjs`.
