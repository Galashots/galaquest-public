// The Forge keeps a large live 3D viewport authoritative. At tablet widths the two production
// columns become off-canvas drawers rather than squeezing the Hero to a narrow strip. This rule is
// injected from a Forge-only module so the existing single-file alpha page can stay stable while the
// production UI is factored into modules. `fitAuthoring.js` is also exercised under Node unit tests,
// so this side effect must remain a harmless no-op outside a browser.
//
// This module is the ONE authority for the Forge's narrow-viewport layout. forge.html used to carry
// a second @media(max-width:760px) block saying nearly the same thing at a different breakpoint;
// two independently-maintained laws for one layout is a defect, and that copy is gone.
if (typeof document !== 'undefined' && !document.head.querySelector('style[data-gq-forge-responsive]')) {
  const style = document.createElement('style');
  style.dataset.gqForgeResponsive = 'true';
  style.textContent = `
    @media (max-width: 1100px) {
      #forge {
        grid-template-columns: 1fr;
        grid-template-rows: 48px minmax(0, 1fr);
      }
      #left-panel, #right-panel {
        position: absolute;
        z-index: 10;
        top: 48px;
        bottom: 0;
        width: min(88vw, 340px);
        box-shadow: 0 0 35px #000a;
        transition: transform 140ms ease-out;
      }
      #left-panel { left: 0; transform: translateX(-100%); }
      #right-panel { right: 0; transform: translateX(100%); }
      body.show-assets #left-panel { transform: translateX(0); }
      body.show-fit #right-panel { transform: translateX(0); }
      #stage { grid-column: 1; grid-row: 2; }
      .mobile-toggle { display: inline-block !important; }
      .top-meta .badge { display: none; }
      .brand { min-width: 0; }
    }

    /* PHONE WIDTHS. Measured at 390px before this block existed: the topbar's four children needed
       426px of a 390px screen, so #mobile-fit -- the button that opens the entire Fit Inspector --
       began at x=390, the first pixel past the right edge. html,body carry overflow:hidden, so it
       could not be scrolled to either: on a phone the Forge simply had no way to reach its own
       controls. The 167px of branding and the 100px Character Studio link are what has to give;
       the two drawer buttons are the reason the topbar exists at this size. */
    @media (max-width: 560px) {
      #topbar { gap: .5rem; padding: 0 .5rem; }
      .brand span { display: none; }
      .brand strong { font-size: .8rem; letter-spacing: .06em; }
      .top-meta .top-link { display: none; }

      /* Fitting is a visual job: you nudge, you look, you nudge again. The shared drawer width of
         min(88vw, 340px) takes 340 of a 390px screen, leaving a 50px strip of Hero -- the Owner
         would be adjusting gear he cannot see. Narrow the Fit Inspector on a phone so roughly a
         third of the stage stays live next to the controls.

         A bottom sheet would be the better shape for this and was built and measured first. In
         headless Chromium (swiftshader, --disable-gpu-compositing) ANY bottom-anchored panel --
         absolute or fixed, top-anchored or height-driven -- left the stage above it drawing
         nothing, stably and reproducibly across sessions, with the WebGL context reported healthy
         and the canvas unchanged at 390x796. A right-hand drawer in the same page renders. No
         geometric predictor fits the readings (40vh rendered; 36vh and 42vh did not), so this is
         probably a compositing artifact of that renderer rather than a real-device defect -- but
         a fitting tool whose viewport goes black is not a thing to ship on a hope. The sheet is
         the first thing to retry once someone can confirm it on real hardware. */
      /* --panel is 94% opaque, which is fine behind a desktop column and not fine over a live 3D
         stage on a phone: the status pill and the viewport toolbar ghost straight through the
         numbers being edited. */
      :root { --panel: #0a141d; }
      #right-panel { width: min(70vw, 272px); }
      .axis-grid { grid-template-columns: 26px minmax(0, 1fr) 44px 44px; }
      .section { padding: .7rem .6rem; }
    }

    /* Thumb-sized controls wherever the drawers are in play. The axis nudges ARE the tool -- fitting
       is dozens of taps on + and - -- and they were 36x32, under every platform's minimum. Widening
       the two button columns of .axis-grid costs the number field ~16px of a 340px drawer. */
    @media (max-width: 1100px), (pointer: coarse) {
      .mobile-toggle { min-height: 44px; min-width: 44px; }
      .axis-grid { grid-template-columns: 32px minmax(0, 1fr) 44px 44px; gap: .35rem; }
      .axis-grid button { height: 44px; }
      .axis-grid input { min-height: 44px; }
      .nudge-row button { min-height: 36px; padding: .3rem .6rem; }
      #stage-toolbar button, .small-button, .action-button { min-height: 44px; }
      #stage-toolbar select { min-height: 44px; }
    }

    @media (prefers-reduced-motion: reduce) {
      #left-panel, #right-panel { transition: none; }
    }
  `;
  document.head.append(style);
}
