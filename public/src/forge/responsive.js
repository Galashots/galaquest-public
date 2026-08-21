// The Forge keeps a large live 3D viewport authoritative. At tablet widths the two production
// columns become off-canvas drawers rather than squeezing the Hero to a narrow strip. This rule is
// injected from a Forge-only module so the existing single-file alpha page can stay stable while the
// production UI is factored into modules.
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

  @media (prefers-reduced-motion: reduce) {
    #left-panel, #right-panel { transition: none; }
  }
`;
document.head.append(style);
