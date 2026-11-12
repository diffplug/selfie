#!/bin/sh
# Rebuilds the hero's cutouts in public/img/plates from art/source and art/masks.
# Edit a mask (white = belongs to that layer), then run: sh art/build-plates.sh
# Needs ImageMagick 7 (magick) and cwebp.
set -eu
cd "$(dirname "$0")/.."
src=art/source
masks=art/masks
out=public/img/plates
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Codex's image tool leaves solid areas at alpha 253. Raise only values >= 250 to 255.
opaque() { magick "$1" -channel A -fx 'u>=0.9803?1:u' +channel "$2"; }

# The arm, cut into the still hand and the two thumb segments, all aligned on the same canvas.
opaque "$src/arm.png" "$tmp/arm.png"
magick "$tmp/arm.png" -alpha extract "$tmp/alpha.png"
magick "$tmp/alpha.png" "$masks/thumb-tip.png" -compose multiply -composite "$tmp/tip-alpha.png"
magick "$tmp/alpha.png" \( "$masks/thumb-tip.png" -negate \) -compose multiply -composite \
  "$masks/thumb-base.png" -compose multiply -composite "$tmp/base-alpha.png"
magick "$tmp/alpha.png" \( "$masks/thumb-tip.png" -negate \) -compose multiply -composite \
  \( "$masks/thumb-base.png" -negate \) -compose multiply -composite "$tmp/hand-alpha.png"
magick "$tmp/arm.png" -alpha off "$tmp/hand-alpha.png" -compose CopyOpacity -composite "$out/arm-hand.png"
# The crops below set where each segment sits; hero.css and hero.js assume these offsets.
magick "$tmp/arm.png" -alpha off "$tmp/base-alpha.png" -compose CopyOpacity -composite -crop 340x340+655+395 +repage "$out/arm-thumb-base.png"
magick "$tmp/arm.png" -alpha off "$tmp/tip-alpha.png" -compose CopyOpacity -composite -crop 260x210+480+410 +repage "$out/arm-thumb.png"

# Today's selfie, with the pink circle from the marker drawing around the head plate.
opaque "$src/marker.png" "$tmp/marker.png"
magick "$tmp/marker.png" -crop 585x528+49+322 +repage -resize 400x340\! "$tmp/circle.png"
magick "$src/today.png" "$tmp/circle.png" -geometry +261+152 -compose over -composite "$out/today.png"

# Yesterday's selfie: the same photo with only the head plate turned red, and no circle.
magick "$src/today.png" -modulate 100,105,175 "$tmp/red.png"
magick "$src/today.png" "$tmp/red.png" "$masks/head-plate.png" -compose over -composite \
  -crop 1024x1052+0+40 +repage "$out/yesterday.png"

for f in today yesterday; do cwebp -quiet -q 84 "$out/$f.png" -o "$out/$f.webp"; done
for f in arm-hand arm-thumb-base arm-thumb; do cwebp -quiet -q 86 -alpha_q 100 -exact "$out/$f.png" -o "$out/$f.webp"; done
echo "Rebuilt $out. Check the result at http://localhost:8788/ with pnpm dev."
