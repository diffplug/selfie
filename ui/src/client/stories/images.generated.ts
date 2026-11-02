// Written by cli/scripts/generate-storybook-fixtures.ts.
import type { PixelDiff } from "../../shared/api.ts";

export const HASHES = {
  "golden": "e1278d9df1d60906ce12331f230ba831afad494c66687616da53f9cbd0bbc107",
  "changed": "aee725c3c1ea6a3a1488ba88a140e15b825fc08cce8a45c649f45713d7f66a30",
  "tallGolden": "cb2550d256f91d5245e2e07e4ae73a80e31193a005421f5f69b797bfd98589f7",
  "tallChanged": "f1b7fb62f358cb4e33f0a97caa8fb5cbf000442c8ba6b32faec0699d95cc1908",
  "taller": "7675075ddbea8f5c9a348013044d8c7be7f507ea58c10f73a9b87adebeb0a678",
  "fresh": "0e99b436fdc9928c9bed9987a3286bcce4c9e04c0a9707982f08e170b2b3e933",
  "gone": "c438ad9dc877e21f9f0d53290f6b484bd36507c98c3809cfeaff3d959a3856a8",
  "doubleGolden": "f683741c6f371fc3a87d953dfd3d71d8a2ac05d21f302db66d69280a0eae232a",
  "doubleChanged": "647cf5fde5bf48f2bd9b99d93445e4c670cb868de1f28a580a983f6695661dbf"
} as const;

export const PIXEL_DIFFS = {
  "changed": {
    "kind": "pixels",
    "changedPixels": 5760,
    "totalPixels": 1080000,
    "boundingBox": {
      "x": 32,
      "y": 450,
      "width": 160,
      "height": 36
    },
    "firstChanged": {
      "x": 32,
      "y": 450
    },
    "maxChannelDelta": 163
  },
  "tallChanged": {
    "kind": "pixels",
    "changedPixels": 21376,
    "totalPixels": 2880000,
    "boundingBox": {
      "x": 32,
      "y": 2340,
      "width": 1136,
      "height": 36
    },
    "firstChanged": {
      "x": 32,
      "y": 2340
    },
    "maxChannelDelta": 199
  },
  "taller": {
    "kind": "size-differs",
    "current": {
      "width": 1200,
      "height": 990
    },
    "golden": {
      "width": 1200,
      "height": 900
    }
  },
  "doubleChanged": {
    "kind": "pixels",
    "changedPixels": 23040,
    "totalPixels": 4320000,
    "boundingBox": {
      "x": 64,
      "y": 900,
      "width": 320,
      "height": 72
    },
    "firstChanged": {
      "x": 64,
      "y": 900
    },
    "maxChannelDelta": 163
  }
} satisfies Record<string, PixelDiff>;
