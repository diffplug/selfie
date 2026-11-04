# Demo video

A [HyperFrames](https://hyperframes.heygen.com) film: HTML and GSAP, rendered to MP4.

| File | Owns |
|---|---|
| `SCRIPT.md` | The words. One paragraph is one scene, and the bold line under it is the visual hint. |
| `scenes.json` | Each scene's slot in seconds, in the same order. A scene's beats stretch to fit its slot. |
| `compositions/<id>.html` | Each scene's pictures. |
| `assets/lib.js`, `assets/style.css` | The shared art: robot, cards, grid, booth, rocket. |
| `index.html`, `compositions/captions.html`, `subtitles.srt` | Generated. Don't edit them. |

```sh
npm install
node build.mjs                 # after changing SCRIPT.md or scenes.json
npx hyperframes preview        # edit and scrub in the browser
npx hyperframes check          # lint, layout, and motion
npx hyperframes render -o renders/selfie-demo.mp4
```

## Adding the voiceover

Generate one audio file per paragraph of `SCRIPT.md`. Set each scene's `dur` in `scenes.json` to its file's length plus a small pause, and add each file as an `<audio>` clip in `build.mjs`. Subtitle timing is estimated until word timestamps replace it.

To turn subtitles off, remove the captions host from the template in `build.mjs`.
