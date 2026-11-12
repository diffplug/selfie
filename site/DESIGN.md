---
name: Selfie
description: Distributed Storybook testing, shown as a robot checking its own selfie against yesterday's.
colors:
  sky: "#bfd9f0"
  ink: "#1f2328"
  muted: "#4a525c"
  paper: "#ffffff"
  yellow: "#f9d535"
  cam-yellow: "#ffd60a"
  hot-pink: "#fd259a"
  signal-pink: "#e8509b"
  screen-black: "#0f0f11"
  slate-note: "#a9b4c0"
typography:
  display:
    fontFamily: "Jost, system-ui, sans-serif"
    fontSize: "clamp(2.6rem, 9vw, 4.75rem)"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.012em"
  headline:
    fontFamily: "Jost, system-ui, sans-serif"
    fontSize: "clamp(2rem, 4vw, 2.75rem)"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Jost, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Jost, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Jost, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  hand:
    fontFamily: "Neucha, Jost, sans-serif"
    fontWeight: 400
    lineHeight: 0.92
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.86em"
rounded:
  button: "12px"
  frame: "14px"
  round: "50%"
spacing:
  gutter: "1.25rem"
  grid-gap: "2rem"
  column-gap: "3.5rem"
  section: "5rem"
  section-compact: "3.25rem"
  container: "1120px"
components:
  button-primary:
    backgroundColor: "{colors.yellow}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "0.7rem 1.25rem"
  button-dark:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.button}"
    padding: "0.7rem 1.25rem"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "0.7rem 1.25rem"
  notice-strip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    padding: "0.7rem 1.25rem"
  video-thumb:
    rounded: "{rounded.frame}"
  play-disc:
    backgroundColor: "{colors.signal-pink}"
    rounded: "{rounded.round}"
    size: "3.5rem"
  terminal:
    backgroundColor: "{colors.screen-black}"
    textColor: "{colors.paper}"
    rounded: "{rounded.frame}"
    padding: "1.25rem 1.5rem"
  shutter:
    backgroundColor: "#f7f7f7"
    textColor: "{colors.ink}"
    rounded: "{rounded.round}"
  handwritten-note:
    textColor: "{colors.hot-pink}"
    typography: "{typography.hand}"
---

# Design System: Selfie

## Overview

**Creative North Star: "The Robot's Own Selfie"**

Selfie's world is a flat sky-blue field with ink-outlined objects on it, and a serious, photoreal robot doing a playful thing: holding up a phone and checking today's selfie against yesterday's print. The premise is a joke; the art is not. The robot is a matte white ceramic and dark-metal studio robot, lit like product photography, and it is only ever shown in the selfie situation: the phone in its hand, yesterday's print beside it, and the one changed plate circled in hot pink. Never the robot alone as a mascot.

Everything around the art is quiet and graphic so the photograph can carry the page. Copy is one typeface, Jost, set heavy and close with real italics for the single stressed word in a line. Surfaces are flat fields of colour (sky, white paper, ink, yellow) divided by full-width bands rather than cards. Objects that can be touched or picked up (buttons, thumbnails, the print, the phone) get a 3px ink outline. The neighbouring product, the review app, is stock GitHub Primer, and the marketing world was chosen to sit beside it: Primer's ink and muted greys are this system's text colours.

Rejected and not to return: the cute anime or cartoon robot style, and the typefaces Bagel Fat One and Andika.

