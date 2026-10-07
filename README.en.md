# freenow · Local AI Creative Workspace

[简体中文](README.md) · [English](README.en.md)

**freenow is an AI infinite canvas that runs on your computer, bringing text, images, video, audio, a 3D studio, and a creative agent into one workspace.** Import assets, connect nodes, edit locally, and configure independent model providers when you need AI generation. Projects and generated outputs are stored locally.

For individual creators and developers exploring asset, storyboard, shot, and media workflows. The source package version is **0.1.0, in development**. Desktop **0.1.0-alpha.1** is publicly available as a macOS Apple Silicon prerelease. Implemented integrations and focused checks do not mean every page and interaction has passed acceptance.

[Download macOS arm64 Alpha](https://github.com/freeall12/freenow/releases/tag/v0.1.0-alpha.1) · [Quick start](#quick-start) · [Features](#features) · [API setup](#minimal-api-setup) · [Docs](docs/README.md) · [Status](docs/STATUS.md) · [Contributing](#development-and-contributing)

## Screenshots

Real local interfaces show the mixed-media canvas, desktop 3D studio, and GLB model preview. The demo uses local test assets without calling a generation model. See [screenshot sources and reproduction](docs/screenshots/README.md) for the operations and verification scope.

![freenow infinite canvas with text, a 3D studio, a local image, video played to 8 seconds, and a synthetic melody audio node](docs/screenshots/freenow-canvas-workflow-20261007.jpg)

| Desktop 3D studio | Local GLB model preview |
| --- | --- |
| ![freenow macOS arm64 packaged WebGL studio after restart with cube position X=1.25](docs/screenshots/freenow-desktop-packaged-restart-20261007.jpg) | ![freenow local bicycle GLB preview with environment and capture controls](docs/screenshots/freenow-local-model-preview-20261005.jpg) |

## Quick start

Recommended: **Node.js 22 LTS and pnpm**. Local video trimming, encoding, and some media processing also require **FFmpeg / FFprobe**. Start the browser version from source below, or [download the macOS arm64 Alpha](https://github.com/freeall12/freenow/releases/tag/v0.1.0-alpha.1). The desktop package includes Node.js but is unsigned and not notarized. See the [desktop guide](docs/DESKTOP.md) for installation and configuration.

```sh
git clone https://github.com/freeall12/freenow.git
cd freenow
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

Open [http://localhost:4173/](http://localhost:4173/). The server binds to `127.0.0.1:4173` by default.

`pnpm run setup` creates missing default data without overwriting existing projects. Keep `run`: `pnpm setup` is a different package-manager command. A fresh checkout starts with an empty project. **Local editing does not require an API key; generation and the agent show configuration requirements when unavailable.**

Use `FFMPEG_PATH` and `FFPROBE_PATH` if the executables are outside your system path. If startup fails, check the port and the task store's single-writer lock. Run one server instance at a time. [Development and troubleshooting guide](docs/DEVELOPMENT-GUIDE.md)

## Desktop source preview

```sh
pnpm desktop:dev
```

The desktop uses `127.0.0.1:4183` and a separate user data directory. Its backend reads `providers.env`; FFmpeg / FFprobe remain external requirements. The command prepares a separate runtime directory: recognized old staging is archived automatically, while unrecognized directories are not overwritten. See the [desktop guide](docs/DESKTOP.md) for the rules and version limits.

Current source adds [local external-agent MCP access](src/features/external-agent/README.md) and [authorized-folder organization](docs/DESKTOP-FILES-20261008.md), both requiring native approval. The published Alpha does not include these additions. MCP access supports clients that can start a local stdio process and reads only current canvas metadata; writes, generation/result application, media/assets, and cloud HTTP connectors are not implemented.

## Features

| Workspace | Implemented capabilities | Requirements and limits |
| --- | --- | --- |
| Infinite canvas | Projects, connected nodes, search, groups/stacks, automatic layout, asset library, copy/paste, undo/redo | Local; interaction and performance acceptance is ongoing |
| Text and images | Rich text/Markdown, layers, brushes, crop, transforms, masks, history, export | Local editing; AI processing requires a provider |
| Video and audio | Import/playback, waveforms, frame capture, trim, playlists, subtitles, generation history | Some processing needs FFmpeg; AI generation requires a provider |
| 3D studio | GLB, SPZ Gaussian Splatting, LOD, object/camera transforms, camera motion, photos, short video, save/recovery | Local WebGL; Gaussian scenes cannot be fully exported as GLB |
| Creative agent | Canvas/studio tools, attachments, skills, creative apps, read-only subtasks, DAG orchestration | A model supporting the required Responses API and tool calls |
| Workflows and recovery | Dependency execution, durable receipts, original-task queries, explicit continuation, save guards | Unknown outcomes are not automatically resubmitted |
| External agent (desktop source) | Local MCP connection, native approval, two current-canvas metadata tools, reload revocation | Local stdio clients; no writes, generation, media, or cloud connectors; not included in the published Alpha |

The source also includes a [director workspace V3](docs/STUDIO-V3-PRODUCTION-20261008.md) under development: actors/cameras/props, baseline and independent states, [entity properties](docs/STUDIO-V3-ENTITIES-20261008.md), and [actor control/camera creation](docs/STUDIO-V3-CONTROLS-20261008.md) are integrated. The latest [camera control and capture](docs/STUDIO-V3-CAMERA-POSSESSION-20261008.md) adds 3D flight, entry/return transitions, aspect and focal rulers, finish/cancel, and real PNG captures connected to the canvas with same-photo save retry. Browser reload restored five photos and camera parameters. The complete plan view, timeline/keyframes, Saved Views/photo history, generation, and full V3 agent orchestration remain incomplete; real SPZ depth-of-field visuals are unverified. The current Alpha does not include this batch.

| Actor control and heading | Current-view camera confirmation |
| --- | --- |
| ![freenow director workspace actor control HUD and heading](docs/screenshots/20261008-studio-controls/actor-heading.jpg) | ![freenow director workspace 35mm 9:16 current-view camera confirmation](docs/screenshots/20261008-studio-controls/viewfinder-portrait.jpg) |

| Camera control and optics | Captured photo connected to the canvas |
| --- | --- |
| ![freenow 9:16 camera control, focal ruler and real shutter](docs/screenshots/20261008-studio-camera/possession-portrait.jpg) | ![freenow canvas with a studio connected to an actual captured PNG](docs/screenshots/20261008-studio-camera/canvas-photos.jpg) |

Model menus, adapter implementations, and app registrations describe different scopes. Real provider output quality requires separate validation. [Detailed features and adapters](docs/FEATURES.md) · [Verification evidence](docs/VERIFICATION-INDEX.md)

Canvas help provides local updates, an offline guide, agent connection, feedback, and shortcuts. The [help and original gesture GIFs](docs/CANVAS-HELP-20261008.md) and [actual shortcut mapping](docs/CANVAS-SHORTCUTS-20261008.md) document verified behavior. Real microphone/transcription and every hardware-input combination remain unverified.

## Minimal API setup

The server reads its process environment and **does not automatically load `.env`**. See [`.env.example`](.env.example) for configuration fields. Use an untracked local file and load it explicitly:

```sh
cp .env.example .env.local
# Edit .env.local on your machine with the configuration you need
node --env-file=.env.local server/server.cjs
```

This replaces `pnpm dev`. Restart after changing server configuration. Keys stay on the server; do not put them in frontend source or commit them to Git.

| Capability | Minimum requirement | Configuration |
| --- | --- | --- |
| Local canvas and editing | No key; FFmpeg for some media operations | [Runtime guide](docs/DEVELOPMENT-GUIDE.md) |
| Creative agent | `OPENAI_API_KEY`, `OPENAI_MODEL`; optional `OPENAI_BASE_URL` must support the required Responses API/tool behavior | [Agent API](docs/AGENT-API.md) |
| Image, video, audio, or 3D generation | The operation's provider key, protocol, model mapping, and account permissions | [Multi-provider setup](docs/MULTI-PROVIDER-SETUP.md), [adapter list](docs/FEATURES.md#独立供应商适配器) |

A single provider key does not enable every model. Agent menu aliases use `AGENT_MODEL_MAP`; reasoning presets use `AGENT_REASONING_MAP`. Unmapped choices do not silently fall back. Custom `tasks-v1` and `skin-tasks-v1` integrations require an external server that implements the documented contract.

## Local data and privacy

Browser **IndexedDB** stores projects, assets, agent sessions, and workflow records; some preferences and skills use **localStorage**. Server tasks, generated media, and agent checkpoints use private hidden directories under `server/`, excluded from static access and Git. There is currently no cloud sync.

Use the same address consistently: `localhost` and `127.0.0.1` are different origins with separate browser storage. Clearing site data removes browser-side content. Browser and server data need separate backups. See [asset capacity and recovery](docs/LIBRARY-LOCAL-CAPACITY-20261005.md).

**Local storage does not make AI requests local.** Calling a configured provider sends the prompt and required media to that service. Generation does not run without configuration. Runtime resources are local, requests to the original reference service are blocked, and legacy assets require explicit import/repair. [Localization boundaries](docs/FREENOW-LOCALIZATION-ACCEPTANCE.md) · [Public repository audit](docs/PUBLIC-REPOSITORY-AUDIT-20261004.md)

## Development and contributing

Native JavaScript / ES Modules run in the browser; Node.js provides local APIs. Three.js / Spark handle 3D, Fabric handles images, Tiptap handles text, and the OpenAI SDK supports the server-side agent. Existing root hosts and `src/features/` modules work together while code is organized by feature.

```text
index.html, app.js       Page entry and canvas host
src/features/           Canvas, media, agent, and 3D modules
server/                 Local APIs, adapters, tasks, and media services
desktop/                Electron shell, backend configuration, and packaging
assets/, defaults/      Runtime resources and empty-project defaults
scripts/, tests/        Builds, focused checks, and regressions
docs/                   Configuration, contracts, and verification records
component-library/      Component catalog and preview host
```

Read the [project structure](docs/PROJECT-STRUCTURE.md) and [development guide](docs/DEVELOPMENT-GUIDE.md) before contributing. Include the problem, reproduction input, and expected behavior. Keep changes focused. UI changes need browser verification; provider fixtures do not establish model quality.

```sh
node --test tests/<relevant-test>.test.cjs
node --check <changed-module>
pnpm check
# Rebuild only affected bundle entries:
pnpm build:text
pnpm build:image
pnpm build:mask
pnpm build:agent
pnpm build:spark
```

There is no generic `build`, `lint`, or `typecheck` script. See the [build table](docs/DEVELOPMENT-GUIDE.md#构建表). `pnpm test` runs the complete regression suite.

## FAQ

**What is freenow?** A local AI creative workspace using an infinite canvas to organize text, images, video, audio, and 3D content, with a creative agent and independent generation integrations.

**Do I need a TapNow account?** No. TapNow interfaces and installation resources were used as interaction references; freenow implements its own local frontend, backend, and persistence. This project is not affiliated with TapNow.

**Does it work offline?** Local editing can run offline once dependencies and resources are available. AI features access your configured services. No local inference model is bundled, and arbitrary compatible APIs are not guaranteed to support every tool.

**What has been verified?** Focused source regressions, real local media, and browser checks have documented scopes in the [verification index](docs/VERIFICATION-INDEX.md). Full interaction acceptance, real account/key model quality, complex SPZ scenes, and long-running behavior remain open.

## Status and license

The native Sonilo SFX integration passed 20 focused checks and 4 related Music regressions. This batch’s SFX and agent color-adjust browser acceptance is complete, including color state/save retries, a real PNG, and reload recovery. Full interaction acceptance and real provider key/output-quality validation remain open. See the [SFX UI record](docs/SONILO-SFX-UI-QA-20261005.md), [color-adjust record](docs/AGENT-COLOR-ADJUST-INTERACTIONS-20261005.md), and [status](docs/STATUS.md) for limits. Other progress, the 92 missing exact template bodies, and provider limits are documented in [status](docs/STATUS.md) and [current gaps](docs/CURRENT-FUNCTION-GAPS-20261003.md). Team, community, marketing/sharing, and billing surfaces are outside the current scope.

**This repository does not currently provide one open-source license covering all content.** Third-party code retains its licenses. Publishing the repository or changing branding does not transfer rights to reference interfaces, templates, or assets. [Third-party sources](docs/THIRD-PARTY-RESOURCES.md)

Most detailed documents are currently in Chinese. Start with the [documentation guide](docs/README.md), [historical README](docs/README-HISTORY.md), or [repository discovery notes](docs/REPOSITORY-DISCOVERY.md).
