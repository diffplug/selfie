// Written by cli/scripts/generate-storybook-fixtures.ts.
import type { PixelDiff } from "../../shared/api.ts";

export const HASHES = {
  "golden": "8eb1cb73427e1b80972d624131d556027ed0ac32b5e4553c60ff822b728f4e9d",
  "changed": "47140e3cf57f82ec71b40fd6002a275d9bc0bfb34ffa9bbd4edd3c1085fff47c",
  "tallGolden": "cfd1ea367d623767479ee4b062368b182620612e5623718d03553c64f717b095",
  "tallChanged": "9cdf8ff0beb7131502fac4253dae398855a143c2c6e0596c9354480176f5ed32",
  "taller": "d89e98200799b28d2440028144a726c4d4e78ede9c28283e9780b163fff3d44e",
  "spaced": "a6056a68182dd0be036bced4470839576418ae3b49b38942f9a1399cfb8be63e",
  "moved": "068872dfe6b9fac475faa749428bd8ec99cb31d81284b648a3ae505e2856c5aa",
  "mixed": "bad91b4a65fc421de386316d2ad07c858633744ee15084f65a88fc03a93d4f13",
  "several": "94fee94adbb739e3755e54b01fc0a7a08680767cc405c855a7aba98f85105b7f",
  "long": "62ae56a8842fde9efaac85e58f0c8ee109488c013601100f65d0e9218f0c70bd",
  "pushed": "737720ef7fe26981023bb5ee33fddbdd29f3dea1e73ebeba3b6bda885ad15847",
  "fresh": "d0fb32554529d88cb72f7affb05a1919dc738fc2b84bd677a801359f5c77a80e",
  "gone": "d54e4ae5605f70ee991d9899a4e7e55c7c6fe858b5d91960ef7a8bc94e3a54ad",
  "doubleGolden": "91c8f702c3414b0463f34b1b6368ef446ed7d1ebd877f7998fdf9edd466bc791",
  "doubleChanged": "090df5767ccac5a79cefc10cedcb44758eef68420f0c8bd9fd5baa4d8aad02ca"
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
  "several-golden": {
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
      },
      {
        "current": {
          "x": 32,
          "y": 852,
          "width": 1136,
          "height": 16
        },
        "golden": {
          "x": 32,
          "y": 852,
          "width": 1136,
          "height": 16
        },
        "kind": "changed",
        "changedPixels": 18176,
        "moved": []
      }
    ],
    "changedPixels": 18176,
    "movedPixels": 5760,
    "spacingPixels": 0,
    "totalPixels": 1080000,
    "boundingBox": {
      "x": 32,
      "y": 852,
      "width": 1136,
      "height": 16
    },
    "firstChanged": {
      "x": 32,
      "y": 852
    },
    "maxChannelDelta": 199
  },
  "pushed-long": {
    "current": {
      "width": 1200,
      "height": 1430
    },
    "golden": {
      "width": 1200,
      "height": 1400
    },
    "regions": [
      {
        "current": {
          "x": 0,
          "y": 88,
          "width": 1200,
          "height": 30
        },
        "golden": {
          "x": 0,
          "y": 88,
          "width": 1200,
          "height": 0
        },
        "kind": "spacing",
        "changedPixels": 0,
        "moved": []
      },
      {
        "current": {
          "x": 32,
          "y": 480,
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
    "spacingPixels": 36000,
    "totalPixels": 1716000,
    "boundingBox": {
      "x": 32,
      "y": 480,
      "width": 160,
      "height": 36
    },
    "firstChanged": {
      "x": 32,
      "y": 480
    },
    "maxChannelDelta": 163
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
