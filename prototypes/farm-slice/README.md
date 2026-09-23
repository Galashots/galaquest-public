# Hatch & Harvest -- farm slice prototype

A self-contained, ten-minute playable slice of GalaQuest's farm loop. Plain ES
modules, three.js for the diorama, DOM for the touch UI, no build step, no
npm dependencies. See `CONTRACT.md` (in the integration branch) for the
tuned experience spec this build follows, and `../../co-ceo-brief.md` for the
original product brief.

## Running locally

```
node serve.mjs
```

Then open `http://localhost:5310/` in a browser (iPad Safari is the primary
target; a desktop browser at an iPad-ish viewport works for development).

## Running tests

```
node --test test/
```

## Layout

- `index.html` -- entry point.
- `src/rules/*.js` -- pure game state and rules (no three.js, no DOM). Fully
  unit-tested with `node --test` and intended to be portable to Unity later.
- `src/save.js` -- localStorage persistence, versioned JSON, wrapped in
  try/catch.
- `src/render/*.js` -- the three.js diorama: procedural low-poly geometry,
  lighting, camera sway, tweens, and a small sparkle-particle system.
- `src/ui/*.js` -- the DOM overlay: goal chip, arrow, market panel, naming
  dialog, collection book, band picker, HUD.
- `src/audio.js` -- short generated WebAudio blips (no audio files), with a
  mute toggle and unlock-on-first-tap for iOS Safari.
- `src/main.js` -- glue between all of the above.
- `content/` -- game content (crops, armor, creatures, offers, dialog). See
  `content/index.js` for how the placeholder and the real content pack are
  wired together.
- `test/*.test.mjs` -- `node --test` unit tests for the rules modules.
- `vendor/three.module.min.js` -- vendored copy of three.js.

## Third-party licences

`vendor/three.module.min.js` is three.js r170, copied unmodified from this
repo's `public/vendor/three.module.min.js`.

> Copyright 2010-2024 Three.js Authors
> SPDX-License-Identifier: MIT

See the repo's top-level `ASSET-LICENSES.md` for the full provenance record
of the original vendored copy. No other third-party or binary assets are
used -- everything on screen is procedural three.js geometry, flat colours,
and CSS/DOM.
