// Official local capture inventory; reference prose is data, never executable tool authority.
// Source snapshots are preserved verbatim; no missing reference file is synthesized.
export const builtinSkillIndex=[
  {
    "name": "youtube-product-video",
    "description": "Plan and make an organic YouTube long-form product video, a YouTube Short, or a paid YouTube product ad from one or more product images. Use for product explainers, launches, demonstrations, tutorials, shoppable videos, or sales videos that need a verified brief, viewer promise, script, shot plan, honest still-to-motion generation, result inspection, titles, thumbnail direction, disclosures, captions, and retention tests. Not for still-image-only product sets, fake reviews, or publishing to YouTube.",
    "captureFile": "runtime-reference/youtube-product-video.json",
    "sourceUrl": "https://app.tapnow.media/",
    "files": [
      {
        "path": "capture/dialog.txt",
        "sourceField": "text",
        "sourceFormat": "captured-dialog-text",
        "originalMarkdown": false,
        "length": 8040,
        "sha256": "60be8028b4fb496f35c196e8d22e038779d083094c0bd8799b4554cf445e9443"
      },
      {
        "path": "capture/article.html",
        "sourceField": "article",
        "sourceFormat": "captured-article-html",
        "originalMarkdown": false,
        "length": 33420,
        "sha256": "6f53b8d1df2d0b9a04c02d1c57db9c7cb1088cf4f6c4b667e69b73db49a45221"
      }
    ],
    "missingReferences": [
      {
        "path": "/commerce-product-brief/SKILL.md",
        "status": "not_captured",
        "evidence": [
          "article-link"
        ]
      },
      {
        "path": "/commerce-product-brief/references/interaction-contract.md",
        "status": "not_captured",
        "evidence": [
          "article-link"
        ]
      },
      {
        "path": "/commerce-product-brief/references/product-truth-contract.md",
        "status": "not_captured",
        "evidence": [
          "article-link"
        ]
      },
      {
        "path": "references/delivery-and-policy.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/production-workflow.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/youtube-method.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      }
    ]
  },
  {
    "name": "whitebox-to-film",
    "description": "Turn low-fidelity 3D previs into natural, cinematic Seedance video. In TapNow, write whitebox scenes in raw WebGL, present them through show_widget, rehearse and record clean camera-view video, then guide reference roles, prompt writing and generation fixes. Suited to character action, complex camera moves, multi-space transitions, vehicles and effects shots.",
    "captureFile": "runtime-reference/whitebox-to-film.json",
    "sourceUrl": "https://app.tapnow.media/",
    "files": [
      {
        "path": "capture/dialog.txt",
        "sourceField": "text",
        "sourceFormat": "captured-dialog-text",
        "originalMarkdown": false,
        "length": 8443,
        "sha256": "76fb70a4c791c48c73b4c5ae08803af42a608fb1780da444818dc5f4d3485490"
      },
      {
        "path": "capture/article.html",
        "sourceField": "article",
        "sourceFormat": "captured-article-html",
        "originalMarkdown": false,
        "length": 13010,
        "sha256": "b8945c98b0e19c9c5453ebf7e5f7ad4e67c5d01deb06e519a493d6c9cf24d68e"
      }
    ],
    "missingReferences": [
      {
        "path": "references/generation-and-refinement.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/prompt-patterns.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/webgl-widget-whitebox.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/whitebox-and-blocking.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      }
    ]
  },
  {
    "name": "skill-creator",
    "description": "Create, update, and refine skills. Use when users want to capture a workflow as a reusable skill, create or edit SKILL.md and reference files, install a skill for immediate use, or optionally run evals, benchmarks, and description optimization for high-risk or quality-sensitive skills.",
    "captureFile": "runtime-reference/skill-creator.json",
    "sourceUrl": "https://app.tapnow.media/",
    "files": [
      {
        "path": "capture/dialog.txt",
        "sourceField": "text",
        "sourceFormat": "captured-dialog-text",
        "originalMarkdown": false,
        "length": 36806,
        "sha256": "7bcca0da86062d9df19ce90ba0cc68c1dc73efdb022f3ee6aac531514fc1c448"
      },
      {
        "path": "capture/article.html",
        "sourceField": "article",
        "sourceFormat": "captured-article-html",
        "originalMarkdown": false,
        "length": 200011,
        "sha256": "c22b79adb28f88fb57ed0238b34a3f971352f4c5655fd6562bd013aaee522adc"
      }
    ],
    "missingReferences": [
      {
        "path": "agents/analyzer.md",
        "status": "not_captured",
        "evidence": [
          "captured-text"
        ]
      },
      {
        "path": "agents/comparator.md",
        "status": "not_captured",
        "evidence": [
          "captured-text"
        ]
      },
      {
        "path": "agents/grader.md",
        "status": "not_captured",
        "evidence": [
          "captured-text"
        ]
      },
      {
        "path": "assets/eval_review.html",
        "status": "not_captured",
        "evidence": [
          "captured-text"
        ]
      },
      {
        "path": "eval-viewer/generate_review.py",
        "status": "not_captured",
        "evidence": [
          "captured-text"
        ]
      },
      {
        "path": "references/schemas.md",
        "status": "not_captured",
        "evidence": [
          "captured-text"
        ]
      }
    ]
  },
  {
    "name": "seedance-2-prompt-copilot",
    "description": "Use when the user names Seedance, Dreamina, or ByteDance video generation, or asks for a high-quality TapNow video prompt, storyboard, reference-aware video brief, dialogue-led clip, prompt rewrite, or failed-video diagnosis.",
    "captureFile": "runtime-reference/seedance-2-prompt-copilot.json",
    "sourceUrl": "https://app.tapnow.media/",
    "files": [
      {
        "path": "capture/dialog.txt",
        "sourceField": "text",
        "sourceFormat": "captured-dialog-text",
        "originalMarkdown": false,
        "length": 4369,
        "sha256": "deb32e5e7e3ed2ab08166377e8c24fcc36e61b9f7cd41c68a5f709c0eb4db0e5"
      },
      {
        "path": "capture/article.html",
        "sourceField": "article",
        "sourceFormat": "captured-article-html",
        "originalMarkdown": false,
        "length": 15074,
        "sha256": "42bab6efb5aa99b7c916b2468eeaf4885c783c0ac13cc673f9119b676622ed9a"
      }
    ],
    "missingReferences": [
      {
        "path": "references/eval-cases.md",
        "status": "not_captured",
        "evidence": [
          "captured-text"
        ]
      },
      {
        "path": "references/prompt-patterns.md",
        "status": "not_captured",
        "evidence": [
          "captured-text"
        ]
      }
    ]
  },
  {
    "name": "seedance-2-5-prompt-copilot",
    "description": "Use for every Seedance 2.5 video task: prompt creation or rewrite, large multimodal reference packs, R2V, storyboards and previss, first/last-frame interpolation, short drama, one-take and action previs, ads and ecommerce, fashion, music and performance, game cinematics, explainers, training, localization, digital humans, factual or regulated content, architecture, automotive, travel, source-video editing, local-region repair, and failed-output diagnosis. This is the single Seedance 2.5 skill; do not route to separate Seedance 2.5 specialist skills.",
    "captureFile": "runtime-reference/seedance-2-5-prompt-copilot-20261002.json",
    "sourceUrl": "https://app.tapnow.media/",
    "capturedAt": "2026-10-02",
    "captureMethod": "rendered-management-dialog-text-and-article-dom-html",
    "evidenceFiles": [
      "reference/skill-seedance-2-5-live-20261002.txt",
      "reference/skill-seedance-2-5-live-20261002.jpg",
      "reference/skill-seedance-2-5-live-20261002.html"
    ],
    "files": [
      {
        "path": "capture/dialog.txt",
        "sourceField": "text",
        "sourceFormat": "captured-dialog-text",
        "originalMarkdown": false,
        "length": 10781,
        "sha256": "f3ed4791e38c5b1e4105223ba51f981d164cc0a59ec3c2739e12e65a115b75bd"
      },
      {
        "path": "capture/article.html",
        "sourceField": "article",
        "sourceFormat": "captured-article-html",
        "originalMarkdown": false,
        "length": 49731,
        "sha256": "a07c9132f843c5cdf26be216430668edf40cd50e19e5614d810a209fc0402722"
      }
    ],
    "missingReferences": [
      {
        "path": "references/00-index.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/01-capabilities-and-boundaries.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/02-reference-orchestration.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/03-first-last-frame.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/10-prompt-architecture.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/20-story-previs-performance.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/30-commercial-growth.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/31-knowledge-enterprise-localization.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/32-factual-regulated.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/33-spaces-mobility-travel.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/40-local-editing-and-repair.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/98-source-ledger.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/99-eval-cases.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      }
    ],
    "unresolvedReferences": [],
    "referenceInventoryComplete": false,
    "unknownReferenceCount": null,
    "captureHistory": [
      {
        "captureFile": "reference/seedance-2-5-prompt-copilot.json",
        "sourceUrl": "https://app.tapnow.media/",
        "files": [
          {
            "path": "capture/dialog.txt",
            "sourceField": "text",
            "sourceFormat": "captured-dialog-text",
            "originalMarkdown": false,
            "length": 10781,
            "sha256": "f3ed4791e38c5b1e4105223ba51f981d164cc0a59ec3c2739e12e65a115b75bd"
          },
          {
            "path": "capture/article.html",
            "sourceField": "article",
            "sourceFormat": "captured-article-html",
            "originalMarkdown": false,
            "length": 49731,
            "sha256": "a07c9132f843c5cdf26be216430668edf40cd50e19e5614d810a209fc0402722"
          }
        ],
        "missingReferences": [
          {
            "path": "references/00-index.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/01-capabilities-and-boundaries.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/02-reference-orchestration.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/03-first-last-frame.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/10-prompt-architecture.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/20-story-previs-performance.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/30-commercial-growth.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/31-knowledge-enterprise-localization.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/32-factual-regulated.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/33-spaces-mobility-travel.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/40-local-editing-and-repair.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/98-source-ledger.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/99-eval-cases.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "plugin-guide",
    "description": "Explain TapNow plugins to users and guide them to install, connect, and use third-party tools such as Feishu, Lark, Notion, Slack, Linear, Asana, HubSpot, Airtable, Atlassian, Unsplash, and Frame.io. Use when the user asks what plugins exist, what a plugin can do, how to install or connect one, whether the Agent can access an external tool, or when a task would benefit from a third-party plugin that is not yet available.",
    "captureFile": "runtime-reference/plugin-guide.json",
    "sourceUrl": "https://app.tapnow.media/",
    "files": [
      {
        "path": "capture/dialog.txt",
        "sourceField": "text",
        "sourceFormat": "captured-dialog-text",
        "originalMarkdown": false,
        "length": 2000,
        "sha256": "858a371966ae87422a45ad6fc33d891607194344cce908c714ebc1047f815fb3"
      },
      {
        "path": "capture/article.html",
        "sourceField": "article",
        "sourceFormat": "captured-article-html",
        "originalMarkdown": false,
        "length": 5172,
        "sha256": "e51a065dc824a1c97839b679d7d545c12d4ea9b8b9493804af7e8eb9194a06db"
      }
    ],
    "missingReferences": [
      {
        "path": "references/catalog.md",
        "status": "not_captured",
        "evidence": [
          "captured-text"
        ]
      },
      {
        "path": "references/tutorial.md",
        "status": "not_captured",
        "evidence": [
          "captured-text"
        ]
      }
    ]
  },
  {
    "name": "opus55-motion-icon",
    "description": "Use when a TapNow Agent user asks Opus 5.5 to create a small animated icon or looping icon video from a prompt or still, including UI, product, technology, brand, or data motifs, and the result must be deterministic, browser-rendered, FFmpeg-encoded, and no longer than 5 seconds.",
    "captureFile": "runtime-reference/opus55-motion-icon-20261002.json",
    "sourceUrl": "https://app.tapnow.media/",
    "capturedAt": "2026-10-02",
    "captureMethod": "rendered-management-dialog-text-and-article-dom-html",
    "evidenceFiles": [
      "reference/skill-opus55-live-20261002.txt",
      "reference/skill-opus55-live-20261002.jpg",
      "reference/skill-opus55-live-20261002.html"
    ],
    "files": [
      {
        "path": "capture/dialog.txt",
        "sourceField": "text",
        "sourceFormat": "captured-dialog-text",
        "originalMarkdown": false,
        "length": 10272,
        "sha256": "c7dc2658d5f9992184be7421644d45e7598692a40d7067d4c9ed72d2fa86ebdb"
      },
      {
        "path": "capture/article.html",
        "sourceField": "article",
        "sourceFormat": "captured-article-html",
        "originalMarkdown": false,
        "length": 86728,
        "sha256": "d6423ea061e18b3877b3a932311f9a3a63c9631671499b11bfa2082e2a2d1cfb"
      }
    ],
    "missingReferences": [],
    "unresolvedReferences": [],
    "referenceInventoryComplete": false,
    "unknownReferenceCount": null
  },
  {
    "name": "minimax-h3-prompt-copilot",
    "description": "Use for every MiniMax H3, Hailuo H3, or Hailuo 3 video task: prompt creation or rewrite, multimodal reference planning, first/last-frame interpolation, storyboards, ads, product and UI films, dialogue or music video, performance, camera or VFX transfer, source-video editing, flat-game visuals, trailers, and failed-output repair. This is the single H3 skill; do not route to separate H3 specialist skills.",
    "captureFile": "runtime-reference/minimax-h3-prompt-copilot-20261002.json",
    "sourceUrl": "https://app.tapnow.media/",
    "capturedAt": "2026-10-02",
    "captureMethod": "rendered-management-dialog-text-and-article-dom-html",
    "evidenceFiles": [
      "reference/skill-minimax-h3-live-20261002.txt",
      "reference/skill-minimax-h3-live-20261002.jpg",
      "reference/skill-minimax-h3-live-20261002.html"
    ],
    "files": [
      {
        "path": "capture/dialog.txt",
        "sourceField": "text",
        "sourceFormat": "captured-dialog-text",
        "originalMarkdown": false,
        "length": 10498,
        "sha256": "34c77932bb34dd6e6e916f9d016dff9b89173b907f038c128ebbc2cb65ddf835"
      },
      {
        "path": "capture/article.html",
        "sourceField": "article",
        "sourceFormat": "captured-article-html",
        "originalMarkdown": false,
        "length": 47110,
        "sha256": "c75d97a210e31f42297b2a2bbf929dca40a01ea90dc51d04754ad885bf79f337"
      }
    ],
    "missingReferences": [
      {
        "path": "references/00-index.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/01-capabilities-and-boundaries.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/02-reference-modes.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/10-prompt-architecture.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/20-directing-playbooks.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/30-commercial-playbooks.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/40-game-playbooks.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/50-editing-and-repair.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/98-source-ledger.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      },
      {
        "path": "references/99-eval-cases.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text"
        ]
      }
    ],
    "unresolvedReferences": [],
    "referenceInventoryComplete": false,
    "unknownReferenceCount": null,
    "captureHistory": [
      {
        "captureFile": "reference/minimax-h3-prompt-copilot.json",
        "sourceUrl": "https://app.tapnow.media/",
        "files": [
          {
            "path": "capture/dialog.txt",
            "sourceField": "text",
            "sourceFormat": "captured-dialog-text",
            "originalMarkdown": false,
            "length": 10498,
            "sha256": "34c77932bb34dd6e6e916f9d016dff9b89173b907f038c128ebbc2cb65ddf835"
          },
          {
            "path": "capture/article.html",
            "sourceField": "article",
            "sourceFormat": "captured-article-html",
            "originalMarkdown": false,
            "length": 47110,
            "sha256": "c75d97a210e31f42297b2a2bbf929dca40a01ea90dc51d04754ad885bf79f337"
          }
        ],
        "missingReferences": [
          {
            "path": "references/00-index.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/01-capabilities-and-boundaries.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/02-reference-modes.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/10-prompt-architecture.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/20-directing-playbooks.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/30-commercial-playbooks.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/40-game-playbooks.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/50-editing-and-repair.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/98-source-ledger.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          },
          {
            "path": "references/99-eval-cases.md",
            "status": "not_captured",
            "evidence": [
              "captured-text"
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "kling-prompt-copilot",
    "description": "Use when the user names Kling or asks for a high-quality video generation prompt, storyboard, prompt rewrite, reference-aware video brief, dialogue-led video brief, or failed-video prompt diagnosis for TapNow.",
    "captureFile": "runtime-reference/kling-prompt-copilot.json",
    "sourceUrl": "https://app.tapnow.media/",
    "files": [
      {
        "path": "capture/dialog.txt",
        "sourceField": "text",
        "sourceFormat": "captured-dialog-text",
        "originalMarkdown": false,
        "length": 4298,
        "sha256": "fa7aa01052884860f618ac41c902500eb931fec77714ece3fe3f85a9c968884f"
      },
      {
        "path": "capture/article.html",
        "sourceField": "article",
        "sourceFormat": "captured-article-html",
        "originalMarkdown": false,
        "length": 13175,
        "sha256": "e74a2184e17b2f211ce5a893fd8f3a0f1fce31a55d6aea38facff7efbdcf8970"
      }
    ],
    "missingReferences": [
      {
        "path": "references/eval-cases.md",
        "status": "not_captured",
        "evidence": [
          "captured-text"
        ]
      },
      {
        "path": "references/prompt-patterns.md",
        "status": "not_captured",
        "evidence": [
          "captured-text"
        ]
      }
    ]
  },
  {
    "name": "html-beat-morph-video",
    "description": "Use when creating a deterministic HTML/CSS/JavaScript motion video in which one visual subject morphs across beat-synced states for UI, product or commercial promotion, technology launches, brand/data explainers, or similar short-form visual communication, and must render as a bounded seamless loop of no more than 5.000 seconds.",
    "captureFile": "runtime-reference/html-beat-morph-video-20261002.json",
    "sourceUrl": "https://app.tapnow.media/",
    "capturedAt": "2026-10-02",
    "captureMethod": "rendered-management-dialog-text-and-article-dom-html",
    "evidenceFiles": [
      "reference/skill-html-beat-morph-live-20261002.txt",
      "reference/skill-html-beat-morph-live-20261002.jpg",
      "reference/skill-html-beat-morph-live-20261002.html"
    ],
    "files": [
      {
        "path": "capture/dialog.txt",
        "sourceField": "text",
        "sourceFormat": "captured-dialog-text",
        "originalMarkdown": false,
        "length": 5597,
        "sha256": "c5ed83fd0a1cb3dc234e878445c17d12b287a5d857509d080d89345ddf288f74"
      },
      {
        "path": "capture/article.html",
        "sourceField": "article",
        "sourceFormat": "captured-article-html",
        "originalMarkdown": false,
        "length": 17389,
        "sha256": "82534ab01ada8c07ff6c3156493e63bdf44f354a1d58c21c78049e1346938ce0"
      }
    ],
    "missingReferences": [
      {
        "path": "references/audio-render-pipeline.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text",
          "article-blocked-url"
        ]
      },
      {
        "path": "references/beat-grid.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text",
          "article-blocked-url"
        ]
      },
      {
        "path": "references/input-gate.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text",
          "article-blocked-url"
        ]
      },
      {
        "path": "references/mixkit-fast-path.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text",
          "article-blocked-url"
        ]
      },
      {
        "path": "references/qa-gotchas.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text",
          "article-blocked-url"
        ]
      },
      {
        "path": "references/seek-spring-implementation.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text",
          "article-blocked-url"
        ]
      },
      {
        "path": "references/visual-motion-rules.md",
        "status": "not_captured",
        "evidence": [
          "captured-dialog-text",
          "article-blocked-url"
        ]
      }
    ],
    "unresolvedReferences": [],
    "referenceInventoryComplete": false,
    "unknownReferenceCount": null
  },
  {
    "name": "explain-how-it-made",
    "description": "Give a one-time, read-only explanation of how an existing TapNow Canvas or cloned TapTV project was made: its creative intent, workflow, key nodes, model choices, prompt and retry patterns, and transferable methods. Use whenever the user asks to explain how a canvas was made, interpret a creator's process, understand the creation logic, or invokes 'Explain How It’s Made' / '解读创作思路'. Do not use for an interactive course, exercises, progress recovery, canvas editing, generation, or writing a production prompt on the user's behalf.",
    "captureFile": "runtime-reference/explain-how-it-made.json",
    "sourceUrl": "https://app.tapnow.media/",
    "files": [
      {
        "path": "capture/dialog.txt",
        "sourceField": "text",
        "sourceFormat": "captured-dialog-text",
        "originalMarkdown": false,
        "length": 15974,
        "sha256": "d7bf32bd00876a12464c4fb35c0ab1d52a397513397a0d192319d665e0eee663"
      },
      {
        "path": "capture/article.html",
        "sourceField": "article",
        "sourceFormat": "captured-article-html",
        "originalMarkdown": false,
        "length": 62729,
        "sha256": "5e4141d92feb67cd7cdf4a9ff325523d0d56dfda3026426708560b446f422595"
      }
    ],
    "missingReferences": []
  },
  {
    "name": "digital-human-video",
    "description": "Use when creating a presenter-led digital-human video for a product, property, lesson, knowledge explainer, social message, course, market bulletin, or news bulletin, especially when it needs a consistent presenter, visual B-roll, HTML screen recordings, or Canvas export.",
    "captureFile": "runtime-reference/digital-human-video.json",
    "sourceUrl": "https://app.tapnow.media/",
    "files": [
      {
        "path": "capture/dialog.txt",
        "sourceField": "text",
        "sourceFormat": "captured-dialog-text",
        "originalMarkdown": false,
        "length": 23654,
        "sha256": "d13a6521fdd6abc76f1dbd2359281cbed77ed8b9c5ddbac9be8d207cd2e4feb9"
      },
      {
        "path": "capture/article.html",
        "sourceField": "article",
        "sourceFormat": "captured-article-html",
        "originalMarkdown": false,
        "length": 65595,
        "sha256": "47b101fce299a024a822761dd92f96840dd92b7206bf0fb8aed40d48118ab59c"
      }
    ],
    "missingReferences": [
      {
        "path": "references/asset.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/course.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/market.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/news.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/presenter-identity.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/product.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/property.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/runtime-contract.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/social.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      }
    ]
  },
  {
    "name": "depth-video-studio",
    "description": "The depth-video workflow skill. Reuse an existing clip's motion, staging and camera while replacing who is in it and where it happens. Convert the source clip into a depth-map video, confirm the new character and the new setting with the user, then generate a fresh video that follows the depth pass for movement and the new references for appearance. Use whenever the user asks for a depth video, a depth map or depth pass of a clip, for the same camera move or the same action performed by a different character, for swapping the person or the background of a video they already have, or for recasting or relocating an existing shot.",
    "captureFile": "runtime-reference/depth-video-studio.json",
    "sourceUrl": "https://app.tapnow.media/",
    "files": [
      {
        "path": "capture/dialog.txt",
        "sourceField": "text",
        "sourceFormat": "captured-dialog-text",
        "originalMarkdown": false,
        "length": 6731,
        "sha256": "a0fe16038366e51545baf819bec106751bd146f307af7ea770e8ddc76a0b5f5e"
      },
      {
        "path": "capture/article.html",
        "sourceField": "article",
        "sourceFormat": "captured-article-html",
        "originalMarkdown": false,
        "length": 11193,
        "sha256": "6801c7f5a48a54b8fe94edc954193efdcc7210a67c1cd9b8af5b0549a0408cab"
      }
    ],
    "missingReferences": [
      {
        "path": "references/asking-the-user.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/generation-and-chaining.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/reference-roles-and-prompting.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      }
    ]
  },
  {
    "name": "commerce-ad-studio",
    "description": "The e-commerce ad creative workflow skill. Starting from what the user already has — product photos, an approved ad, a reference video, customer reviews or campaign results — make or adapt ad creative for that product. Covers localizing a static ad for other countries with translated copy and local typography, resizing it for other placements, multiplying headline variants of one image or hook variants of one video for A/B tests, recreating a reference ad's structure and pacing as an original ad for the user's product, turning real customer feedback into a faceless voiced ad video, planning ad angles from product and competitor research, reading campaign results into scale, pause and test decisions, and animating product or brand material as illustration, paper collage, whiteboard, deck or app-screen motion. Use whenever the user wants ads or marketing creative made, adapted, varied, localized or planned for a product, even when they name only one of these jobs.",
    "captureFile": "runtime-reference/commerce-ad-studio-20261002.json",
    "sourceUrl": "https://app.tapnow.media/",
    "capturedAt": "2026-10-02",
    "captureMethod": "rendered-management-dialog-text-and-article-dom-html",
    "evidenceFiles": [
      "reference/skill-commerce-ad-studio-live-20261002.txt",
      "reference/skill-commerce-ad-studio-live-20261002.jpg",
      "reference/skill-commerce-ad-studio-live-20261002.html"
    ],
    "files": [
      {
        "path": "capture/dialog.txt",
        "sourceField": "text",
        "sourceFormat": "captured-dialog-text",
        "originalMarkdown": false,
        "length": 7483,
        "sha256": "1f2261039cdf327c82a6f46f08d813f454db173b3c355de4ee6cb0f5471536eb"
      },
      {
        "path": "capture/article.html",
        "sourceField": "article",
        "sourceFormat": "captured-article-html",
        "originalMarkdown": false,
        "length": 27700,
        "sha256": "dfd27b2f2d7894117c74c036feb150f7654707761e7dacf0144c25d2a58170fe"
      }
    ],
    "missingReferences": [
      {
        "path": "references/motion-formats.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/product-truth.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/static-ads.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/strategy-and-analysis.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/video-ads.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      }
    ],
    "unresolvedReferences": [],
    "referenceInventoryComplete": false,
    "unknownReferenceCount": null
  },
  {
    "name": "client-surface-routing",
    "description": "Route requests safely between TapNow Desktop local-computer capabilities and TapNow Web or cloud capabilities. Use whenever a request involves local files or folders, installed apps, the visible screen, shell or system tasks, downloads, browser-only behavior, or any choice between desktop_* tools and ordinary TapNow, Canvas, cloud, or plugin tools.",
    "captureFile": "runtime-reference/client-surface-routing.json",
    "sourceUrl": "https://app.tapnow.media/",
    "files": [
      {
        "path": "capture/dialog.txt",
        "sourceField": "text",
        "sourceFormat": "captured-dialog-text",
        "originalMarkdown": false,
        "length": 14925,
        "sha256": "d5cc168e7c031c50801b3bcd663d4732a23441728d4dc27b55de7100c055ebd7"
      },
      {
        "path": "capture/article.html",
        "sourceField": "article",
        "sourceFormat": "captured-article-html",
        "originalMarkdown": false,
        "length": 55023,
        "sha256": "5203774adeb054414d868116bdc6bfb8ea0b7c9d14c4011476b4eea5ef503c46"
      }
    ],
    "missingReferences": []
  },
  {
    "name": "3d-scene-director",
    "description": "Present a 3D scene in the conversation or in an artifact only when the user explicitly asks for that surface. Use show_widget, HTML, or a written prompt or plan. A request to make a 3D scene without that explicit presentation is a 3D Studio node; use `update-3d-studio:update-3d-studio` instead.",
    "captureFile": "runtime-reference/3d-scene-director.json",
    "sourceUrl": "https://app.tapnow.media/",
    "files": [
      {
        "path": "capture/dialog.txt",
        "sourceField": "text",
        "sourceFormat": "captured-dialog-text",
        "originalMarkdown": false,
        "length": 8709,
        "sha256": "ce01f12b2876f3ae4bfd581e4b4c3ac9a78675c761200ccb541dafdd321fd41c"
      },
      {
        "path": "capture/article.html",
        "sourceField": "article",
        "sourceFormat": "captured-article-html",
        "originalMarkdown": false,
        "length": 21888,
        "sha256": "eec1884571bc35d2436b8be0bb970a4f0e9b55f14042d7e9847d8d2fae543846"
      }
    ],
    "missingReferences": [
      {
        "path": "references/capture-export.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/scene-planning.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      },
      {
        "path": "references/widget-runtime.md",
        "status": "not_captured",
        "evidence": [
          "article-blocked-url"
        ]
      }
    ]
  }
];
