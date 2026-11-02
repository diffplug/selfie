// Written by cli/scripts/generate-storybook-fixtures.ts.
import type { PixelDiff } from "../../shared/api.ts";

export const HASHES = {
  "golden": "e1278d9df1d60906ce12331f230ba831afad494c66687616da53f9cbd0bbc107",
  "changed": "aee725c3c1ea6a3a1488ba88a140e15b825fc08cce8a45c649f45713d7f66a30",
  "tallGolden": "cb2550d256f91d5245e2e07e4ae73a80e31193a005421f5f69b797bfd98589f7",
  "tallChanged": "f1b7fb62f358cb4e33f0a97caa8fb5cbf000442c8ba6b32faec0699d95cc1908",
  "taller": "7675075ddbea8f5c9a348013044d8c7be7f507ea58c10f73a9b87adebeb0a678",
  "spaced": "360d5e7c529db03c551cac768baf98b7879cc8e7ee9baa84ec5530575d4de855",
  "moved": "821a335703480460ff5f7dbb52545147b4fe020d860b231453cafbf3fb6e2816",
  "mixed": "c6780a212f0216ee2b111b224b1d5a06f803438f22ee16f786d73c5c7577ca3e",
  "fresh": "0e99b436fdc9928c9bed9987a3286bcce4c9e04c0a9707982f08e170b2b3e933",
  "gone": "c438ad9dc877e21f9f0d53290f6b484bd36507c98c3809cfeaff3d959a3856a8",
  "doubleGolden": "f683741c6f371fc3a87d953dfd3d71d8a2ac05d21f302db66d69280a0eae232a",
  "doubleChanged": "647cf5fde5bf48f2bd9b99d93445e4c670cb868de1f28a580a983f6695661dbf"
} as const;

