# Hero art sources

`public/img/plates/` is built from these files by `sh art/build-plates.sh`. Don't edit the plates directly: edit a mask here and rerun the script.

## source/

Untouched output from Codex's image tool, with the prompts in the `.json` sidecars.

- `arm.png`: the robot's forearm and hand, transparent. The tool leaves solid areas at alpha 253, so the script raises alpha of 250 and above to 255.
- `today.png`: today's selfie, before the pink circle.
- `marker.png`: the pink marker strokes. The script takes only the circle; the arrow on the page is drawn in code.

## masks/

8-bit grayscale, the same size as the image they cut. White belongs to the layer.

- `thumb-tip.png` and `thumb-base.png`, on `arm.png`: the two thumb segments. The hand is whatever neither mask covers. The segments rotate in `public/hero.js` about the joints it names (base joint 960,600 and knuckle 713,510, in arm pixels), so keep each cut near its joint.
- `head-plate.png`, on `today.png`: the plate that turns red in yesterday's photo. Nothing else may differ between the two photos.

The crop offsets in the script (`340x340+655+395` for the base, `260x210+480+410` for the tip) are also in `public/style.css`. Change them together.