**Key Characteristics:**
- One flat sky ground (#bfd9f0) for the first screen and the 404; white, ink, and yellow bands below.
- 3px ink outlines on handled objects; flat colour everywhere else.
- Jost for all UI and copy, with true italics for emphasis; Neucha only for handwriting.
- Hot pink belongs to the annotation layer alone.
- A photoreal studio robot, always mid-selfie, never alone.
- The camera interface is drawn in code with its own yellow.

## Colors

A cool sky and Primer ink carry the page; two yellows and one hot pink each own a single job.

### Primary
- **Button Yellow** (`yellow`): the yellow of every primary button, the full-width "early" band, the highlighter stroke under the key number, link colour on ink bands, inline code on ink, and text selection.

### Secondary
- **Camera Chrome Yellow** (`cam-yellow`): the phone's own UI only: the focus brackets around the head plate, the active "SELFIE" mode and its underline, and the bracket mark in the icon. It stays distinct from Button Yellow so the phone reads as a device, not as page chrome.

### Tertiary
- **Annotation Hot Pink** (`hot-pink`): the handwritten "this changed" note, the drawn arrow, the marker circle baked into today's plate, and the shutter's focus ring inside the phone. It is a pen, not a brand colour.
- **Signal Pink** (`signal-pink`): the page-level focus ring and the video play discs.

### Neutral
- **Sky** (`sky`): the ground of the first viewport and the 404 page, chosen by the owner from the earlier homepage.
- **Primer Ink** (`ink`): text, outlines, the notice strip, the "loop" band and the footer.
- **Primer Muted** (`muted`): secondary text on white, such as video descriptions.
- **Paper** (`paper`): the body ground below the hero, and text on ink.
- **Screen Black** (`screen-black`): the phone screen and the terminal block.
- **Slate Note** (`slate-note`): terminal comments and fine print on ink.

### Named Rules
**The Pen Rule.** Hot pink is the annotation layer: handwriting, arrows, circles, and the shutter's focus ring. It never fills a button, a band, a logo, or a headline.

**The Two Yellows Rule.** Button Yellow belongs to the page; Camera Chrome Yellow belongs to the phone. Don't swap them.

**The Sky Ground Rule.** The first screen sits on the one flat sky, with no gradient, texture, or second tint.

## Typography

**Display Font:** Jost (variable 100-900, with real Jost Italic), falling back to system-ui
**Body Font:** Jost
**Label Font:** Neucha, for handwritten labels only
**Code:** the system monospace stack

**Character:** Jost's geometric construction set heavy and tight reads confident and technical; its true italic gives one word per line a voice without a second family. Neucha is the marker on the print, never the page.

### Hierarchy
- **Display** (600, clamp(2.6rem, 9vw, 4.75rem), 1.12; 82 comp-pixels and 1.06 at 1100px and up; 2.35rem and 1.05 under 600px): the hero headline. The italic word is set at the same weight, 600.
- **Headline** (700, clamp(2rem, 4vw, 2.75rem), 1.08, -0.015em): section heads; italic words inside drop to 600.
- **Title** (600, 1.5rem, 1.25, -0.01em): the hero argument line. Smaller titles at 1.375rem (video titles) and 1.25rem (feature names) share weight 600; the price line steps up to 700 at 2rem.
- **Body** (400, 1.1875rem, 1.5): running copy, held to about 42-48em.
- **Label** (400, 1rem): fine print. The notice strip runs at 1.0625rem.
- **Hand** (Neucha 400, sized to its container): "this changed" and "yesterday". Rotated and skewed as if written.

### Named Rules
**The One Family Rule.** Jost sets every word of UI and copy. Emphasis is Jost Italic, a real italic, applied to one stressed word ("*Distributed*", "*inside*", "*own*", "*early*"), not to whole phrases.

**The Marker Rule.** Neucha appears only where a person would have written by hand on the artwork. It never sets a heading, button, or paragraph.

## Layout

Full-bleed horizontal bands in a fixed sequence of grounds: an ink notice strip, the sky hero, then white, ink, yellow, and ink bands. Content inside the bands sits in a centred container (1120px, with 1.25rem gutters at each side). Sections pad 5rem top and bottom (4.5rem for the yellow band, 2.5rem for the footer), dropping to 3.25rem at 860px and below, where every two-column grid becomes one column. Grids use 2rem gaps for cards and 3.5rem between text columns (2.25rem when stacked).

The hero is drawn from the approved comp. At 1100px and up it is a fixed-proportion stage: every size is comp pixels times a unit of min(100vw, 150vh) / 1536, the copy column sits 112 units in and is vertically centred, and the phone stage pins to the right edge. Below 1100px the copy flows first and the phone stage follows, right-aligned and capped at 560px; under 600px the hero type tightens so the shutter stays near the fold. Inside the phone, positions are percentages of the stage and sizes are container-query units, so the camera UI scales as one picture.

## Elevation & Depth

Flat by default. Depth comes from 3px ink outlines and colour bands, not from ambient shadows. Two shadows exist, and each has one job.

### Shadow Vocabulary
- **Pressable offset** (`box-shadow: 4px 4px 0 #1f2328`; hover `5px 5px 0`, active `1px 1px 0` with a 3px translate): buttons only. The shadow is the button's travel: it grows on hover and collapses on press.
- **Print drop** (`box-shadow: 0.6cqw 0.8cqw 1.6cqw rgb(31 35 40 / 0.18)`): the paper print of yesterday's selfie, a physical object lying above the sky.

### Named Rules
**The Pressable Rule.** The hard offset shadow means "you can press this". It belongs to buttons and nothing else; thumbnails, panels and frames get the outline without the shadow.

## Shapes

Softly rounded rectangles with a heavy ink line. Buttons round at 12px; frames (video thumbnails, the terminal) at 14px; the shutter, play discs and the last-photo chip are full circles. The phone is a deep-radius slab with a thinner ink rim, drawn in CSS. The print is a slightly rounded white card tilted 8 degrees. The hero band closes on a 3px ink rule. The icon is the same family: an ink rounded square with yellow focus brackets around a blue head plate.

## Components

### Buttons
Chunky and tactile, like a sticker with a shadow you can push.
- **Shape:** gently rounded (12px), 3px ink outline.
- **Primary:** Button Yellow with ink text, weight 600, padding 0.7rem 1.25rem. The hero version scales with the comp (33 units, weight 700, a 6-unit outline, 14-unit radius).
- **Dark:** ink fill, white text, same outline and shadow.
- **Secondary:** white fill, ink text.
- **Hover / Focus / Active:** lifts 1px with a 5px shadow; presses 3px in with a 1px shadow; 0.12s ease-out, removed under reduced motion. Focus is a 3px Signal Pink outline offset 3px.

### Cards / Containers
- **Video thumbnail:** 16:9 image in a 3px ink frame with 14px corners, no shadow. A Signal Pink play disc (3.5rem, ink outline, white triangle) sits 1rem in from the lower left. Title below at 1.375rem/600, underlining on hover; description in Primer Muted.
- **Terminal:** Screen Black block on the ink band, 1px hairline at 14% white, 14px corners, monospace at 1.125rem/1.55, comments in Slate Note.

### Navigation
There is no nav bar. The ink notice strip at the top carries one sentence and one Button Yellow link with an inline stroke arrow; it wraps and centres on narrow screens. The home page has no logo or wordmark; the 404 carries the icon-and-word lockup ("selfie", Jost 700, 1.875rem).

### Camera Interface (signature)
The phone screen is built in code over the photo plate: a Screen Black screen, a white readout line with a stroke icon, Camera Chrome Yellow focus brackets around the subject, a white shutter ring that is a real link ("Join the list"), a round last-photo chip showing yesterday's plate, and a VIDEO / SELFIE / PHOTO mode row with the active mode in Camera Chrome Yellow and underlined. Pressing the shutter fires a 0.32s white flash; on fine pointers the robot's thumb tracks the cursor and presses it.

### Annotation
The annotation layer marks the one thing that changed. Handwriting in Neucha and Annotation Hot Pink, rotated about -12 degrees; an arrow drawn in SVG strokes (4.6 wide, round caps) from the note to the circled plate, drawing itself in on load (0.6s line, then 0.22s head) unless reduced motion is set. The circle is part of the raster plate.

### Highlight
One key figure per screen can carry a Button Yellow highlighter band behind its lower half (58% to 92% of the line), set in bold.

## Do's and Don'ts

### Do:
- **Do** set the first screen on flat Sky (#bfd9f0) with ink text.
- **Do** set every UI and copy word in Jost, and use Jost Italic at the surrounding weight for the single stressed word.
- **Do** keep Annotation Hot Pink (#fd259a) for handwriting, drawn arrows, circles, and the shutter focus ring.
- **Do** give buttons the 3px ink outline and the 4px hard offset shadow, and let the shadow move with hover and press.
- **Do** use Camera Chrome Yellow (#ffd60a) for anything that belongs to the phone's own interface.
- **Do** show the robot as a photoreal matte-white studio robot in the selfie situation: phone, yesterday's print, the circled change.
- **Do** build robot plates from `art/source` and `art/masks` with `art/build-plates.sh`, and keep every difference between yesterday and today to the one masked plate.

### Don't:
- **Don't** use hot pink as a brand colour: no pink buttons, bands, logos or headings.
- **Don't** put the hard offset shadow on anything that isn't pressable; thumbnails and frames get the outline only.
- **Don't** set headings, buttons, or paragraphs in Neucha, and don't bring back Bagel Fat One or Andika.
- **Don't** show the robot alone as a mascot, or draw it in a cute, anime, or cartoon style.
- **Don't** add gradients, textures, or a second tint to the sky ground.
- **Don't** let the page drift from Primer's ink and muted greys for text; the app it sits beside is stock GitHub Primer.