export const PIXEL_DIFFS = {
  "changed-golden": {
    "current": {
      "width": 1200,
      "height": 900
    },
    "golden": {
      "width": 1200,
      "height": 900
    },
    "regions": [
      {
        "current": {
          "x": 32,
          "y": 450,
          "width": 160,
          "height": 36
        },
        "golden": {
          "x": 32,
          "y": 450,
          "width": 160,
          "height": 36
        },
        "kind": "changed",
        "changedPixels": 5760,
        "moved": []
      }
    ],
    "changedPixels": 5760,
    "movedPixels": 0,
    "spacingPixels": 0,
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
  "tallChanged-tallGolden": {
    "current": {
      "width": 1200,
      "height": 2400
    },
    "golden": {
      "width": 1200,
      "height": 2400
    },
    "regions": [
      {
        "current": {
          "x": 32,
          "y": 2340,
          "width": 1136,
          "height": 36
        },
        "golden": {
          "x": 32,
          "y": 2340,
          "width": 1136,
          "height": 36
        },
        "kind": "changed",
        "changedPixels": 21376,
        "moved": []
      }
    ],
    "changedPixels": 21376,
    "movedPixels": 0,
    "spacingPixels": 0,
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
  "taller-golden": {
    "current": {
      "width": 1200,
      "height": 990
    },
    "golden": {
      "width": 1200,
      "height": 900
    },
    "regions": [
      {
        "current": {
          "x": 0,
          "y": 434,
          "width": 1200,
          "height": 90
        },
        "golden": {
          "x": 0,
          "y": 434,
          "width": 1200,
          "height": 0
        },
        "kind": "changed",
        "changedPixels": 88800,
        "moved": []
      }
    ],
    "changedPixels": 88800,
    "movedPixels": 0,
    "spacingPixels": 19200,
    "totalPixels": 1188000,
    "boundingBox": {
      "x": 0,
      "y": 434,
      "width": 1200,
      "height": 74
    },
    "firstChanged": {
      "x": 0,
      "y": 434
    },
    "maxChannelDelta": 0
  },
  "golden-taller": {
    "current": {
      "width": 1200,
      "height": 900
    },
    "golden": {
      "width": 1200,
      "height": 990
    },
    "regions": [
      {
        "current": {
          "x": 0,
          "y": 434,
          "width": 1200,
          "height": 0
        },
        "golden": {
          "x": 0,
          "y": 434,
          "width": 1200,
          "height": 90
        },
        "kind": "changed",
        "changedPixels": 88800,
        "moved": []
      }
    ],
    "changedPixels": 88800,
    "movedPixels": 0,
    "spacingPixels": 19200,
    "totalPixels": 1188000,
    "boundingBox": {
      "x": 0,
      "y": 434,
      "width": 1200,
      "height": 1
    },
    "firstChanged": {
      "x": 0,
      "y": 434
    },
    "maxChannelDelta": 0
  },
  "spaced-golden": {
    "current": {
      "width": 1200,
      "height": 930
    },
    "golden": {
      "width": 1200,
      "height": 900
    },
    "regions": [
      {
        "current": {
          "x": 0,
          "y": 164,
          "width": 1200,
          "height": 30
        },
        "golden": {
          "x": 0,
          "y": 164,
          "width": 1200,
          "height": 0
        },
        "kind": "spacing",
        "changedPixels": 0,
        "moved": []
      }
    ],
    "changedPixels": 0,
    "movedPixels": 0,
    "spacingPixels": 36000,
    "totalPixels": 1116000,
    "boundingBox": {
      "x": 0,
      "y": 164,
      "width": 1200,
      "height": 30
    },
    "firstChanged": {
      "x": 0,
      "y": 164
    },
    "maxChannelDelta": 0
  },
  "moved-golden": {
    "current": {
      "width": 1200,
      "height": 900
    },
    "golden": {
      "width": 1200,
      "height": 900
    },
    "regions": [
      {
        "current": {
          "x": 32,
          "y": 450,
          "width": 160,
          "height": 36
        },
        "golden": {
          "x": 32,
          "y": 450,
          "width": 160,
          "height": 36
        },
        "kind": "moved",
        "changedPixels": 0,
        "moved": []
      },
      {
        "current": {
          "x": 600,
          "y": 450,
          "width": 160,
          "height": 36
        },
        "golden": {
          "x": 600,
          "y": 450,
          "width": 160,
          "height": 36
        },
        "kind": "moved",
        "changedPixels": 0,
        "moved": [
          {
            "current": {
              "x": 600,
              "y": 450,
              "width": 160,
              "height": 36
            },
            "golden": {
              "x": 32,
              "y": 450,
              "width": 160,
              "height": 36
            }
          }
        ]
      }
    ],
    "changedPixels": 0,
    "movedPixels": 5760,
    "spacingPixels": 0,
    "totalPixels": 1080000,
    "boundingBox": {
      "x": 32,
      "y": 450,
      "width": 728,
      "height": 36
    },
    "firstChanged": {
      "x": 32,
      "y": 450
    },
    "maxChannelDelta": 0
  },
  "mixed-golden": {
    "current": {
      "width": 1200,
      "height": 930
    },
    "golden": {
      "width": 1200,
      "height": 900
    },
    "regions": [
      {
        "current": {
          "x": 0,
          "y": 164,
          "width": 1200,
          "height": 734
        },
        "golden": {
          "x": 0,
          "y": 164,
          "width": 1200,
          "height": 704
        },
        "kind": "changed",
        "changedPixels": 18176,
        "moved": [
          {
            "current": {
              "x": 600,
              "y": 480,
              "width": 160,
              "height": 36
            },
            "golden": {
              "x": 32,
              "y": 450,
              "width": 160,
              "height": 36
            }
          }
        ]
      }
    ],
    "changedPixels": 18176,
    "movedPixels": 5760,
    "spacingPixels": 36000,
    "totalPixels": 1116000,
    "boundingBox": {
      "x": 32,
      "y": 882,
      "width": 1136,
      "height": 16
    },
    "firstChanged": {
      "x": 32,
      "y": 882
    },
    "maxChannelDelta": 199
  },
  "doubleChanged-doubleGolden": {
    "current": {
      "width": 2400,
      "height": 1800
    },
    "golden": {
      "width": 2400,
      "height": 1800
    },
    "regions": [
      {
        "current": {
          "x": 64,
          "y": 900,
          "width": 320,
          "height": 72
        },
        "golden": {
          "x": 64,
          "y": 900,
          "width": 320,
          "height": 72
        },
        "kind": "changed",
        "changedPixels": 23040,
        "moved": []
      }
    ],
    "changedPixels": 23040,
    "movedPixels": 0,
    "spacingPixels": 0,
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
