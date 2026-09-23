export const panelStyles = `
:host {
  all: initial;
  display: block;
  --cp-bg: #0d0b13;
  --cp-card: #15121d;
  --cp-line: #2a2635;
  --cp-text: #f7f4ff;
  --cp-muted: #8f899a;
  /* Overridden per-panel from ACCENT_PALETTES in @channelpilot/shared. */
  --cp-purple: #5b43d6;
  --cp-purple-soft: #a994ff;
  --cp-green: #6ee0a8;
  --cp-panel-alpha: .92;
  --cp-ease: cubic-bezier(.22, 1, .36, 1);

  /* ---- Scales -------------------------------------------------------------
     The panel is a 440px column sitting on top of someone else's page, so its
     rhythm has to be tight and predictable. Before these existed the file used
     28 distinct paddings, 18 gaps, 22 radii and 17 font sizes, and the result
     read as a loose form rather than a dense instrument panel. */
  --cp-sp-1: 4px;
  --cp-sp-2: 8px;
  --cp-sp-3: 12px;
  --cp-sp-4: 16px;
  --cp-sp-5: 20px;
  --cp-sp-6: 24px;

  --cp-r-sm: 8px;
  --cp-r-md: 12px;
  --cp-r-lg: 16px;
  --cp-r-xl: 20px;
  --cp-r-full: 999px;

  /* 12px is the floor: 55-64% of the old declarations were 8-11px. */
  --cp-fs-xs: 12px;
  --cp-fs-sm: 13px;
  --cp-fs-md: 14px;
  --cp-fs-lg: 16px;
  --cp-fs-xl: 20px;
  --cp-fs-2xl: 26px;
  --cp-fs-3xl: 34px;

  /* Three steps of text emphasis instead of a dozen one-off greys. */
  --cp-text-2: #b6b2c4;
  --cp-text-3: #8d8899;

  /* Tabular figures keep changing counters from shifting width while they
     animate — the realtime numbers update every few seconds. */
  --cp-nums: "tnum" 1, "cv01" 1;
  /* Neutral on purpose. An accent-tinted ring measured 1.25:1 against the light
     theme background, i.e. invisible; a neutral ring clears 3:1 in both themes
     no matter which accent the user picked. */
  --cp-focus-ring: #ffffff;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
button, input, textarea, select { font: inherit; }
/* One focus treatment for every interactive element in the panel. Previously
   only four rules in the whole 1400-line stylesheet set an outline at all, and
   the close/minimise buttons changed nothing but their text colour. */
:where(button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])):focus-visible {
  outline: 2px solid var(--cp-focus-ring);
  outline-offset: 2px;
  border-radius: inherit;
}
.cp-panel[data-theme="light"] { --cp-focus-ring: #1f2440; }
.cp-launcher-shell {
  position: fixed; z-index: 2147483646; right: 20px; bottom: 22px;
  display: flex; align-items: center;
}
.cp-launcher {
  position: relative;
  display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 15px 0 8px;
  border: 1px solid color-mix(in srgb, var(--cp-purple) 42%, rgba(255, 255, 255, .14));
  border-radius: 16px; color: white;
  background:
    linear-gradient(160deg, rgba(255, 255, 255, .1), transparent 46%),
    rgba(20, 17, 30, .72);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .13) inset,
    0 18px 44px rgba(0, 0, 0, .5), 0 0 34px color-mix(in srgb, var(--cp-purple) 22%, transparent);
  backdrop-filter: blur(22px) saturate(150%); -webkit-backdrop-filter: blur(22px) saturate(150%);
  cursor: pointer;
  transition: transform .24s var(--cp-ease), box-shadow .24s ease, border-color .24s ease, background .24s ease;
}
.cp-launcher:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--cp-purple) 62%, rgba(255, 255, 255, .2));
  background: linear-gradient(160deg, rgba(255, 255, 255, .13), transparent 46%), rgba(26, 22, 38, .78);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .17) inset,
    0 22px 54px rgba(0, 0, 0, .55), 0 0 46px color-mix(in srgb, var(--cp-purple) 34%, transparent);
}
.cp-launcher:active { transform: translateY(0); }
.cp-launcher-hide {
  position: absolute; top: -9px; right: -9px; width: 24px; height: 24px; display: grid; place-items: center;
  padding: 0; border: 1px solid #4a4457; border-radius: 50%; color: #c4bdcc; background: #19171e;
  box-shadow: 0 5px 16px #0008; cursor: pointer; font-size: 15px; line-height: 1; opacity: .72;
  transition: opacity .15s ease, transform .15s ease;
}
.cp-launcher-shell:hover .cp-launcher-hide, .cp-launcher-hide:focus-visible { opacity: 1; transform: scale(1.05); }
.cp-media-notice {
  position: fixed; z-index: 2147483646; right: 20px; bottom: 22px;
  display: grid; grid-template-columns: 32px minmax(0, 1fr) auto 24px;
  gap: 10px; align-items: center; width: min(380px, calc(100vw - 24px)); min-height: 64px;
  padding: 10px 11px; border: 1px solid rgba(255,255,255,.16); border-radius: 17px;
  color: #f5f3fc;
  background: linear-gradient(145deg, rgba(255,255,255,.12), transparent 48%), rgba(24,22,34,.86);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.16), 0 14px 34px rgba(0,0,0,.28);
  backdrop-filter: blur(18px) saturate(145%); -webkit-backdrop-filter: blur(18px) saturate(145%);
  animation: cp-media-notice-in .24s var(--cp-ease) both;
}
.cp-media-notice.with-launcher { bottom: 84px; }
/* The hint is the point of this notice; let it wrap instead of ellipsising. */
.cp-hidden-notice .cp-media-notice-copy small { white-space: normal; }
.cp-media-notice[data-theme="light"] {
  color: #202233; border-color: rgba(78,84,115,.2);
  background: linear-gradient(145deg, rgba(255,255,255,.9), rgba(246,247,255,.79));
  box-shadow: inset 0 1px 0 #fff, 0 14px 34px rgba(40,43,80,.14);
  --cp-focus-ring: #1f2440;
}
.cp-media-notice-icon {
  display: grid; place-items: center; width: 32px; height: 32px; border-radius: 11px;
  color: #bfb5ff; background: color-mix(in srgb, var(--cp-purple) 20%, transparent);
  font-size: 17px; font-weight: 800;
}
.cp-media-notice.ready .cp-media-notice-icon { color: #6ee0a8; background: rgba(83,205,143,.14); }
.cp-media-notice.error .cp-media-notice-icon { color: #ffc1ba; background: rgba(250,125,123,.17); }
.cp-media-notice[data-theme="light"].ready .cp-media-notice-icon { color: #176747; }
.cp-media-notice[data-theme="light"].error .cp-media-notice-icon { color: #a7353a; }
.cp-media-notice.analyzing .cp-media-notice-icon::after {
  content: ""; width: 15px; height: 15px; border: 2px solid currentColor; border-top-color: transparent;
  border-radius: 50%; animation: cp-media-spin .8s linear infinite;
}
.cp-media-notice-copy { min-width: 0; display: grid; gap: 3px; }
.cp-media-notice-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 750; line-height: 1.2; }
.cp-media-notice-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #b8b4c5; font-size: 11px; line-height: 1.3; }
.cp-media-notice[data-theme="light"] .cp-media-notice-copy small { color: #555c71; }
.cp-media-notice-open, .cp-media-notice-close {
  border: 0; cursor: pointer; transition: background .18s ease, transform .18s ease, color .18s ease;
}
.cp-media-notice-open {
  padding: 7px 9px; border-radius: 9px; color: #f6f3ff;
  background: color-mix(in srgb, var(--cp-purple) 60%, #171524); font-size: 11px; font-weight: 750;
}
.cp-media-notice-open:hover { transform: translateY(-1px); background: var(--cp-purple); }
.cp-media-notice-open:active { transform: scale(.97); }
.cp-media-notice-close { width: 24px; height: 28px; padding: 0; border-radius: 7px; color: #b8b4c5; background: transparent; font-size: 18px; }
.cp-media-notice-close:hover { color: #fff; background: rgba(255,255,255,.1); }
.cp-media-notice[data-theme="light"] .cp-media-notice-close { color: #555c71; }
.cp-media-notice[data-theme="light"] .cp-media-notice-close:hover { color: #202233; background: rgba(53,57,91,.09); }
@keyframes cp-media-spin { to { transform: rotate(360deg); } }
@keyframes cp-media-notice-in { from { opacity: 0; transform: translateY(8px); } }
@media (prefers-reduced-motion: reduce) {
  .cp-media-notice, .cp-media-notice.analyzing .cp-media-notice-icon::after { animation: none; }
  .cp-media-notice-open, .cp-media-notice-close { transition: none; }
}
.cp-logo { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; color: #fff; background: linear-gradient(150deg, #a08cff, #5a40e0); box-shadow: inset 0 1px 0 rgba(255,255,255,.34), 0 4px 12px rgba(90,64,224,.4); }
.cp-logo svg { width: 60%; height: 60%; }
.cp-launcher span:last-child { font-size: 12px; font-weight: 800; }
.cp-badge { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 99px; line-height: 18px; background: #6ee0a8; color: #10241a; font-size: 11px; }
.cp-panel {
  position: fixed; z-index: 2147483647;
  display: flex; flex-direction: column; overflow: hidden; border: 1px solid #302b3e; border-radius: 21px;
  color: var(--cp-text); background: radial-gradient(circle at 80% -5%, color-mix(in srgb, var(--cp-purple) 36%, transparent) 0, transparent 28%), rgba(13, 11, 19, var(--cp-panel-alpha));
  box-shadow: 0 30px 90px #000a; backdrop-filter: blur(24px) saturate(1.25); animation: cp-enter .22s ease-out;
}
@keyframes cp-enter { from { opacity: 0; transform: translateX(20px) scale(.98); } }
.cp-header { display: flex; align-items: center; gap: 8px; padding: 14px 15px; border-bottom: 1px solid var(--cp-line); cursor: grab; touch-action: none; user-select: none; }
.cp-header:active { cursor: grabbing; }
.cp-brand { min-width: 0; flex: 1; }
.cp-brand strong { display: block; font-size: 13px; letter-spacing: -.2px; }
.cp-brand span { display: block; margin-top: 2px; color: #827b8c; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; }
.cp-close { position: relative; width: 31px; height: 31px; border: 1px solid var(--cp-line); border-radius: 9px; color: #aaa4b5; background: #17141f; cursor: pointer; transition: color .15s ease, border-color .15s ease, background-color .15s ease; }
/* The icon stays 31px for density, but the hit area is expanded to ~45px so the
   control clears the 44px pointer-target guidance without a visual change. */
.cp-close::before, .cp-launcher-hide::before { content: ""; position: absolute; inset: -7px; border-radius: inherit; }
.cp-close:hover { color: #f1eef7; border-color: #453f57; background: #1e1a29; }
.cp-close:focus-visible { color: #f1eef7; }
.cp-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin: 11px 14px 0; padding: 4px; border-radius: 11px; background: #15121c; }
.cp-tabs button { padding: 8px; border: 0; border-radius: 8px; color: #847e8e; background: transparent; cursor: pointer; font-size: 12px; font-weight: 800; transition: color .15s ease, background-color .15s ease; }
.cp-tabs button:hover:not(.active) { color: #cdc7d6; background: #1c1926; }
.cp-tabs button.active { color: white; background: #29233d; box-shadow: 0 3px 10px #0004; }
.cp-scroll { flex: 1; overflow-y: auto; padding: 13px 14px 18px; scrollbar-width: thin; scrollbar-color: #332d43 transparent; }
.cp-kicker { color: #9687ff; font-size: 11px; font-weight: 900; letter-spacing: 1.4px; }
.cp-heading-row { display: flex; align-items: end; justify-content: space-between; margin: 8px 0 12px; }
.cp-heading-row h2 { margin: 0; font-size: 18px; line-height: 1.15; letter-spacing: -.7px; }
.cp-score-mini { display: flex; align-items: center; gap: 5px; color: #aaa3b4; font-size: 11px; }
.cp-score-mini b { color: var(--cp-green); font-size: 14px; }
.cp-upload-assistant {
  display: grid; gap: 9px; margin: 0 0 12px; padding: 11px;
  border: 1px solid color-mix(in srgb, var(--cp-purple) 35%, var(--cp-line));
  border-radius: 13px;
  background: linear-gradient(145deg, color-mix(in srgb, var(--cp-purple) 10%, var(--cp-card)), color-mix(in srgb, var(--cp-card) 94%, transparent));
}
.cp-upload-assistant header { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.cp-upload-assistant header div { display: grid; gap: 3px; }
.cp-upload-assistant header span { color: var(--cp-purple-soft); font-size: 9px; font-weight: 900; letter-spacing: 1px; }
.cp-upload-assistant header strong { color: var(--cp-text); font-size: 12px; }
.cp-upload-assistant header button {
  min-height: 29px; padding: 0 8px; border: 1px solid var(--cp-line); border-radius: 7px;
  color: var(--cp-purple-soft); background: color-mix(in srgb, var(--cp-card) 88%, transparent); cursor: pointer;
  transition: border-color .15s ease, background-color .15s ease, color .15s ease;
}
.cp-upload-assistant header button:hover { border-color: var(--cp-purple); color: #fff; background: color-mix(in srgb, var(--cp-purple) 22%, var(--cp-card)); }
.cp-upload-assistant ol { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin: 0; padding: 0; list-style: none; }
.cp-upload-assistant li { min-width: 0; display: flex; align-items: center; gap: 6px; color: var(--cp-muted); font-size: 10px; }
.cp-upload-assistant li i {
  width: 18px; height: 18px; flex: 0 0 18px; display: grid; place-items: center;
  border: 1px solid var(--cp-line); border-radius: 6px; color: var(--cp-muted); font-size: 9px; font-style: normal;
}
.cp-upload-assistant li.done i { border-color: #4b9b77; color: #9be8c4; background: #173329; }
.cp-upload-assistant li.active i { border-color: var(--cp-purple); color: #fff; background: var(--cp-purple); animation: cp-shimmer 1.2s linear infinite; }
.cp-upload-assistant li.review i { border-color: #745b32; color: #ffd18a; background: #352817; }
.cp-upload-assistant small { color: var(--cp-muted); font-size: 9px; line-height: 1.4; }
.cp-detected { display: flex; align-items: center; gap: 8px; margin-bottom: 11px; padding: 9px 10px; border: 1px solid #2c2740; border-radius: 11px; background: #17131f; }
.cp-detected i { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--cp-green); box-shadow: 0 0 8px #6ee0a8; }
.cp-detected div { min-width: 0; flex: 1; }
.cp-detected strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.cp-detected span { color: #7f7889; font-size: 11px; }
.cp-field { display: grid; gap: 6px; margin-bottom: 10px; }
.cp-field > span { display: flex; justify-content: space-between; color: #b7b0c1; font-size: 11px; font-weight: 700; }
.cp-field > span em { color: #696371; font-size: 11px; font-style: normal; font-weight: 500; }
.cp-field input, .cp-field textarea, .cp-field select {
  width: 100%; border: 1px solid #2c2736; border-radius: 10px; outline: none; color: #f5f1ff;
  background: #121018; padding: 10px 11px; font-size: 12px; line-height: 1.45;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.cp-field textarea { min-height: 72px; resize: vertical; }
.cp-field input:hover, .cp-field textarea:hover, .cp-field select:hover { border-color: #3c3550; }
.cp-field input:focus, .cp-field textarea:focus, .cp-field select:focus { border-color: #7865ff; box-shadow: 0 0 0 3px #7865ff1f; }
.cp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.cp-upload {
  position: relative; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  min-height: 48px; margin-bottom: 11px; padding: 8px 10px; border: 1px dashed #453b6d; border-radius: 11px;
  color: #a89fc1; background: #171321; font-size: 11px; cursor: pointer;
  transition: border-color .15s ease, background-color .15s ease;
}
.cp-upload:not(.disabled):hover { border-color: var(--cp-purple); background: #1c1726; }
.cp-upload input { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; }
.cp-upload b { color: #8f7bff; }
.cp-upload.disabled { border-style: solid; cursor: default; }
.cp-upload.disabled span { color: var(--cp-text-3); }
.cp-upload.disabled button {
  flex: 0 0 auto; min-height: 28px; padding: 0 10px; border: 1px solid var(--cp-line); border-radius: var(--cp-r-sm);
  color: var(--cp-purple-soft); background: transparent; cursor: pointer; font-size: var(--cp-fs-xs); font-weight: 750;
  transition: border-color .15s ease, color .15s ease, background-color .15s ease;
}
.cp-upload.disabled button:hover { border-color: var(--cp-purple); color: #fff; background: color-mix(in srgb, var(--cp-purple) 22%, transparent); }
.cp-panel[data-theme="light"] .cp-upload.disabled button { color: var(--cp-accent-contrast); }
.cp-panel[data-theme="light"] .cp-upload.disabled button:hover { color: #fff; background: var(--cp-purple); }
.cp-actions { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
.cp-primary, .cp-secondary { border-radius: 11px; padding: 11px 13px; cursor: pointer; font-size: 12px; font-weight: 850; transition: transform .15s ease, box-shadow .15s ease, background-color .15s ease, border-color .15s ease, opacity .15s ease; }
.cp-primary { border: 0; color: white; background: linear-gradient(135deg, #7e6bff, #5d48df); box-shadow: 0 7px 22px #654dec48; }
.cp-primary:hover:not(:disabled) { box-shadow: 0 10px 28px #654dec6b; transform: translateY(-1px); }
.cp-primary:active:not(:disabled) { transform: translateY(0); box-shadow: 0 5px 16px #654dec48; }
.cp-secondary { border: 1px solid #322d3d; color: #aaa4b5; background: #17141f; }
.cp-secondary:hover:not(:disabled) { border-color: #453f57; color: #e2ddea; background: #1d1926; }
.cp-secondary:active:not(:disabled) { background: #15121b; }
.cp-primary:disabled, .cp-secondary:disabled { opacity: .55; cursor: not-allowed; transform: none; }
.cp-primary[aria-busy="true"]:disabled, .cp-secondary[aria-busy="true"]:disabled { cursor: progress; }
.cp-error { margin-top: 9px; padding: 9px 10px; border: 1px solid #632d37; border-radius: 9px; color: #ffaaa9; background: #36171c; font-size: 11px; line-height: 1.4; }
.cp-result { margin-top: 14px; }
.cp-result-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }
.cp-result-head strong { font-size: 11px; }
.cp-provider { border: 1px solid #3f3762; border-radius: 99px; color: #9e90ff; padding: 4px 7px; font-size: 11px; text-transform: uppercase; }
.cp-provider-notice { display: grid; grid-template-columns: 25px minmax(0, 1fr); gap: 8px; align-items: center; margin: 8px 0 10px; padding: 9px 10px; border: 1px solid #62502c; border-radius: 10px; color: #dec583; background: #2b2314; }
.cp-provider-notice b { display: grid; place-items: center; width: 25px; height: 25px; border-radius: 8px; color: #f0d790; background: #4b3b1d; font-size: 14px; }
.cp-provider-notice span { font-size: 11px; line-height: 1.45; }
.cp-score-card { display: grid; grid-template-columns: 66px 1fr; gap: 12px; align-items: center; padding: 12px; border: 1px solid #292438; border-radius: 13px; background: #14111b; }
.cp-score-ring { display: grid; place-items: center; width: 58px; height: 58px; border-radius: 50%; font-size: 16px; font-weight: 900; }
.cp-score-ring::after { content: ""; grid-area: 1/1; width: 45px; height: 45px; border-radius: 50%; background: #14111b; }
.cp-score-ring span { z-index: 1; grid-area: 1/1; }
.cp-factor { margin: 5px 0; }
.cp-factor div { display: flex; justify-content: space-between; color: #9d96a8; font-size: 11px; }
.cp-bar { height: 3px; margin-top: 3px; overflow: hidden; border-radius: 5px; background: #2a2633; }
.cp-bar i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #7561ef, #6ee0a8); }
.cp-card { margin-top: 9px; padding: 11px; border: 1px solid #282333; border-radius: 12px; background: #131019; }
.cp-card-title { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.cp-card-title strong { font-size: 11px; }
.cp-card-title span { color: #6f6878; font-size: 11px; }
.cp-title-option { display: grid; grid-template-columns: 19px minmax(0, 1fr) 43px auto; gap: 7px; align-items: start; padding: 8px 0; border-top: 1px solid #23202b; }
.cp-title-option:first-of-type { border-top: 0; }
.cp-title-option > span { display: grid; place-items: center; width: 17px; height: 17px; border-radius: 5px; color: #998cff; background: #27213c; font-size: 11px; font-weight: 900; }
.cp-title-option p { margin: 1px 0 0; color: #dcd7e4; font-size: 11px; line-height: 1.35; }
.cp-title-seo, .cp-inline-title-score { display: grid; place-items: center; min-height: 26px; padding: 0 5px; border: 1px solid #665e73; border-radius: 8px; color: #cac3d4; background: #211e27; font-size: 11px; font-weight: 900; }
.cp-title-seo.high, .cp-inline-title-score.high { color: #78e2ac; border-color: #356f56; background: #15271f; }
.cp-title-seo.medium, .cp-inline-title-score.medium { color: #ffd082; border-color: #725929; background: #2b2213; }
.cp-title-seo.low, .cp-inline-title-score.low { color: #ff9b9b; border-color: #763b43; background: #2f181c; }
.cp-understanding > p { margin: 0 0 10px; color: #c7c1cc; font-size: 12px; line-height: 1.55; }
.cp-understanding-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-bottom: 9px; }
.cp-understanding-grid > div { padding: 8px; border-radius: 8px; background: #211e27; }
.cp-understanding-grid span { display: block; color: #89828f; font-size: 11px; }
.cp-understanding-grid b { display: block; margin-top: 4px; color: #d8d2dc; font-size: 11px; line-height: 1.4; }
.cp-hook-inline { display: grid; grid-template-columns: 54px repeat(3, 1fr); gap: 6px; margin: 8px 0 10px; }
.cp-hook-inline > strong { display: grid; place-content: center; border: 1px solid #397459; border-radius: 9px; color: #70e1a9; background: #14271f; font-size: 17px; text-align: center; }
.cp-hook-inline > strong small { display: block; margin-top: 2px; color: #72a58f; font-size: 9px; }
.cp-hook-inline > div { min-width: 0; padding: 7px; border-radius: 8px; background: #211e27; }
.cp-hook-inline span { color: #9f91ef; font-size: 10px; font-weight: 900; }
.cp-hook-inline p { margin: 4px 0 0; color: #aaa4b2; font-size: 10px; line-height: 1.4; }
.cp-retention-inline { display: grid; gap: 4px; margin-top: 8px; padding: 8px 9px; border-left: 2px solid #e0a451; color: #c9b181; background: #2a2115; font-size: 10px; line-height: 1.4; }
.cp-panel-hook-score { display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: center; margin: 8px 0 10px; padding: 8px; border: 1px solid #3d604f; border-radius: 9px; background: #14231c; }
.cp-panel-hook-score strong { color: #70e1a9; font-size: 13px; }
.cp-panel-hook-score span { color: #9bb8aa; font-size: 10px; line-height: 1.4; }
.cp-use { border: 0; color: #8e80f0; background: none; cursor: pointer; font-size: 11px; transition: color .15s ease; }
.cp-use:hover { color: #b3a6ff; text-decoration: underline; }
.cp-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.cp-chip { border: 1px solid #332c4d; border-radius: 99px; padding: 5px 7px; color: #b0a8c1; background: #1c1728; font-size: 11px; }
.cp-list { margin: 0; padding-left: 16px; color: #aaa3b3; font-size: 11px; line-height: 1.55; }
.cp-list li + li { margin-top: 5px; }
.cp-description { max-height: 125px; overflow: auto; white-space: pre-wrap; color: #aaa3b3; font-size: 11px; line-height: 1.55; }
.cp-login { padding: 28px 17px; text-align: center; }
.cp-login .cp-logo { margin: 0 auto 14px; width: 45px; height: 45px; }
.cp-login h2 { margin: 0 0 8px; font-size: 18px; }
.cp-login p { margin: 0 0 17px; color: #938d9e; font-size: 12px; line-height: 1.5; }
.cp-warmup { margin-bottom: 10px; padding: 9px; border: 1px solid #51441e; border-radius: 10px; color: #d6bb69; background: #2a2413; font-size: 11px; line-height: 1.4; }

.cp-realtime {
  position: fixed; z-index: 2147483645; top: 72px; right: 22px; width: 390px;
  overflow: hidden; border: 1px solid rgba(255, 255, 255, .1); border-radius: 20px; color: #f8f6ff;
  background:
    radial-gradient(circle at 88% -10%, color-mix(in srgb, var(--cp-purple) 24%, transparent), transparent 44%),
    linear-gradient(162deg, rgba(255, 255, 255, .062), transparent 46%),
    rgba(18, 16, 25, var(--cp-panel-alpha));
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .085) inset, 0 -1px 0 rgba(0, 0, 0, .3) inset,
    0 28px 72px rgba(0, 0, 0, .55);
  backdrop-filter: blur(28px) saturate(155%); -webkit-backdrop-filter: blur(28px) saturate(155%);
  font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1;
  /* Width is deliberately not transitioned. Expanding switches the element
     from the in-flow capsule (width: 100% of the masthead slot) to a fixed
     card, and a width transition then started from 100% of the VIEWPORT: for
     one frame the card spanned the whole page before shrinking to 390px. */
  transition: right .28s var(--cp-ease), top .28s var(--cp-ease);
}
.cp-realtime.expanded {
  transform-origin: top right;
  animation: cp-card-in .32s var(--cp-spring, cubic-bezier(.2, .9, .2, 1.15));
}
@keyframes cp-card-in {
  from { opacity: 0; transform: translateY(-8px) scale(.965); }
}
.cp-realtime.panel-open { right: 464px; }
/* Collapsed dock: a compact glass capsule that sits at the start of the
   masthead and reads as a native control rather than an injected toolbar. */
.cp-realtime.collapsed {
  position: relative; inset: auto; width: 100%; min-width: 0; max-width: 480px; overflow: visible;
  border: 1px solid rgba(255, 255, 255, .14); border-radius: 999px;
  background:
    linear-gradient(168deg, rgba(255, 255, 255, .11), rgba(255, 255, 255, .025) 56%),
    rgba(32, 29, 45, calc(var(--cp-panel-alpha) * .94));
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .13) inset, 0 -1px 0 rgba(0, 0, 0, .3) inset,
    0 8px 24px rgba(0, 0, 0, .42);
  backdrop-filter: blur(22px) saturate(160%); -webkit-backdrop-filter: blur(22px) saturate(160%);
  transition: border-color .22s ease, box-shadow .22s ease, background .22s ease;
}
.cp-realtime.collapsed:hover {
  border-color: color-mix(in srgb, var(--cp-purple) 46%, rgba(255, 255, 255, .18));
  background:
    linear-gradient(168deg, rgba(255, 255, 255, .14), rgba(255, 255, 255, .035) 56%),
    rgba(37, 33, 52, calc(var(--cp-panel-alpha) * .95));
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .16) inset, 0 -1px 0 rgba(0, 0, 0, .3) inset,
    0 10px 30px rgba(0, 0, 0, .46), 0 0 26px color-mix(in srgb, var(--cp-purple) 20%, transparent);
}
.cp-realtime.collapsed.docked { height: 40px; }
.cp-realtime.collapsed.undocked {
  position: fixed; top: 72px; right: 20px; bottom: auto; width: min(455px, calc(100vw - 40px));
}
.cp-realtime.collapsed.undocked.panel-open { right: 464px; }
/* Flex, not a fixed track list: the user chooses how many metrics the strip
   carries, so the metric row has to stretch to whatever it is given rather
   than to a hard-coded three-column repeat. */
.cp-top-dock {
  width: 100%; min-width: 0; height: 38px; display: flex; align-items: stretch; gap: 0;
  padding: 0 7px 0 11px; overflow: visible; border-radius: inherit;
  background: none;
}
.cp-dock-metrics { min-width: 0; flex: 1 1 auto; display: flex; align-items: stretch; }
.cp-dock-metrics > button {
  position: relative; min-width: 0; flex: 1 1 0; display: flex; justify-content: center; flex-direction: column;
  /* 10px each side left only 25px of content at the smallest dock width, so
     every label collapsed to an ellipsis ("60 …", "24 Ч…"). */
  padding: 0 6px; border: 0; color: #a8a2b5; background: transparent;
  cursor: pointer; text-align: center;
  transition: color .18s ease;
}
/* Hairline separators read cleaner than three stacked button fills. */
.cp-dock-metrics > button + button::before {
  content: ""; position: absolute; left: 0; top: 9px; bottom: 9px; width: 1px;
  background: rgba(255, 255, 255, .13);
}
.cp-dock-metrics > button:hover { color: #fff; }
.cp-dock-metrics > .cp-dock-empty { align-items: flex-start; padding-left: 8px; text-align: left; }
.cp-dock-metrics > .cp-dock-empty b { font-size: 13px; }
.cp-dock-metrics > button.active { color: #fff; }
.cp-dock-metrics > button.active small { color: var(--cp-purple-soft); opacity: 1; }
.cp-dock-metrics > button.incomplete small { color: #e6c179; opacity: 1; }
.cp-top-dock small { display: block; overflow: hidden; font-size: 10px; font-weight: 700; line-height: 12px; letter-spacing: .18px; text-transform: uppercase; text-overflow: ellipsis; white-space: nowrap; opacity: .78; }
.cp-top-dock b { display: block; min-height: 18px; margin-top: 1px; overflow: hidden; color: #fff; font-size: 15px; font-weight: 750; letter-spacing: -.35px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }
.cp-dock-metrics > button.pending b { color: #aaa3b5; }
.cp-dock-expand {
  align-self: center;
  width: 26px; height: 26px; display: grid; place-items: center; border: 0;
  border-radius: 50%; color: #c6c0d4; background: rgba(255, 255, 255, .09); cursor: pointer; font-size: 15px; line-height: 1;
  transition: color .18s ease, background .18s ease, transform .22s var(--cp-ease);
}
.cp-dock-expand:hover { color: #fff; background: rgba(255, 255, 255, .18); transform: translateY(-1px); }
/* The dismiss control only matters once you are already aiming at the widget. */
.cp-dock-hide {
  align-self: center; opacity: 0;
  width: 20px; height: 20px; display: grid; place-items: center; padding: 0; border: 0;
  border-radius: 50%; color: #8d8799; background: transparent; cursor: pointer; font-size: 12px; line-height: 1;
  transition: color .18s ease, background .18s ease, opacity .18s ease;
}
.cp-realtime.collapsed:hover .cp-dock-hide,
.cp-dock-hide:focus-visible { opacity: 1; }
.cp-dock-hide:hover, .cp-dock-hide:focus-visible { color: #ffb3c1; background: rgba(255, 92, 122, .2); outline: none; }
.cp-top-dock .cp-live-dot { align-self: center; width: 9px; height: 9px; border-width: 2px; margin-right: 2px; }
/* A counter that just moved gets a short lift + glow, so live updates register. */
.cp-dock-metrics > button.flash b { animation: cp-value-flash .9s var(--cp-ease); }
@keyframes cp-value-flash {
  0% { transform: translateY(-2px) scale(1.07); text-shadow: 0 0 14px color-mix(in srgb, var(--cp-green) 75%, transparent); }
  100% { transform: none; text-shadow: none; }
}
.cp-live-dot {
  position: relative; width: 11px; height: 11px; flex: 0 0 auto; border: 3px solid rgba(255, 255, 255, .1); border-radius: 50%;
  background: var(--cp-green); box-shadow: 0 0 14px color-mix(in srgb, var(--cp-green) 70%, transparent);
}
.cp-live-dot::after {
  content: ""; position: absolute; inset: -3px; border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--cp-green) 55%, transparent);
  animation: cp-live-pulse 2.4s ease-out infinite;
}
.cp-live-dot.warning { background: #ffb457; box-shadow: 0 0 14px #ffb457aa; }
.cp-live-dot.warning::after { border-color: #ffb45788; }
@keyframes cp-live-pulse { 0% { transform: scale(.85); opacity: .85; } 70%, 100% { transform: scale(1.9); opacity: 0; } }
.positive { color: #70e1a9 !important; }
.negative { color: #ff8585 !important; }

/* Docked-strip breakpoints, ordered widest to narrowest so the cascade reads
   top-down. dockWidthForMetrics() in @channelpilot/shared hands the strip the
   matching width, so the two have to agree on how many metrics fit. */
@media (max-width: 1700px) {
  .cp-realtime.collapsed.docked .cp-top-dock { padding-left: 7px; }
}
/* Below 1180px a third label cannot be read: every one of them collapsed to an
   ellipsis ("60 …", "24 Ч…"). Two readable metrics beat three truncated ones,
   so whatever the user put after the second is deferred to the expanded card —
   which is also where dockWidthForMetrics stops adding width. */
@media (max-width: 1179px) {
  .cp-realtime.collapsed.docked .cp-dock-metrics > button:nth-of-type(n + 3) {
    display: none;
  }
}
@media (max-width: 900px) {
  .cp-realtime.collapsed.docked .cp-top-dock { padding-right: 4px; padding-left: 7px; }
  .cp-realtime.collapsed.docked .cp-dock-metrics > button { padding: 0 4px; }
  .cp-realtime.collapsed.docked .cp-live-dot { width: 9px; height: 9px; border-width: 2px; }
}

.cp-inline-shell {
  width: 100%; margin: 12px 0 16px; overflow: hidden; border: 1px solid #3a3740;
  border-radius: 13px; color: #f1eef5; background: #202024; box-shadow: 0 8px 24px #0003;
  font-family: Roboto, Arial, sans-serif;
}
.cp-inline-head {
  display: flex; align-items: center; gap: 9px; min-height: 44px; padding: 8px 12px;
  border-bottom: 1px solid #35323a; background: linear-gradient(90deg, #28252f, #242328);
}
.cp-inline-head strong { flex: 1; font-size: 12px; }
.cp-inline-head em { color: #91899e; font-size: 11px; font-style: normal; }
.cp-mini-logo { display: grid; place-items: center; width: 25px; height: 25px; border-radius: 8px; color: white; background: linear-gradient(145deg, #8a77ff, #5b43e5); font-size: 11px; font-weight: 900; }
.cp-inline-empty { margin: 0; padding: 15px 13px; color: #a09aa7; font-size: 11px; line-height: 1.45; }
.cp-inline-titles { padding: 4px 12px 9px; }
.cp-inline-titles article { display: grid; grid-template-columns: 24px minmax(0, 1fr) 46px auto; gap: 9px; align-items: center; min-height: 50px; border-top: 1px solid #343139; }
.cp-inline-titles article:first-child { border-top: 0; }
.cp-inline-titles article > span { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 7px; color: #9b8fff; background: #332d48; font-size: 11px; font-weight: 800; }
.cp-inline-titles p { margin: 0; color: #ece9f0; font-size: 11px; line-height: 1.4; }
.cp-inline-titles button, .cp-inline-card > button, .cp-inline-card footer button, .cp-inline-error button {
  padding: 7px 9px; border: 1px solid #494255; border-radius: 8px; color: #b5aaff; background: #2a2730; cursor: pointer; font-size: 11px; font-weight: 750;
  transition: border-color .15s ease, background-color .15s ease, color .15s ease;
}
.cp-inline-titles button:hover, .cp-inline-card > button:hover, .cp-inline-card footer button:hover, .cp-inline-error button:hover {
  border-color: #6a5fae; color: #d6cfff; background: #322e3c;
}
.cp-inline-card footer button.primary:hover, .cp-inline-error-actions button.primary:hover { border-color: #8676ff; color: #fff; background: #7160ea; }
.cp-inline-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; padding: 10px; }
.cp-inline-card { min-width: 0; padding: 11px; border: 1px solid #38343d; border-radius: 11px; background: #28272b; }
.cp-inline-card { animation: cp-card-in .24s ease-out both; }
.cp-inline-card:nth-child(2) { animation-delay: .05s; }
.cp-inline-card:nth-child(3) { animation-delay: .1s; }
.cp-inline-card:nth-child(4) { animation-delay: .15s; }
.cp-inline-card:nth-child(5) { animation-delay: .2s; }
.cp-inline-card:nth-child(6) { animation-delay: .25s; }
.cp-inline-card.cp-inline-wide { grid-column: 1 / -1; }
.cp-inline-card header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 9px; }
.cp-inline-card header strong { font-size: 11px; }
.cp-inline-card header span { color: #7f7986; font-size: 11px; }
.cp-inline-description { max-height: 150px; margin: 0; overflow-y: auto; white-space: pre-wrap; color: #c7c2cb; font-size: 12px; line-height: 1.55; }
.cp-inline-card footer { display: flex; justify-content: flex-end; gap: 7px; margin-top: 10px; }
.cp-inline-card footer button.primary { border-color: #725cff; color: white; background: #6651df; }
.cp-inline-chips { display: flex; flex-wrap: wrap; gap: 5px; min-height: 59px; margin-bottom: 9px; align-content: flex-start; }
.cp-inline-chips span { height: max-content; padding: 5px 7px; border: 1px solid #494250; border-radius: 99px; color: #cbc4d3; background: #343139; font-size: 11px; }
.cp-inline-chips.hashtags span { border-color: #3e4b70; color: #aebfff; background: #293047; }
.cp-inline-card ul, .cp-inline-card ol { margin: 0 0 9px; padding-left: 17px; color: #bbb5c1; font-size: 11px; line-height: 1.5; }
.cp-inline-card li + li { margin-top: 4px; }
.cp-preview-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.cp-preview-grid figure { margin: 0; overflow: hidden; border: 1px solid #3f3a45; border-radius: 9px; background: #1c1b1f; }
.cp-preview-grid img { display: block; width: 100%; max-height: 340px; object-fit: contain; background: #0d0c10; }
.cp-preview-grid figcaption { display: flex; align-items: center; justify-content: space-between; gap: 5px; padding: 6px 7px; }
.cp-preview-grid figcaption span { color: #aaa4b0; font-size: 11px; }
.cp-preview-grid figcaption a { color: #b9afff; font-size: 11px; font-weight: 750; text-decoration: none; }
.cp-preview-note { margin: 8px 0 0; color: #aaa4b0; font-size: 11px; line-height: 1.5; }
.cp-inline-seo { display: grid; grid-template-columns: 86px 1fr; align-items: center; gap: 13px; }
.cp-inline-score { display: flex; align-items: center; gap: 8px; }
.cp-inline-score > strong { display: grid; place-items: center; width: 54px; height: 54px; border: 5px solid #6ee0a8; border-radius: 50%; font-size: 17px; }
.cp-inline-score span { color: #8e8894; font-size: 11px; line-height: 1.35; }
.cp-inline-progress { margin: 0; padding: 11px 12px 0; color: #c9c2ff; font-size: 11px; line-height: 1.45; }
.cp-inline-loading .cp-skeleton { display: grid; gap: 7px; padding: 12px; }
.cp-skeleton i { height: 10px; border-radius: 5px; background: linear-gradient(90deg, #302d35, #47414f, #302d35); background-size: 200% 100%; animation: cp-shimmer 1.1s linear infinite; }
.cp-skeleton i:nth-child(2) { width: 82%; }
.cp-skeleton i:nth-child(3) { width: 64%; }
.cp-inline-error p { margin: 0; padding: 12px 12px 5px; color: #ffaaa9; font-size: 12px; line-height: 1.45; }
.cp-inline-error > small { display: block; padding: 2px 12px 8px; color: #b9b1c0; font-size: 11px; line-height: 1.45; }
.cp-inline-error-actions { display: flex; flex-wrap: wrap; gap: 7px; padding: 3px 12px 12px; }
.cp-inline-error-actions button.primary { border-color: #715cff; color: white; background: #6550dd; }

.cp-analytics-scroll { padding-bottom: 28px; }
.cp-analytics-loading { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; align-items: center; margin-top: 16px; padding: 16px; border: 1px solid #302b40; border-radius: 13px; background: #17141f; }
.cp-analytics-loading .cp-live-dot { grid-row: 1 / 3; }
.cp-analytics-loading strong { font-size: 13px; }
.cp-analytics-loading small { color: #a09aab; font-size: 12px; }
/* The error and empty variants have no leading dot, so they span both columns. */
.cp-analytics-loading[data-state="error"], .cp-analytics-loading[data-state="empty"] { grid-template-columns: 1fr; justify-items: start; gap: 8px; }
.cp-analytics-loading[data-state="error"] { border-color: #5c3040; background: #1d1419; }
.cp-analytics-loading[data-state="error"] small { color: #e3b6c0; }
.cp-retry { min-height: 34px; margin-top: 2px; padding: 7px 14px; border: 1px solid var(--cp-line); border-radius: 9px; color: #f1eef7; background: #241f31; cursor: pointer; font-size: 12px; font-weight: 700; }
.cp-retry:hover { border-color: #554a70; background: #2c2640; }
/* Skeleton placeholders read as "content is coming" far better than a lone
   spinner, and they hold the layout so nothing jumps when data lands. */
.cp-skeleton-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; width: 100%; margin-top: 10px; }
.cp-skeleton { height: 54px; border-radius: 11px; background: linear-gradient(100deg, #1d1926 30%, #2a2438 50%, #1d1926 70%) #1d1926; background-size: 220% 100%; animation: cp-skeleton-sheen 1.4s linear infinite; }
@keyframes cp-skeleton-sheen { to { background-position: -220% 0; } }
.cp-panel[data-motion="reduced"] .cp-skeleton { animation: none; }
@media (prefers-reduced-motion: reduce) { .cp-skeleton { animation: none; } }
.cp-analytics-title { align-items: center; }
.cp-analytics-title > div > span { display: block; margin-top: 4px; color: #7e7788; font-size: 11px; }
.cp-refresh { display: grid; place-items: center; width: 33px; height: 33px; border: 1px solid #36303f; border-radius: 10px; color: #aaa0ff; background: #1b1724; cursor: pointer; font-size: 14px; transition: color .15s ease, border-color .15s ease, background-color .15s ease, transform .15s ease; }
.cp-refresh:hover:not(:disabled) { color: #fff; border-color: #4c4265; background: #221d2e; }
.cp-refresh:active:not(:disabled) { transform: rotate(45deg); }
.cp-refresh:disabled { opacity: .5; cursor: wait; }
.cp-pro-kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.cp-pro-kpis article { min-width: 0; padding: 11px; border: 1px solid #2c2835; border-radius: 11px; background: #15121b; }
.cp-pro-kpis article.accent { border-color: #4a3d78; background: linear-gradient(145deg, #211a36, #15121b); }
.cp-pro-kpis span { display: block; color: #88818f; font-size: 11px; }
.cp-pro-kpis b { display: block; margin: 5px 0 3px; font-size: 19px; letter-spacing: -.5px; }
.cp-pro-kpis em { display: block; overflow: hidden; color: #6d6775; font-size: 11px; font-style: normal; text-overflow: ellipsis; white-space: nowrap; }
.cp-history-chart { margin-top: 9px; padding: 11px; border: 1px solid #2d2838; border-radius: 12px; background: #14111b; }
.cp-history-chart header { display: flex; align-items: start; justify-content: space-between; gap: 8px; }
.cp-history-chart header strong { display: block; font-size: 11px; }
.cp-history-chart header span { display: block; margin-top: 4px; font-size: 17px; font-weight: 900; }
.cp-history-chart header em { color: #6ee0a8; font-size: 11px; font-style: normal; }
.cp-history-chart .cp-sparkline { position: static; display: block; width: 100%; height: 82px; margin-top: 4px; }
.cp-history-chart footer { display: flex; justify-content: space-between; color: #625c69; font-size: 11px; }
.cp-pro-section { margin-top: 10px; overflow: hidden; border: 1px solid #2c2835; border-radius: 12px; background: #131019; }
.cp-pro-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 11px; border-bottom: 1px solid #28232f; }
.cp-pro-section-head strong { display: block; font-size: 12px; }
.cp-pro-section-head span { display: block; margin-top: 3px; color: #756e7e; font-size: 11px; }
.cp-pro-section-head > em { color: #6ee0a8; font-size: 11px; font-style: normal; font-weight: 900; letter-spacing: .7px; }
.cp-momentum-list { padding: 0 9px 7px; }
.cp-momentum-list > article { display: grid; grid-template-columns: 18px 64px minmax(0, 1fr) auto; gap: 10px; align-items: center; min-height: 67px; padding: 9px 0; border-top: 1px solid #24202b; }
.cp-momentum-list > article:first-child { border-top: 0; }
.cp-momentum-list > article.current { margin: 0 -5px; padding-right: 5px; padding-left: 5px; border-radius: 9px; background: #211b31; }
.cp-rank { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 6px; color: #998cff; background: #2b253d; font-size: 11px; font-weight: 900; }
.cp-momentum-list img { width: 64px; height: 36px; border-radius: 7px; object-fit: cover; background: #24202c; }
.cp-momentum-main { min-width: 0; }
.cp-momentum-title {
  display: -webkit-box; overflow: hidden; color: inherit; font-size: 12.5px; font-weight: 600; line-height: 1.3;
  text-decoration: none; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere;
}
.cp-momentum-title:hover { color: var(--cp-purple-soft); text-decoration: underline; text-underline-offset: 2px; }
.cp-momentum-meta { display: flex; align-items: center; gap: 6px; min-width: 0; margin-top: 4px; }
.cp-momentum-meta small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-status { flex: 0 0 auto; padding: 1px 6px; border-radius: 99px; font-size: 10.5px !important; font-weight: 700; line-height: 1.5 !important; }
.cp-status.hot { color: #ffc07f; background: #4a2b18; }
.cp-status.growing { color: #78e2aa; background: #17372a; }
.cp-status.cooling { color: #dec27b; background: #3a321c; }
.cp-status.warming { color: #b8adff; background: #29233f; }
.cp-status.quiet { color: #88818f; background: #27232d; }
.cp-velocity-bar { height: 3px; margin: 5px 0; overflow: hidden; border-radius: 4px; background: #282331; }
.cp-velocity-bar i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #7560ec, #6ee0a8); }
.cp-momentum-main small { display: block; color: #696371; font-size: 11px; }
.cp-momentum-metrics { text-align: right; white-space: nowrap; }
.cp-momentum-metrics > b { display: block; color: #79e0aa; font-size: 14px; font-weight: 700; }
.cp-momentum-metrics > span, .cp-momentum-metrics > small { display: block; color: #696371; font-size: 11px; }
.cp-momentum-metrics > em { display: block; margin: 2px 0; font-size: 11px; font-style: normal; }
.cp-efficiency-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; padding: 9px; }
.cp-efficiency-grid article { padding: 10px 11px; border: 1px solid transparent; border-radius: 12px; }
.cp-efficiency-grid span { display: block; color: var(--cp-text-3); font-size: 11px; }
.cp-efficiency-grid b { display: block; margin-top: 5px; font-size: 14px; }
.cp-publication-list { padding: 0 9px 7px; }
.cp-publication-list article { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 8px 0; border-top: 1px solid #24202b; }
.cp-publication-list article:first-child { border-top: 0; }
.cp-publication-list img { width: 64px; height: 36px; border-radius: 6px; object-fit: cover; }
.cp-publication-list div { min-width: 0; }
.cp-publication-list strong { display: block; overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.cp-publication-list span { display: block; margin-top: 3px; color: #777080; font-size: 11px; }
.cp-publication-list small { display: block; margin-top: 3px; overflow: hidden; color: #696371; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.cp-publication-list small b { font-size: inherit; }
.cp-publication-list article > b { color: #a99cff; font-size: 11px; }
.cp-data-note { display: flex; justify-content: space-between; gap: 8px; padding: 11px 2px 0; color: #5f5966; font-size: 11px; }

.cp-resize-handle {
  position: absolute; z-index: 8; right: 3px; bottom: 3px; width: 22px; height: 22px;
  padding: 0; border: 0; border-radius: 0 0 16px 0; background: transparent; cursor: nwse-resize; touch-action: none;
}
.cp-resize-handle::after {
  content: ""; position: absolute; right: 5px; bottom: 5px; width: 9px; height: 9px;
  border-right: 2px solid var(--cp-purple-soft); border-bottom: 2px solid var(--cp-purple-soft); opacity: .78;
  transition: opacity .15s ease;
}
.cp-resize-handle:hover::after { opacity: 1; }
.cp-confirm-backdrop {
  position: absolute; z-index: 20; inset: 0; display: grid; place-items: center; padding: 18px;
  background: #08070dbd; backdrop-filter: blur(10px);
}
.cp-confirm-modal {
  width: min(100%, 430px); max-height: 100%; overflow: auto; padding: 18px;
  border: 1px solid #4a4167; border-radius: 17px; background: #17131f; box-shadow: 0 24px 80px #000c;
}
.cp-confirm-modal h3 { margin: 7px 0 14px; font-size: 18px; }
.cp-confirm-modal label { display: grid; gap: 6px; margin-top: 10px; color: #b9b2c4; font-size: 12px; font-weight: 750; }
.cp-confirm-modal textarea { width: 100%; min-height: 76px; max-height: 150px; padding: 9px; resize: vertical; border: 1px solid #373140; border-radius: 9px; color: #eee9f5; background: #0e0c13; }
.cp-confirm-modal p { color: #938b9f; line-height: 1.5; }
.cp-confirm-modal > div { display: flex; justify-content: flex-end; gap: 8px; }

.cp-panel[data-density="compact"] .cp-header { padding: 9px 11px; }
.cp-panel[data-density="compact"] .cp-tabs { margin-top: 7px; }
.cp-panel[data-density="compact"] .cp-scroll { padding: 9px 11px 14px; }
.cp-panel[data-density="compact"] .cp-card { margin-top: 6px; padding: 8px; }
.cp-panel[data-motion="reduced"] *,
.cp-panel[data-motion="reduced"] *::before,
.cp-panel[data-motion="reduced"] *::after {
  animation-duration: .01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: .01ms !important;
}
.cp-panel[data-theme="light"] {
  --cp-bg: #f5f2fb;
  --cp-card: #ffffff;
  --cp-line: #d9d1e4;
  --cp-text: #211b2b;
  --cp-muted: #726a7c;
  --cp-green: #15803d;
  color: var(--cp-text);
  border-color: #d7cee3;
  background: radial-gradient(circle at 80% -5%, color-mix(in srgb, var(--cp-purple) 22%, transparent) 0, transparent 30%), rgba(249, 247, 252, var(--cp-panel-alpha));
  box-shadow: 0 24px 75px #33234938;
}
.cp-panel[data-theme="light"] .cp-header,
.cp-panel[data-theme="light"] .cp-tabs,
.cp-panel[data-theme="light"] .cp-card,
.cp-panel[data-theme="light"] .cp-score-card,
.cp-panel[data-theme="light"] .cp-detected,
.cp-panel[data-theme="light"] .cp-pro-section,
.cp-panel[data-theme="light"] .cp-pro-kpis article,
.cp-panel[data-theme="light"] .cp-history-chart {
  border-color: #ddd5e7;
  background: #ffffffc7;
}
.cp-panel[data-theme="light"] .cp-field input,
.cp-panel[data-theme="light"] .cp-field textarea,
.cp-panel[data-theme="light"] .cp-field select,
.cp-panel[data-theme="light"] .cp-secondary,
.cp-panel[data-theme="light"] .cp-close {
  border-color: #d8d0e1;
  color: #2e2637;
  background: #faf8fc;
}
.cp-panel[data-theme="light"] .cp-tabs button.active { color: #fff; background: var(--cp-purple); }
.cp-panel[data-theme="light"] .cp-card p,
.cp-panel[data-theme="light"] .cp-card li,
.cp-panel[data-theme="light"] .cp-description,
.cp-panel[data-theme="light"] .cp-brand span { color: #6f6679; }
.cp-panel[data-theme="light"] .cp-refresh,
.cp-panel[data-theme="light"] .cp-analytics-loading,
.cp-panel[data-theme="light"] .cp-upload,
.cp-panel[data-theme="light"] .cp-upload-assistant,
.cp-panel[data-theme="light"] .cp-warmup,
.cp-panel[data-theme="light"] .cp-provider-notice,
.cp-panel[data-theme="light"] .cp-title-option,
.cp-panel[data-theme="light"] .cp-understanding-grid > div,
.cp-panel[data-theme="light"] .cp-hook-inline > div,
.cp-panel[data-theme="light"] .cp-panel-hook-score,
.cp-panel[data-theme="light"] .cp-retention-inline,
.cp-panel[data-theme="light"] .cp-chip,
.cp-panel[data-theme="light"] .cp-efficiency-grid article,
.cp-panel[data-theme="light"] .cp-momentum-list > article,
.cp-panel[data-theme="light"] .cp-publication-list article {
  border-color: #ddd5e7;
  background: #ffffff;
  color: #211b2b;
}
.cp-panel[data-theme="light"] .cp-refresh { color: #6a54e0; background: #f4f0fa; }
.cp-panel[data-theme="light"] .cp-refresh:hover:not(:disabled) { color: #4c38c4; border-color: #cabdea; background: #ece5f7; }
.cp-panel[data-theme="light"] .cp-title-option,
.cp-panel[data-theme="light"] .cp-momentum-list > article,
.cp-panel[data-theme="light"] .cp-publication-list article { border-top: 1px solid #e6dfee; border-left: 0; border-right: 0; border-bottom: 0; background: transparent; }
.cp-panel[data-theme="light"] .cp-momentum-list > article.current { background: #f1ecfb; }
.cp-panel[data-theme="light"] .cp-score-ring::after { background: #ffffff; }
.cp-panel[data-theme="light"] .cp-title-option p,
.cp-panel[data-theme="light"] .cp-understanding-grid b,
.cp-panel[data-theme="light"] .cp-hook-inline p,
.cp-panel[data-theme="light"] .cp-momentum-main strong,
.cp-panel[data-theme="light"] .cp-publication-list strong { color: #2e2637; }
.cp-panel[data-theme="light"] .cp-momentum-metrics > b { color: #15803d; }
.cp-panel[data-theme="light"] .cp-history-chart header em,
.cp-panel[data-theme="light"] .cp-pro-section-head > em,
.cp-panel[data-theme="light"] .cp-panel-hook-score strong { color: #15803d; }
.cp-panel[data-theme="light"] .cp-panel-hook-score span { color: #4d7d67; }
.cp-panel[data-theme="light"] .cp-detected span,
.cp-panel[data-theme="light"] .cp-card-title span,
.cp-panel[data-theme="light"] .cp-factor div,
.cp-panel[data-theme="light"] .cp-understanding-grid span,
.cp-panel[data-theme="light"] .cp-pro-kpis span,
.cp-panel[data-theme="light"] .cp-pro-kpis em,
.cp-panel[data-theme="light"] .cp-pro-section-head span,
.cp-panel[data-theme="light"] .cp-history-chart footer,
.cp-panel[data-theme="light"] .cp-efficiency-grid span,
.cp-panel[data-theme="light"] .cp-publication-list span,
.cp-panel[data-theme="light"] .cp-publication-list small,
.cp-panel[data-theme="light"] .cp-momentum-main small,
.cp-panel[data-theme="light"] .cp-analytics-loading small,
.cp-panel[data-theme="light"] .cp-analytics-title > div > span,
.cp-panel[data-theme="light"] .cp-data-note,
.cp-panel[data-theme="light"] .cp-score-mini { color: #655d71; }
.cp-panel[data-theme="light"] .cp-login p { color: #6f6679; }
.cp-panel[data-theme="light"] .cp-list,
.cp-panel[data-theme="light"] .cp-understanding > p { color: #4c4457; }
.cp-panel[data-theme="light"] .cp-bar,
.cp-panel[data-theme="light"] .cp-velocity-bar { background: #ece5f7; }
.cp-panel[data-theme="light"] .cp-chip { color: #4c4457; }
.cp-panel[data-theme="light"] .positive,
.cp-realtime[data-theme="light"] .positive { color: #15803d !important; }
.cp-panel[data-theme="light"] .negative,
.cp-realtime[data-theme="light"] .negative { color: #dc2626 !important; }

.cp-realtime[data-theme="light"] {
  color: #211b2b;
  border-color: rgba(65, 72, 92, .16);
  background:
    radial-gradient(circle at 88% -10%, color-mix(in srgb, var(--cp-purple) 13%, transparent), transparent 44%),
    linear-gradient(162deg, rgba(255, 255, 255, .85), transparent 48%),
    rgba(249, 247, 252, var(--cp-panel-alpha));
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .9) inset,
    0 24px 70px rgba(51, 35, 73, .15), 0 0 0 1px rgba(0, 0, 0, .03);
}
.cp-realtime[data-theme="light"] .cp-live-dot { border-color: rgba(65, 72, 92, .12); }
.cp-realtime[data-theme="light"].collapsed {
  border-color: rgba(65, 72, 92, .16);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .9) inset,
    0 6px 20px rgba(51, 35, 73, .12), 0 0 0 1px rgba(0, 0, 0, .03);
}
.cp-realtime[data-theme="light"].collapsed:hover {
  border-color: color-mix(in srgb, var(--cp-purple) 30%, rgba(65, 72, 92, .18));
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .95) inset,
    0 8px 26px rgba(51, 35, 73, .16), 0 0 20px color-mix(in srgb, var(--cp-purple) 12%, transparent);
}
.cp-realtime[data-theme="light"] .cp-top-dock { background: none; }
.cp-realtime[data-theme="light"] .cp-top-dock b { color: #1d1826; }
.cp-realtime[data-theme="light"] .cp-dock-metrics > button { color: #6f6679; }
.cp-realtime[data-theme="light"] .cp-dock-metrics > button + button::before { background: rgba(65, 72, 92, .16); }
.cp-realtime[data-theme="light"] .cp-dock-metrics > button:hover { color: #1d1826; }
.cp-realtime[data-theme="light"] .cp-dock-metrics > button.active { color: #1d1826; }
.cp-realtime[data-theme="light"] .cp-dock-metrics > button.active small { color: #5b3fd6; }
.cp-realtime[data-theme="light"] .cp-dock-metrics > button.incomplete small { color: #a4701a; }
.cp-realtime[data-theme="light"] .cp-dock-metrics > button.pending b { color: #948d9e; }
.cp-realtime[data-theme="light"] .cp-dock-expand { color: #4c4457; background: rgba(65, 72, 92, .1); }
.cp-realtime[data-theme="light"] .cp-dock-expand:hover { color: #211b2b; background: rgba(65, 72, 92, .18); }
.cp-realtime[data-theme="light"] .cp-dock-hide { color: #948d9e; }
.cp-realtime[data-theme="light"] .cp-dock-hide:hover { color: #b23a52; background: rgba(178, 58, 82, .12); }

/* Readability floor for the assistant and Studio-native result cards. */
.cp-panel button,
.cp-panel input,
.cp-panel textarea,
.cp-panel select,
.cp-inline-shell button { font-size: 13px; }
.cp-panel p,
.cp-panel li,
.cp-panel small,
.cp-panel .cp-field > span,
.cp-inline-shell p,
.cp-inline-shell li,
.cp-inline-shell small,
.cp-inline-shell figcaption span,
.cp-inline-shell figcaption a,
.cp-analytics-scroll span,
.cp-analytics-scroll small,
.cp-analytics-scroll em { font-size: 12px; line-height: 1.45; }
.cp-inline-head strong,
.cp-inline-card header strong,
.cp-title-option p,
.cp-momentum-main strong,
.cp-publication-list strong { font-size: 12px; }
.cp-analytics-title h2 { font-size: 20px; }
.cp-pro-section-head strong { font-size: 13px; }
.cp-pro-kpis b { font-size: 21px; }
.cp-panel button:focus-visible,
.cp-panel a:focus-visible,
.cp-panel input:focus-visible,
.cp-panel select:focus-visible,
.cp-panel textarea:focus-visible,
.cp-realtime button:focus-visible,
.cp-inline-shell button:focus-visible,
.cp-inline-shell a:focus-visible {
  outline: 2px solid #a793ff;
  outline-offset: 2px;
}
@keyframes cp-shimmer { to { background-position: -200% 0; } }
@keyframes cp-card-in { from { opacity: 0; transform: translateY(7px); } }

@media (prefers-reduced-motion: reduce) {
  .cp-panel *,
  .cp-panel *::before,
  .cp-panel *::after,
  .cp-realtime *,
  .cp-realtime *::before,
  .cp-realtime *::after,
  .cp-inline-shell *,
  .cp-inline-shell *::before,
  .cp-inline-shell *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}

@media (max-width: 1450px) {
  .cp-realtime.collapsed.undocked.panel-open { right: 464px; }
}
@media (max-width: 1180px) {
  .cp-realtime.collapsed.undocked, .cp-realtime.collapsed.undocked.panel-open { right: 18px; top: 72px; bottom: auto; }
}
@media (max-width: 520px) {
  .cp-panel { inset: 0; width: auto; border-radius: 0; }
  .cp-launcher-shell { right: 10px; bottom: 10px; }
  .cp-realtime.expanded { top: 62px; right: 8px; left: 8px; width: auto; }
  .cp-realtime.collapsed.undocked { right: 8px; top: 58px; bottom: auto; left: 8px; width: auto; }
  /* Only the FLOATING widget steps aside for the panel on a narrow screen.
     Hiding the docked variant as well left its 212px layout spacer in the
     masthead with nothing rendered in it — a visible hole in YouTube's own
     header next to the search field. */
  .cp-realtime.undocked.panel-open { display: none; }
  .cp-inline-grid { grid-template-columns: 1fr; }
  .cp-inline-card.cp-inline-wide { grid-column: auto; }
  .cp-inline-seo { grid-template-columns: 1fr; }
  .cp-hook-inline { grid-template-columns: 54px 1fr; }
  .cp-preview-grid { grid-template-columns: 1fr; }
}
@media (min-width: 521px) and (max-width: 900px) {
  .cp-realtime.collapsed.undocked, .cp-realtime.collapsed.undocked.panel-open { right: 12px; top: 72px; bottom: auto; left: auto; width: min(455px, calc(100vw - 24px)); }
  /* See the note in the max-width: 520px block. */
  .cp-realtime.undocked.panel-open { display: none; }
}

/* Liquid Glass 2.0 — high-depth surfaces shared by panel, widget and cards. */
:host {
  --cp-bg: #080910;
  --cp-card: #141620;
  --cp-line: rgba(255, 255, 255, .095);
  --cp-text: #f6f7fb;
  --cp-muted: #9da0ae;
  --cp-green: #5de3ad;
  --cp-glass-rgb: 18, 20, 31;
  --cp-glass-strong-rgb: 23, 25, 38;
  --cp-shadow:
    0 1px 0 rgba(255, 255, 255, .07) inset,
    0 -1px 0 rgba(0, 0, 0, .24) inset,
    0 18px 48px rgba(0, 0, 0, .3);
  --cp-shadow-floating:
    0 1px 0 rgba(255, 255, 255, .09) inset,
    0 30px 90px rgba(0, 0, 0, .5),
    0 8px 25px rgba(0, 0, 0, .28);
  --cp-ease: cubic-bezier(.22, 1, .36, 1);
  --cp-spring: cubic-bezier(.2, .9, .2, 1.15);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", Inter, "Segoe UI", sans-serif;
}

.cp-launcher {
  overflow: hidden;
  border-color: color-mix(in srgb, var(--cp-purple-soft) 34%, rgba(255, 255, 255, .1));
  border-radius: 17px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, .1), transparent 42%),
    radial-gradient(circle at 10% 0, color-mix(in srgb, var(--cp-purple) 22%, transparent), transparent 48%),
    rgba(14, 15, 25, .82);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .12) inset,
    0 20px 55px rgba(0, 0, 0, .5),
    0 0 34px color-mix(in srgb, var(--cp-purple) 23%, transparent);
  backdrop-filter: blur(24px) saturate(155%);
  -webkit-backdrop-filter: blur(24px) saturate(155%);
  transition: transform .3s var(--cp-spring), border-color .25s ease, box-shadow .25s ease;
}

.cp-launcher:hover {
  border-color: color-mix(in srgb, var(--cp-purple-soft) 66%, white 8%);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .14) inset,
    0 24px 64px rgba(0, 0, 0, .55),
    0 0 44px color-mix(in srgb, var(--cp-purple) 31%, transparent);
  transform: translateY(-3px) scale(1.015);
}

.cp-launcher:active { transform: scale(.975); }

.cp-logo {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, .2);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, .28), transparent 42%),
    linear-gradient(145deg, color-mix(in srgb, var(--cp-purple-soft) 90%, white 8%), var(--cp-purple));
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .28) inset,
    0 9px 22px color-mix(in srgb, var(--cp-purple) 27%, transparent);
}

.cp-panel {
  border-color: rgba(255, 255, 255, .13);
  border-radius: 24px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, .075), transparent 30%),
    radial-gradient(circle at 86% -4%, color-mix(in srgb, var(--cp-purple) 24%, transparent), transparent 31%),
    rgba(9, 10, 17, var(--cp-panel-alpha));
  box-shadow: var(--cp-shadow-floating);
  backdrop-filter: blur(30px) saturate(155%);
  -webkit-backdrop-filter: blur(30px) saturate(155%);
  animation: cp-liquid-enter .38s var(--cp-spring);
}

@keyframes cp-liquid-enter {
  from { opacity: 0; transform: translateX(24px) scale(.965); }
}

/* The header used to be 66px of mostly nothing: a logo tile, the product name
   and "YOUTUBE GROWTH WORKSPACE" set in wide grey uppercase. The subtitle told
   the user nothing they did not already know, so the row is now half the
   height and the second line carries live status instead. */
.cp-header {
  min-height: 52px;
  gap: var(--cp-sp-2);
  padding: var(--cp-sp-2) var(--cp-sp-3);
  border-bottom-color: rgba(255, 255, 255, .07);
  background: linear-gradient(180deg, rgba(255, 255, 255, .035), transparent);
}

.cp-header .cp-logo {
  width: 26px;
  height: 26px;
  border-radius: var(--cp-r-sm);
}

.cp-brand strong {
  font-size: var(--cp-fs-sm);
  font-weight: 650;
  letter-spacing: -.2px;
}
.cp-brand span {
  margin-top: 1px;
  overflow: hidden;
  color: var(--cp-text-3);
  font-size: var(--cp-fs-xs);
  font-weight: 500;
  letter-spacing: .2px;
  text-overflow: ellipsis;
  text-transform: none;
  white-space: nowrap;
}

.cp-close,
.cp-secondary,
.cp-refresh,
.cp-dock-expand {
  border-color: rgba(255, 255, 255, .095);
  color: #c1c4cf;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .065), transparent),
    rgba(var(--cp-glass-strong-rgb), .54);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .07) inset,
    0 7px 18px rgba(0, 0, 0, .16);
  backdrop-filter: blur(12px);
  transition: transform .22s var(--cp-spring), color .2s ease, border-color .2s ease, background .2s ease, box-shadow .2s ease;
}

.cp-close:hover,
.cp-secondary:hover:not(:disabled),
.cp-refresh:hover:not(:disabled),
.cp-dock-expand:hover {
  color: white;
  border-color: rgba(255, 255, 255, .17);
  background: rgba(255, 255, 255, .085);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .1) inset,
    0 10px 24px rgba(0, 0, 0, .22);
  transform: translateY(-1px);
}

.cp-close:active,
.cp-secondary:active:not(:disabled) { transform: scale(.95); }

.cp-tabs {
  border: 1px solid rgba(255, 255, 255, .07);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .025), transparent),
    rgba(4, 5, 10, .4);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .035) inset,
    0 6px 16px rgba(0, 0, 0, .14);
}

/* A segmented control, not two large buttons. The old tabs were 44px tall with
   12px bold text and ate a whole band of the panel before any content. */
.cp-tabs {
  margin: var(--cp-sp-3) var(--cp-sp-3) 0;
  padding: 3px;
  border-radius: var(--cp-r-md);
}
.cp-tabs button {
  padding: 7px var(--cp-sp-2);
  border-radius: 9px;
  font-size: var(--cp-fs-xs);
  font-weight: 600;
  letter-spacing: -.1px;
}
.cp-tabs button { transition: color .22s ease, background .27s var(--cp-ease), box-shadow .22s ease, transform .18s ease; }
.cp-tabs button.active {
  color: white;
  background:
    linear-gradient(145deg, color-mix(in srgb, var(--cp-purple) 32%, rgba(255, 255, 255, .08)), color-mix(in srgb, var(--cp-purple) 14%, transparent)),
    rgba(255, 255, 255, .05);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .12) inset,
    0 6px 15px rgba(0, 0, 0, .2);
}

.cp-scroll {
  padding: var(--cp-sp-3) var(--cp-sp-3) 0;
  scrollbar-color: rgba(255, 255, 255, .17) transparent;
  /* Top fade only. The bottom fade used to cut through the action bar, so the
     primary button always looked half-rendered. */
  mask-image: linear-gradient(to bottom, transparent 0, black 10px);
}

/* The Optimize tab is a long form and its submit button used to scroll off the
   bottom. Pinning the action bar keeps the primary action reachable at any
   scroll position, which is the whole point of a docked panel. */
.cp-actions {
  position: sticky;
  bottom: 0;
  z-index: 2;
  margin: var(--cp-sp-3) calc(var(--cp-sp-3) * -1) 0;
  padding: var(--cp-sp-3);
  border-top: 1px solid rgba(255, 255, 255, .07);
  /* Opaque, not a fade: while the form is scrolled the bar floats over the
     content above it, and a translucent edge made that read as a glitch
     rather than as a pinned toolbar. */
  background: rgba(var(--cp-glass-strong-rgb), .96);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
}
/* Scrim above the bar so content fades out under it rather than being sliced
   mid-line. At 16px the cut still landed inside a row of text; 32px covers a
   full line at any of the panel's sizes. */
.cp-actions::before {
  content: "";
  position: absolute;
  right: 0;
  bottom: 100%;
  left: 0;
  height: 32px;
  background: linear-gradient(
    180deg,
    transparent,
    rgba(var(--cp-glass-strong-rgb), .72) 55%,
    rgba(var(--cp-glass-strong-rgb), .96)
  );
  pointer-events: none;
}

/* ---- Section headings ----------------------------------------------------
   The eyebrow was 11px 900-weight purple with 1.4px tracking above a 18px
   heading that wrapped onto two lines — a magazine headline on a 440px
   instrument panel. Both are dialled back so the data below leads. */
.cp-kicker {
  color: var(--cp-purple-soft);
  font-size: var(--cp-fs-xs);
  font-weight: 650;
  letter-spacing: .8px;
  opacity: .9;
}

.cp-heading-row {
  align-items: center;
  margin: var(--cp-sp-2) 0 var(--cp-sp-3);
  gap: var(--cp-sp-3);
}

.cp-heading-row h2 {
  font-size: var(--cp-fs-lg);
  font-weight: 650;
  letter-spacing: -.4px;
  line-height: 1.25;
}

/* ---- Form fields ---------------------------------------------------------
   Inputs were 54px tall with 10px gaps between every field, so the Optimize
   tab was a long scroll of mostly empty space. */
.cp-field { gap: var(--cp-sp-1); margin-bottom: var(--cp-sp-3); }

.cp-field > span {
  align-items: baseline;
  color: var(--cp-text-2);
  font-size: var(--cp-fs-xs);
  font-weight: 550;
}
.cp-field > span em { color: var(--cp-text-3); font-size: var(--cp-fs-xs); }

.cp-field input,
.cp-field select { min-height: 38px; }
.cp-field input,
.cp-field textarea,
.cp-field select { padding: 9px 11px; font-size: var(--cp-fs-sm); }
.cp-field textarea { min-height: 64px; line-height: 1.5; }
.cp-field input::placeholder,
.cp-field textarea::placeholder { color: #6b6678; }

.cp-grid { gap: var(--cp-sp-2); }

.cp-field input,
.cp-field textarea,
.cp-field select,
.cp-confirm-modal textarea {
  border-color: rgba(255, 255, 255, .095);
  border-radius: 11px;
  color: var(--cp-text);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .022), transparent),
    rgba(4, 5, 10, .48);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .03),
    0 1px 5px rgba(0, 0, 0, .17) inset;
  color-scheme: dark;
  transition: border-color .22s ease, box-shadow .22s ease, background .22s ease;
}

.cp-field input:hover,
.cp-field textarea:hover,
.cp-field select:hover { border-color: rgba(255, 255, 255, .16); }

.cp-field input:focus,
.cp-field textarea:focus,
.cp-field select:focus,
.cp-confirm-modal textarea:focus {
  border-color: color-mix(in srgb, var(--cp-purple-soft) 64%, white 4%);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--cp-purple) 15%, transparent),
    0 8px 24px color-mix(in srgb, var(--cp-purple) 9%, transparent);
}

.cp-primary {
  position: relative;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--cp-purple-soft) 42%, rgba(255, 255, 255, .22));
  color: white;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .22), transparent 48%),
    linear-gradient(135deg, color-mix(in srgb, var(--cp-purple-soft) 82%, white 8%), var(--cp-purple));
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .31) inset,
    0 12px 28px color-mix(in srgb, var(--cp-purple) 28%, transparent),
    0 3px 9px rgba(0, 0, 0, .23);
  text-shadow: 0 1px 1px rgba(0, 0, 0, .22);
  transition: transform .25s var(--cp-spring), filter .22s ease, box-shadow .22s ease;
}

.cp-primary:hover:not(:disabled) {
  filter: brightness(1.06) saturate(1.07);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .36) inset,
    0 16px 36px color-mix(in srgb, var(--cp-purple) 35%, transparent);
  transform: translateY(-2px) scale(1.01);
}

.cp-primary:active:not(:disabled) { transform: scale(.975); }

.cp-primary,
.cp-secondary {
  min-height: 40px;
  padding: 0 var(--cp-sp-4);
  border-radius: var(--cp-r-md);
  font-size: var(--cp-fs-sm);
  font-weight: 600;
  letter-spacing: -.1px;
}
.cp-actions { gap: var(--cp-sp-2); }

/* ---- Cards ---------------------------------------------------------------
   Consistent padding and radius across every surface in the panel. The base
   layer had .cp-card at 11px/12px, KPI cards at 11px/14px and the chart at
   11px/14px — close enough to look accidental rather than intentional. */
.cp-card,
.cp-history-chart,
.cp-score-card,
.cp-detected,
.cp-upload-assistant {
  padding: var(--cp-sp-3);
  border-radius: var(--cp-r-md);
}
.cp-card { margin-top: var(--cp-sp-2); }

.cp-card-title { margin-bottom: var(--cp-sp-2); }
.cp-card-title strong { font-size: var(--cp-fs-sm); font-weight: 620; }
.cp-card-title span { color: var(--cp-text-3); font-size: var(--cp-fs-xs); }

.cp-list { color: var(--cp-text-2); font-size: var(--cp-fs-sm); line-height: 1.6; }

/* ---- History chart -------------------------------------------------------
   The sparkline sat flush against the bottom edge with no fill, so a flat
   series looked like a broken render. Giving the plot its own inset band and
   a baseline makes "flat" read as flat rather than as missing. */
.cp-history-chart header { align-items: baseline; }
.cp-history-chart header strong { font-size: var(--cp-fs-sm); font-weight: 620; }
.cp-history-chart header span {
  margin-top: var(--cp-sp-1);
  font-size: var(--cp-fs-xl);
  font-weight: 640;
  font-feature-settings: var(--cp-nums);
  letter-spacing: -.7px;
}
.cp-history-chart header em { font-size: var(--cp-fs-xs); }

.cp-history-chart .cp-sparkline {
  height: 76px;
  margin-top: var(--cp-sp-3);
  padding-bottom: 1px;
  border-bottom: 1px solid rgba(255, 255, 255, .08);
}

.cp-history-chart footer {
  margin-top: var(--cp-sp-2);
  color: var(--cp-text-3);
  font-size: var(--cp-fs-xs);
  font-feature-settings: var(--cp-nums);
}

.cp-upload-assistant,
.cp-upload,
.cp-score-card,
.cp-card,
.cp-detected,
.cp-pro-section,
.cp-pro-kpis article,
/* The efficiency tiles were the last flat opaque fill (#1b1722) left in the
   panel: every card around them was glass, these were plain slabs. */
.cp-efficiency-grid article,
.cp-history-chart,
.cp-analytics-loading {
  border-color: rgba(255, 255, 255, .08);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, .05), transparent 48%),
    rgba(var(--cp-glass-rgb), .5);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .045) inset,
    0 10px 27px rgba(0, 0, 0, .14);
}

.cp-score-card,
.cp-card,
.cp-pro-kpis article,
.cp-history-chart { border-radius: 14px; }

.cp-card,
.cp-pro-kpis article {
  transition: transform .28s var(--cp-ease), border-color .22s ease, background .22s ease, box-shadow .22s ease;
}

.cp-card:hover,
.cp-pro-kpis article:hover {
  border-color: rgba(255, 255, 255, .14);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, .075), transparent 48%),
    color-mix(in srgb, var(--cp-purple) 5%, rgba(var(--cp-glass-rgb), .58));
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .07) inset,
    0 15px 34px rgba(0, 0, 0, .22);
  transform: translateY(-2px);
}

.cp-chip {
  padding: 5px 9px;
  border-color: rgba(255, 255, 255, .08);
  border-radius: var(--cp-r-full);
  color: var(--cp-text-2);
  background: color-mix(in srgb, var(--cp-purple) 9%, rgba(255, 255, 255, .025));
  box-shadow: 0 1px 0 rgba(255, 255, 255, .04) inset;
  font-size: var(--cp-fs-xs);
}

/* ---- Metric cards --------------------------------------------------------
   Two problems fixed here.

   First, the grid was ragged: five metrics in a two-column grid left a hole
   beside the last card, which read as a rendering bug. An odd final card now
   spans the full width and lays its label and value out on one line.

   Second, each card was ~150px tall for a single number. The panel could show
   five metrics in a whole viewport; it now shows the same five in about half
   the space, which is the point of a docked instrument panel. */
.cp-pro-kpis {
  gap: var(--cp-sp-2);
  margin-top: var(--cp-sp-1);
}

.cp-pro-kpis article {
  display: grid;
  gap: 2px;
  padding: var(--cp-sp-3);
  border-radius: var(--cp-r-md);
}

.cp-pro-kpis article:last-child:nth-child(odd) {
  grid-column: 1 / -1;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  column-gap: var(--cp-sp-3);
}
/* Label and caption keep the left column, the number sits to the right, so the
   row still reads label-first like every other card. */
.cp-pro-kpis article:last-child:nth-child(odd) span { grid-area: 1 / 1; }
.cp-pro-kpis article:last-child:nth-child(odd) em { grid-area: 2 / 1; }
.cp-pro-kpis article:last-child:nth-child(odd) b {
  grid-area: 1 / 2 / span 2 / 3;
  align-self: center;
  margin: 0;
}

.cp-pro-kpis span {
  color: var(--cp-text-3);
  font-size: var(--cp-fs-xs);
  font-weight: 550;
}

.cp-pro-kpis b {
  margin: 3px 0 0;
  font-size: var(--cp-fs-2xl);
  font-weight: 640;
  font-feature-settings: var(--cp-nums);
  letter-spacing: -1px;
  line-height: 1.05;
}

.cp-pro-kpis em {
  color: var(--cp-text-3);
  font-size: var(--cp-fs-xs);
  line-height: 1.35;
}

/* The accent card marks "this is the number you opened the panel for". It was
   a flat purple-grey that barely differed from its neighbours. */
.cp-pro-kpis article.accent {
  border-color: color-mix(in srgb, var(--cp-purple) 42%, transparent);
  background:
    linear-gradient(150deg, color-mix(in srgb, var(--cp-purple) 26%, transparent), transparent 62%),
    rgba(var(--cp-glass-rgb), .55);
}
.cp-pro-kpis article.accent b { color: #fff; }
.cp-pro-kpis article.accent span { color: var(--cp-purple-soft); }

.cp-confirm-backdrop {
  background: rgba(3, 4, 8, .62);
  backdrop-filter: blur(16px) saturate(120%);
  -webkit-backdrop-filter: blur(16px) saturate(120%);
  animation: cp-modal-fade .22s ease both;
}

.cp-confirm-modal {
  padding: 21px;
  border-color: rgba(255, 255, 255, .15);
  border-radius: 21px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, .095), transparent 42%),
    radial-gradient(circle at 0 0, color-mix(in srgb, var(--cp-purple) 13%, transparent), transparent 37%),
    rgba(15, 16, 25, .92);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .1) inset,
    0 30px 90px rgba(0, 0, 0, .58);
  backdrop-filter: blur(30px) saturate(150%);
  -webkit-backdrop-filter: blur(30px) saturate(150%);
  animation: cp-modal-enter .32s var(--cp-spring) both;
}

@keyframes cp-modal-fade { from { opacity: 0; } }
@keyframes cp-modal-enter { from { opacity: 0; transform: translateY(14px) scale(.965); } }

.cp-realtime {
  border-color: rgba(255, 255, 255, .12);
  border-radius: 19px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, .07), transparent 36%),
    radial-gradient(circle at 86% 0, color-mix(in srgb, var(--cp-purple) 18%, transparent), transparent 32%),
    rgba(11, 12, 19, .88);
  box-shadow: var(--cp-shadow-floating);
  backdrop-filter: blur(27px) saturate(150%);
  -webkit-backdrop-filter: blur(27px) saturate(150%);
}

.cp-top-dock {
  border-color: rgba(255, 255, 255, .07);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .045), transparent),
    rgba(15, 16, 24, .7);
}

/* The selected metric is a glass pill inset in the capsule. It used to be a
   38px square-cornered block that filled the capsule's full height — a hard
   rectangle inside a fully rounded shape — with a glowing underline from the
   earlier design still drawn on top of it. One treatment now, not two. */
.cp-dock-metrics > button.active {
  margin: 4px 1px;
  border-radius: 999px;
  color: white;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .16), rgba(255, 255, 255, .02) 60%),
    color-mix(in srgb, var(--cp-purple) 30%, rgba(255, 255, 255, .06));
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .22) inset,
    0 -1px 0 rgba(0, 0, 0, .2) inset,
    0 4px 12px color-mix(in srgb, var(--cp-purple) 26%, transparent);
}
.cp-dock-metrics > button.active::after { content: none; }
/* No hairline next to the pill: the pill is the separation. */
.cp-dock-metrics > button.active::before,
.cp-dock-metrics > button.active + button::before { content: none; }
.cp-realtime[data-theme="light"] .cp-dock-metrics > button.active {
  color: #1d1826;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .95), rgba(255, 255, 255, .6)),
    color-mix(in srgb, var(--cp-purple) 14%, white);
  box-shadow:
    0 1px 0 white inset,
    0 0 0 1px color-mix(in srgb, var(--cp-purple) 26%, transparent),
    0 4px 12px color-mix(in srgb, var(--cp-purple) 16%, transparent);
}

.cp-inline-shell {
  overflow: hidden;
  border-color: rgba(255, 255, 255, .11);
  border-radius: 17px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, .07), transparent 42%),
    rgba(25, 25, 31, .9);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .08) inset,
    0 16px 42px rgba(0, 0, 0, .28);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
}

.cp-inline-head {
  border-bottom-color: rgba(255, 255, 255, .065);
  background: linear-gradient(180deg, rgba(255, 255, 255, .035), transparent);
}

.cp-inline-card {
  border-color: rgba(255, 255, 255, .085);
  border-radius: 13px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, .055), transparent 49%),
    rgba(255, 255, 255, .025);
  box-shadow: 0 1px 0 rgba(255, 255, 255, .04) inset;
  animation: cp-card-in .38s var(--cp-ease) both;
}

.cp-inline-titles button,
.cp-inline-card > button,
.cp-inline-card footer button,
.cp-inline-error button {
  border-color: rgba(255, 255, 255, .1);
  border-radius: 9px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .06), transparent),
    rgba(255, 255, 255, .035);
}

.cp-panel[data-theme="light"] {
  --cp-bg: #eef2f7;
  --cp-card: #f9fbff;
  --cp-line: rgba(59, 66, 86, .13);
  --cp-text: #232634;
  --cp-muted: #687082;
  --cp-glass-rgb: 248, 250, 255;
  --cp-glass-strong-rgb: 255, 255, 255;
  color: #232634;
  border-color: rgba(58, 66, 86, .17);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, .84), transparent 38%),
    radial-gradient(circle at 86% -4%, color-mix(in srgb, var(--cp-purple) 13%, transparent), transparent 33%),
    rgba(243, 247, 252, var(--cp-panel-alpha));
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .94) inset,
    0 30px 90px rgba(43, 52, 75, .2),
    0 8px 24px rgba(43, 52, 75, .09);
}

.cp-panel[data-theme="light"] .cp-field input,
.cp-panel[data-theme="light"] .cp-field textarea,
.cp-panel[data-theme="light"] .cp-field select,
.cp-panel[data-theme="light"] .cp-confirm-modal textarea {
  color: #282c39;
  border-color: rgba(57, 65, 85, .16);
  background: rgba(255, 255, 255, .68);
  color-scheme: light;
}

.cp-panel[data-theme="light"] .cp-confirm-modal {
  color: #242735;
  border-color: rgba(57, 65, 85, .18);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, .9), transparent 44%),
    rgba(245, 248, 253, .94);
  box-shadow:
    0 1px 0 white inset,
    0 30px 90px rgba(43, 52, 75, .22);
}

@media (max-width: 520px) {
  .cp-panel {
    inset: 0 !important;
    width: auto !important;
    height: auto !important;
    min-width: 0 !important;
    max-width: none !important;
    max-height: none !important;
    border-width: 0;
    border-radius: 0;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .cp-header { min-height: 62px; }
  .cp-tabs { margin-inline: 10px; }
  .cp-scroll { padding-inline: 11px; }
  .cp-confirm-backdrop { position: fixed; padding: 12px; }
  .cp-confirm-modal { border-radius: 19px; padding: 17px; }
  .cp-confirm-modal > div { display: grid; grid-template-columns: 1fr 1fr; }
  .cp-realtime.expanded {
    right: 8px !important;
    left: 8px !important;
    width: auto !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cp-panel,
  .cp-launcher,
  .cp-confirm-backdrop,
  .cp-confirm-modal { animation: none !important; }
}

/* (The expanded-card styles live in one section at the end of this sheet.) */

/* ---- One glass recipe ----------------------------------------------------
   Every inner surface used to pick its own fill: the leader rows and the
   sign-in card were flat opaque hex (#1c1b20, #191720) while the KPI cards
   beside them were translucent, so the same card read as glass in one block
   and as a solid tile in the next. They now compose from four variables.

   Only the outermost surfaces spend a backdrop-filter. A blur per row would
   cost a compositing layer per row for an effect the parent already casts. */
.cp-realtime {
  --cp-glass-fill: rgba(255, 255, 255, .032);
  --cp-glass-sheen: linear-gradient(158deg, rgba(255, 255, 255, .085), transparent 58%);
  --cp-glass-rim: 0 1px 0 rgba(255, 255, 255, .1) inset, 0 -1px 0 rgba(0, 0, 0, .22) inset;
  --cp-glass-lift: 0 10px 26px rgba(0, 0, 0, .26);
}
.cp-realtime[data-theme="light"] {
  /* The light theme only ever re-pointed --cp-text on .cp-panel, so anything
     in the widget that read it — the editor's group headings, the selected
     chips — rendered near-white on a near-white card. */
  --cp-text: #1d1826;
  --cp-glass-fill: rgba(255, 255, 255, .55);
  --cp-glass-sheen: linear-gradient(158deg, rgba(255, 255, 255, .8), transparent 62%);
  --cp-glass-rim: 0 1px 0 rgba(255, 255, 255, .9) inset, 0 -1px 0 rgba(40, 50, 75, .06) inset;
  --cp-glass-lift: 0 10px 24px rgba(40, 50, 75, .1);
}
.cp-realtime .cp-widget-editor {
  border: 1px solid var(--cp-widget-line);
  background: var(--cp-glass-sheen), var(--cp-glass-fill);
  box-shadow: var(--cp-glass-rim);
}
/* Specular rim on the two surfaces that actually float above the page. A
   1px top-edge highlight is what separates "translucent panel" from "pane of
   glass"; it is drawn as an overlay so it survives the fills above. */
.cp-realtime.expanded::before,
.cp-realtime.collapsed::before {
  content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(255, 255, 255, .11), transparent 34%);
}
.cp-realtime[data-theme="light"].expanded::before,
.cp-realtime[data-theme="light"].collapsed::before {
  background: linear-gradient(180deg, rgba(255, 255, 255, .75), transparent 38%);
}
.cp-realtime.expanded > *, .cp-realtime.collapsed > * { position: relative; z-index: 1; }

/* ---- Editing the widget --------------------------------------------------
   Edit mode keeps the real blocks on screen rather than swapping in a list of
   checkboxes: what the user is arranging is the thing they are looking at. */
.cp-widget-block { position: relative; }
.cp-widget-block.editing {
  margin-top: 10px; padding: 8px; border: 1px dashed var(--cp-widget-line); border-radius: 17px;
  background: rgba(255, 255, 255, .012);
}
.cp-widget-block.editing > * { margin-top: 0; }
/* The block bar already names the block, so its own heading would read the
   same words twice in a row. */
.cp-widget-block.editing .cp-widget-section-title { display: none; }
/* The expanded card and the floating launcher both live in the bottom-right
   corner; the card used to run straight under the launcher pill and hide its
   own footer. When the launcher is showing, the card stops above it. */
.cp-realtime.expanded.launcher-clear .cp-realtime-body { max-height: calc(100dvh - 236px); }
.cp-block-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin-bottom: 8px; padding: 0 2px 0 6px;
}
.cp-block-bar > span:first-child {
  min-width: 0; overflow: hidden; color: var(--cp-widget-muted); font-size: 11px; font-weight: 650;
  letter-spacing: .2px; text-overflow: ellipsis; white-space: nowrap;
}
.cp-block-tools { display: flex; flex: 0 0 auto; gap: 4px; }
.cp-block-tools button {
  width: 26px; height: 26px; display: grid; place-items: center; padding: 0;
  border: 1px solid var(--cp-widget-line); border-radius: 9px;
  color: var(--cp-widget-muted); background: var(--cp-glass-fill); cursor: pointer;
  font-size: 13px; line-height: 1;
  transition: color .15s ease, border-color .15s ease, background .15s ease;
}
.cp-block-tools button:hover:not(:disabled) { color: var(--cp-text); border-color: color-mix(in srgb, var(--cp-purple) 45%, var(--cp-widget-line)); }
.cp-block-tools button:disabled { opacity: .35; cursor: default; }
.cp-block-tools button.danger:hover { color: #ff9aa9; border-color: rgba(255, 110, 130, .45); background: rgba(255, 92, 122, .14); }
.cp-widget-editor {
  display: grid; gap: 14px; margin-top: 12px; padding: 14px; border-radius: 17px;
  backdrop-filter: blur(16px) saturate(140%); -webkit-backdrop-filter: blur(16px) saturate(140%);
}
.cp-editor-group { display: grid; gap: 8px; }
.cp-editor-group > span {
  color: var(--cp-text); font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase;
}
.cp-editor-group > small { color: var(--cp-widget-muted); font-size: 11px; line-height: 1.5; }
.cp-editor-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.cp-editor-chips > em { color: var(--cp-widget-muted); font-size: 11px; font-style: normal; }
.cp-editor-chips button {
  display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 11px;
  border: 1px solid var(--cp-widget-line); border-radius: 999px;
  color: var(--cp-widget-muted); background: var(--cp-glass-fill); cursor: pointer;
  font-size: 12px; font-weight: 600;
  transition: color .16s ease, border-color .16s ease, background .16s ease, transform .16s var(--cp-ease);
}
.cp-editor-chips button i {
  font-style: normal; font-size: 12px; font-weight: 800; line-height: 1; opacity: .8;
}
.cp-editor-chips button:hover { color: var(--cp-text); border-color: color-mix(in srgb, var(--cp-purple) 45%, var(--cp-widget-line)); transform: translateY(-1px); }
.cp-editor-chips button.on {
  color: var(--cp-text);
  border-color: color-mix(in srgb, var(--cp-purple) 52%, transparent);
  background: color-mix(in srgb, var(--cp-purple) 20%, var(--cp-glass-fill));
}
.cp-editor-chips button.on i { color: var(--cp-purple-soft); opacity: 1; }
.cp-editor-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.cp-editor-actions button {
  min-height: 34px; padding: 0 14px; border: 1px solid var(--cp-widget-line); border-radius: 11px;
  color: var(--cp-widget-muted); background: var(--cp-glass-fill); cursor: pointer; font-size: 12px; font-weight: 650;
  transition: color .16s ease, border-color .16s ease, background .16s ease;
}
.cp-editor-actions button:hover { color: var(--cp-text); border-color: color-mix(in srgb, var(--cp-purple) 45%, var(--cp-widget-line)); }
.cp-editor-actions .cp-editor-done {
  color: #fff; border-color: transparent;
  background: linear-gradient(180deg, rgba(255, 255, 255, .18), transparent), var(--cp-purple);
  box-shadow: 0 1px 0 rgba(255, 255, 255, .22) inset, 0 6px 16px color-mix(in srgb, var(--cp-purple) 30%, transparent);
}
.cp-realtime .cp-icon-button.active {
  color: #fff;
  border-color: color-mix(in srgb, var(--cp-purple) 55%, transparent);
  background: color-mix(in srgb, var(--cp-purple) 30%, rgba(255, 255, 255, .05));
}
/* Light theme: a solid accent fill with white ink. The translucent tint above
   left a white check mark on a pale lilac square. */
.cp-realtime[data-theme="light"] .cp-icon-button.active {
  color: #fff; border-color: transparent; background: var(--cp-purple);
}
.cp-realtime[data-theme="light"] .cp-editor-chips button.on {
  color: color-mix(in srgb, var(--cp-purple) 78%, #1d1826);
  border-color: color-mix(in srgb, var(--cp-purple) 42%, transparent);
  background: color-mix(in srgb, var(--cp-purple) 11%, white);
}
.cp-realtime[data-theme="light"] .cp-editor-chips button.on i { color: var(--cp-purple); }
.cp-realtime[data-theme="light"] .cp-widget-block.editing { background: rgba(255, 255, 255, .35); }
@media (hover: none) { .cp-realtime .cp-dock-hide { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .cp-realtime *, .cp-realtime *::after { animation: none !important; transition: none !important; }
}

/* Respect the OS "Reduce Transparency" accessibility setting: Apple's Liquid
   Glass guidance requires solid, unblurred surfaces here so text stays legible
   over the busy YouTube page. Both themes compose their fill from
   --cp-panel-alpha, so lifting it to 1 makes them opaque without hardcoding a
   per-theme colour. */
@media (prefers-reduced-transparency: reduce) {
  :host { --cp-panel-alpha: 1 !important; }
  *,
  *::before,
  *::after {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
}

/* ===========================================================================
   Light theme — surfaces the glass layer hardcoded
   ===========================================================================
   The glass layer above sets literal dark values (rgba(9, 10, 17, …),
   rgba(255, 255, 255, .0x) hairlines) and is declared after the light theme's
   token block, so it won. The visible result was a dark header bolted onto a
   light body, an active tab with lavender text on lavender, and the accent
   metric rendering white-on-white.

   These rules re-point the same surfaces at light values. They sit at the end
   of the file deliberately: the glass layer is the current design layer, and
   this is its light-mode counterpart rather than a third competing system. */

.cp-panel[data-theme="light"] {
  --cp-text-2: #4c4557;
  --cp-text-3: #6c6579;
  border-color: #ded6ea;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, .9), transparent 30%),
    radial-gradient(circle at 86% -4%, color-mix(in srgb, var(--cp-purple) 12%, transparent), transparent 31%),
    rgba(250, 249, 253, var(--cp-panel-alpha));
  box-shadow: 0 24px 75px rgba(51, 35, 73, .22);
}

.cp-panel[data-theme="light"] .cp-header {
  border-bottom-color: #e6dff0;
  background: linear-gradient(180deg, rgba(255, 255, 255, .75), transparent);
}

.cp-panel[data-theme="light"] .cp-tabs {
  border-color: #e2dbee;
  background: #f0ecf7;
  box-shadow: inset 0 1px 2px rgba(51, 35, 73, .05);
}
.cp-panel[data-theme="light"] .cp-tabs button { color: #6c6579; }
.cp-panel[data-theme="light"] .cp-tabs button:hover:not(.active) {
  color: #2a2335;
  background: rgba(255, 255, 255, .7);
}
/* Solid accent fill with white text: the glass layer's translucent tint left
   the active tab at roughly 1.4:1 against its own track. */
.cp-panel[data-theme="light"] .cp-tabs button.active {
  color: #fff;
  background: var(--cp-purple);
  box-shadow: 0 2px 6px color-mix(in srgb, var(--cp-purple) 32%, transparent);
}

/* The eyebrow is a label, not decoration; the soft tint is a dark-mode tone. */
.cp-panel[data-theme="light"] .cp-kicker { color: var(--cp-accent-contrast, #4c34c4); opacity: 1; }

.cp-panel[data-theme="light"] .cp-card,
.cp-panel[data-theme="light"] .cp-score-card,
.cp-panel[data-theme="light"] .cp-detected,
.cp-panel[data-theme="light"] .cp-pro-section,
.cp-panel[data-theme="light"] .cp-pro-kpis article,
.cp-panel[data-theme="light"] .cp-history-chart,
.cp-panel[data-theme="light"] .cp-upload-assistant,
.cp-panel[data-theme="light"] .cp-upload,
.cp-panel[data-theme="light"] .cp-analytics-loading {
  border-color: #e4ddef;
  background: #fff;
  box-shadow: 0 1px 2px rgba(51, 35, 73, .05), 0 6px 18px rgba(51, 35, 73, .05);
}

.cp-panel[data-theme="light"] .cp-card:hover,
.cp-panel[data-theme="light"] .cp-pro-kpis article:hover {
  border-color: #d3c8e6;
  background: #fff;
  box-shadow: 0 2px 4px rgba(51, 35, 73, .07), 0 12px 26px rgba(51, 35, 73, .09);
}

/* The accent metric card. White text on the value is correct over the dark
   tinted fill, but it was inherited into light mode, where the fill is pale —
   the number disappeared entirely. */
.cp-panel[data-theme="light"] .cp-pro-kpis article.accent {
  border-color: color-mix(in srgb, var(--cp-purple) 28%, transparent);
  background:
    linear-gradient(150deg, color-mix(in srgb, var(--cp-purple) 10%, transparent), transparent 62%),
    #fff;
}
.cp-panel[data-theme="light"] .cp-pro-kpis article.accent b { color: var(--cp-text); }
.cp-panel[data-theme="light"] .cp-pro-kpis article.accent span { color: var(--cp-accent-contrast, #4c34c4); }
.cp-panel[data-theme="light"] .cp-pro-kpis span,
.cp-panel[data-theme="light"] .cp-pro-kpis em { color: var(--cp-text-3); }
.cp-panel[data-theme="light"] .cp-pro-kpis b { color: var(--cp-text); }

.cp-panel[data-theme="light"] .cp-field > span { color: var(--cp-text-2); }
.cp-panel[data-theme="light"] .cp-field > span em { color: var(--cp-text-3); }
.cp-panel[data-theme="light"] .cp-field input,
.cp-panel[data-theme="light"] .cp-field textarea,
.cp-panel[data-theme="light"] .cp-field select {
  border-color: #ded6ea;
  color: var(--cp-text);
  background: #fff;
  box-shadow: inset 0 1px 2px rgba(51, 35, 73, .05);
  color-scheme: light;
}
.cp-panel[data-theme="light"] .cp-field input::placeholder,
.cp-panel[data-theme="light"] .cp-field textarea::placeholder { color: #918a9d; }

.cp-panel[data-theme="light"] .cp-actions {
  border-top-color: #e6dff0;
  background: rgba(250, 249, 253, .97);
}
.cp-panel[data-theme="light"] .cp-actions::before {
  background: linear-gradient(
    180deg,
    transparent,
    rgba(250, 249, 253, .72) 55%,
    rgba(250, 249, 253, .97)
  );
}

.cp-panel[data-theme="light"] .cp-close,
.cp-panel[data-theme="light"] .cp-secondary,
.cp-panel[data-theme="light"] .cp-refresh {
  border-color: #ded6ea;
  color: #4c4557;
  background: #fff;
  box-shadow: 0 1px 2px rgba(51, 35, 73, .06);
}
.cp-panel[data-theme="light"] .cp-close:hover,
.cp-panel[data-theme="light"] .cp-secondary:hover:not(:disabled),
.cp-panel[data-theme="light"] .cp-refresh:hover:not(:disabled) {
  color: #211b2b;
  border-color: #c9bcdf;
  background: #f7f4fc;
}

.cp-panel[data-theme="light"] .cp-chip {
  border-color: #e0d8ec;
  color: #4c4557;
  background: #f7f4fc;
}
.cp-panel[data-theme="light"] .cp-card-title span,
.cp-panel[data-theme="light"] .cp-history-chart footer,
.cp-panel[data-theme="light"] .cp-list { color: var(--cp-text-3); }
.cp-panel[data-theme="light"] .cp-history-chart .cp-sparkline { border-bottom-color: #e4ddef; }

/* ===========================================================================
   Expanded analytics card
   ===========================================================================
   One section, both themes. The card used to be styled by five layers written
   at different times (base, light overrides, "glass", "polish", responsive),
   each partly undoing the previous one: nested bordered boxes inside boxes,
   the chart drawn through the headline number, unicode glyphs for icons and a
   KPI grid repeating the headline. Everything the card renders is defined
   here and nowhere else; the collapsed capsule and the block editor keep their
   own sections above. */
.cp-realtime {
  --w-text: #f3f1f8;
  --w-text-2: #c3bfcd;
  --w-text-3: #948fa2;
  --w-line: rgba(255, 255, 255, .075);
  --w-line-strong: rgba(255, 255, 255, .13);
  --w-surface: rgba(255, 255, 255, .035);
  --w-surface-hover: rgba(255, 255, 255, .065);
  --w-inset: rgba(0, 0, 0, .22);
  --w-seg-active: rgba(255, 255, 255, .1);
  --w-accent: var(--cp-purple-soft);
  --w-green: #5fdca0;
  --w-red: #ff8b8b;
  --w-amber: #f0b45a;
  --w-card: rgba(19, 18, 26, var(--cp-panel-alpha));
  --w-hero: radial-gradient(120% 90% at 100% 0, color-mix(in srgb, var(--cp-purple) 22%, transparent), transparent 62%), rgba(255, 255, 255, .03);
  --w-shadow: 0 1px 0 rgba(255, 255, 255, .06) inset, 0 24px 60px rgba(0, 0, 0, .5), 0 2px 8px rgba(0, 0, 0, .3);
  /* The block editor above reads these two names. */
  --cp-widget-muted: var(--w-text-3);
  --cp-widget-line: var(--w-line);
}
.cp-realtime[data-theme="light"] {
  --w-text: #1c1926;
  --w-text-2: #4a4558;
  --w-text-3: #6b6578;
  --w-line: rgba(35, 28, 60, .09);
  --w-line-strong: rgba(35, 28, 60, .16);
  --w-surface: rgba(255, 255, 255, .72);
  --w-surface-hover: color-mix(in srgb, var(--cp-purple) 7%, white);
  --w-inset: rgba(35, 28, 60, .055);
  --w-seg-active: #ffffff;
  --w-accent: var(--cp-purple);
  --w-green: #13784a;
  --w-red: #c23548;
  --w-amber: #9a5b00;
  --w-card: rgba(247, 246, 251, var(--cp-panel-alpha));
  --w-hero: radial-gradient(120% 90% at 100% 0, color-mix(in srgb, var(--cp-purple) 11%, transparent), transparent 62%), rgba(255, 255, 255, .8);
  --w-shadow: 0 1px 0 #fff inset, 0 24px 60px rgba(40, 32, 70, .18), 0 2px 8px rgba(40, 32, 70, .08);
}

/* The panel's analytics tab draws the same trend chart and "collecting" note. */
.cp-panel { --w-accent: var(--cp-purple-soft); --w-line-strong: rgba(255, 255, 255, .13); --w-amber: #f0b45a; }
.cp-panel[data-theme="light"] { --w-accent: var(--cp-purple); --w-line-strong: rgba(35, 28, 60, .16); --w-amber: #9a5b00; }
.cp-pro-kpis em.warn,
.cp-panel[data-theme="light"] .cp-pro-kpis em.warn { color: var(--w-amber); }
.cp-panel[data-theme="light"] .cp-momentum-title:hover { color: var(--cp-purple); }
/* The status pills kept their dark fills in the light theme. */
.cp-panel[data-theme="light"] .cp-status.hot { color: #9a4a06; background: #fdecd9; }
.cp-panel[data-theme="light"] .cp-status.growing { color: #11693f; background: #dcf5e7; }
.cp-panel[data-theme="light"] .cp-status.cooling { color: #7d5a06; background: #f8efd3; }
.cp-panel[data-theme="light"] .cp-status.warming { color: #4b36b8; background: #ebe6fb; }
.cp-panel[data-theme="light"] .cp-status.quiet { color: #5f5870; background: #eeebf3; }
.cp-history-chart .cp-trend { height: 72px; margin-top: 10px; }

/* Shell */
.cp-realtime.expanded {
  top: 66px; width: 372px; border: 1px solid var(--w-line-strong); border-radius: 20px;
  color: var(--w-text); background: var(--w-card); box-shadow: var(--w-shadow);
}
.cp-realtime.expanded::before { background: linear-gradient(180deg, rgba(255, 255, 255, .05), transparent 96px); }
.cp-realtime[data-theme="light"].expanded::before { background: linear-gradient(180deg, rgba(255, 255, 255, .9), transparent 96px); }
.cp-realtime :is(button, a):focus-visible { outline: 2px solid var(--w-accent); outline-offset: 2px; }
.cp-realtime .cp-top-dock b { font-weight: 650; }
.cp-realtime .positive { color: var(--w-green) !important; }
.cp-realtime .negative { color: var(--w-red) !important; }
.cp-widget-icon { display: block; width: 16px; height: 16px; }
.cp-dock-expand .cp-widget-icon { width: 15px; height: 15px; }
.cp-dock-hide .cp-widget-icon { width: 12px; height: 12px; }
.cp-block-tools .cp-widget-icon { width: 14px; height: 14px; }
/* The live dot sat on the capsule's curved edge at narrower widths. */
.cp-realtime.collapsed.docked .cp-top-dock { padding-left: 11px; }

/* Header: the channel name, when it was updated, three quiet controls. */
.cp-realtime-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 11px 10px 11px 15px; border-bottom: 1px solid var(--w-line);
}
.cp-realtime-brand {
  min-width: 0; display: flex; align-items: center; gap: 10px; padding: 0; border: 0;
  color: var(--w-text); background: none; text-align: left; cursor: pointer;
}
.cp-realtime-brand > span:last-child { min-width: 0; }
.cp-realtime-brand b {
  display: block; overflow: hidden; font-size: 13.5px; font-weight: 650; letter-spacing: -.2px;
  text-overflow: ellipsis; white-space: nowrap;
}
.cp-realtime-brand small { display: block; margin-top: 2px; overflow: hidden; color: var(--w-text-3); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.cp-realtime-brand .cp-live-dot { width: 9px; height: 9px; border-width: 2px; }
.cp-realtime .cp-live-dot.idle { background: var(--w-text-3); box-shadow: none; }
.cp-realtime .cp-live-dot.idle::after { content: none; }
.cp-realtime-head > div { display: flex; flex: 0 0 auto; gap: 2px; }
.cp-icon-button {
  width: 30px; height: 30px; display: grid; place-items: center; padding: 0;
  border: 1px solid transparent; border-radius: 9px; color: var(--w-text-2); background: transparent; cursor: pointer;
  transition: color .15s ease, background .15s ease, border-color .15s ease;
}
.cp-icon-button:hover:not(:disabled) { color: var(--w-text); border-color: var(--w-line); background: var(--w-surface-hover); }
.cp-icon-button:disabled { opacity: .4; cursor: default; }
.cp-icon-button.spinning .cp-widget-icon,
.cp-refresh.spinning .cp-widget-icon { animation: cp-widget-spin .9s linear infinite; }
@keyframes cp-widget-spin { to { transform: rotate(360deg); } }
.cp-realtime .cp-icon-button.active,
.cp-realtime[data-theme="light"] .cp-icon-button.active { color: #fff; border-color: transparent; background: var(--cp-purple); }

/* Body: blocks are spaced by the grid gap, not by per-block margins. */
.cp-realtime-body {
  display: grid; gap: 10px; max-height: calc(100dvh - 150px); overflow-y: auto; overscroll-behavior: contain;
  padding: 12px; scrollbar-width: thin; scrollbar-color: var(--w-line-strong) transparent;
}
.cp-realtime .cp-widget-block.editing { margin-top: 0; }

/* Period switch: a compact segmented control. */
.cp-widget-periods {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; padding: 3px;
  border: 1px solid var(--w-line); border-radius: 11px; background: var(--w-inset);
}
.cp-widget-periods button {
  height: 28px; padding: 0 4px; border: 0; border-radius: 8px; color: var(--w-text-3); background: transparent;
  cursor: pointer; font-size: 12px; font-weight: 600; white-space: nowrap;
  transition: color .15s ease, background .15s ease, box-shadow .15s ease;
}
.cp-widget-periods button:hover:not(.active) { color: var(--w-text); }
.cp-widget-periods button.active {
  color: var(--w-text); background: var(--w-seg-active);
  box-shadow: 0 0 0 1px var(--w-line) inset, 0 1px 3px rgba(0, 0, 0, .18);
}
/* A window still being collected gets a small amber dot, not amber text. */
.cp-widget-periods button.incomplete::after {
  content: ""; display: inline-block; width: 5px; height: 5px; margin: 0 0 1px 5px;
  border-radius: 50%; background: var(--w-amber); vertical-align: middle;
}

/* Headline: label and status, the number with its rate, then the trend. */
.cp-realtime-primary {
  padding: 13px 14px 10px; border: 1px solid var(--w-line); border-radius: 15px; background: var(--w-hero);
}
.cp-metric-label { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cp-metric-label span { min-width: 0; overflow: hidden; color: var(--w-text-2); font-size: 12px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.cp-metric-label em {
  display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; padding: 3px 8px;
  border-radius: 999px; font-size: 10.5px; font-style: normal; font-weight: 650; letter-spacing: .2px;
}
.cp-metric-label em.live { color: var(--w-green); background: color-mix(in srgb, var(--w-green) 13%, transparent); }
.cp-metric-label em.live i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: cp-live-pulse-soft 2.4s ease-out infinite; }
@keyframes cp-live-pulse-soft { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 55%, transparent); } 70%, 100% { box-shadow: 0 0 0 5px transparent; } }
.cp-metric-label em.warn { color: var(--w-amber); background: color-mix(in srgb, var(--w-amber) 14%, transparent); }
.cp-metric-label em.muted { color: var(--w-text-3); background: var(--w-surface); }
.cp-primary-value { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 10px; margin-top: 6px; }
.cp-primary-value strong { color: var(--w-text); font-size: 38px; font-weight: 700; letter-spacing: -1.4px; line-height: 1.05; }
.cp-primary-value strong.flash { animation: cp-value-flash .9s var(--cp-ease); }
.cp-primary-value span { color: var(--w-text-3); font-size: 12px; font-weight: 550; }
.cp-trend { display: block; width: 100%; height: 60px; margin-top: 8px; overflow: visible; }
.cp-trend-line { stroke: var(--w-accent); stroke-width: 2; stroke-linecap: round; }
.cp-trend-now { stroke: var(--w-accent); stroke-width: 1; stroke-dasharray: 2 3; opacity: .55; }
.cp-trend.empty .cp-trend-line { stroke: var(--w-line-strong); stroke-dasharray: 3 4; }
.cp-trend.empty .cp-trend-area { display: none; }
.cp-trend-axis {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; margin-top: 4px;
  color: var(--w-text-3); font-size: 10.5px;
}
.cp-trend-axis span:nth-child(2) { overflow: hidden; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.cp-trend-axis .warn { color: var(--w-amber); }

/* Key metrics: one quiet 2×2 table with hairline dividers instead of four
   floating cards. */
.cp-realtime-grid {
  display: grid; grid-template-columns: 1fr 1fr; overflow: hidden;
  border: 1px solid var(--w-line); border-radius: 14px; background: var(--w-surface);
}
.cp-realtime-grid > * { position: relative; min-width: 0; padding: 11px 13px; }
.cp-realtime-grid > :nth-child(odd) { border-right: 1px solid var(--w-line); }
.cp-realtime-grid > :nth-child(-n + 2) { border-bottom: 1px solid var(--w-line); }
.cp-realtime-grid > button {
  margin: 0; border-top: 0; border-left: 0; color: inherit; background: transparent;
  font: inherit; text-align: left; cursor: pointer; transition: background .15s ease;
}
.cp-realtime-grid > :nth-child(2) { border-right: 0; }
.cp-realtime-grid > button:hover { background: var(--w-surface-hover); }
.cp-realtime-grid > button.active span { color: var(--w-accent); }
.cp-realtime-grid > button.active::before {
  content: ""; position: absolute; top: 12px; bottom: 12px; left: 0; width: 2px;
  border-radius: 0 2px 2px 0; background: var(--w-accent);
}
.cp-realtime-grid span { display: block; color: var(--w-text-3); font-size: 11px; font-weight: 550; }
.cp-realtime-grid b { display: block; margin-top: 3px; color: var(--w-text); font-size: 19px; font-weight: 680; letter-spacing: -.5px; }
.cp-realtime-grid small { display: block; margin-top: 2px; overflow: hidden; color: var(--w-text-3); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.cp-realtime-grid small.warn { color: var(--w-amber); }

/* Subscribers: net result, a balance bar, and what it is made of. */
.cp-widget-subscribers { padding: 12px 14px; border: 1px solid var(--w-line); border-radius: 14px; background: var(--w-surface); }
.cp-widget-subscribers-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.cp-widget-subscribers-head span { color: var(--w-text-2); font-size: 12px; font-weight: 550; }
.cp-widget-subscribers-head b { font-size: 19px; font-weight: 700; letter-spacing: -.4px; }
.cp-widget-balance { display: flex; gap: 3px; height: 6px; margin: 10px 0 9px; }
.cp-widget-balance i { display: block; min-width: 4px; border-radius: 999px; }
.cp-widget-balance .gain, .cp-widget-subscribers-legend .gain { background: var(--w-green); }
.cp-widget-balance .loss, .cp-widget-subscribers-legend .loss { background: var(--w-red); }
.cp-widget-subscribers-legend { display: flex; justify-content: space-between; gap: 10px; color: var(--w-text-3); font-size: 11.5px; }
.cp-widget-subscribers-legend span { display: inline-flex; align-items: center; gap: 6px; }
.cp-widget-subscribers-legend i { width: 7px; height: 7px; border-radius: 50%; }
.cp-widget-subscribers-legend b { color: var(--w-text); font-weight: 650; }

/* Video lists: rows without their own boxes; hover is the affordance. */
.cp-widget-list-block { min-width: 0; }
.cp-widget-section-title { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 2px 4px 6px; }
.cp-widget-section-title span { color: var(--w-text); font-size: 12.5px; font-weight: 650; }
.cp-widget-section-title em { color: var(--w-text-3); font-size: 11px; font-style: normal; }
.cp-widget-leaders, .cp-widget-subscriber-list { display: grid; gap: 1px; }
.cp-widget-video {
  width: 100%; display: grid; grid-template-columns: 14px 64px minmax(0, 1fr) auto; gap: 10px; align-items: center;
  padding: 7px 8px; border: 0; border-radius: 11px; color: var(--w-text); background: transparent;
  text-align: left; text-decoration: none; cursor: pointer; transition: background .15s ease;
}
.cp-widget-subscriber-list .cp-widget-video { grid-template-columns: 64px minmax(0, 1fr) auto; }
.cp-widget-video:hover { background: var(--w-surface-hover); }
.cp-widget-rank { color: var(--w-text-3); font-size: 12px; font-weight: 650; text-align: center; }
.cp-widget-leaders .cp-widget-video:first-child .cp-widget-rank { color: var(--w-accent); }
.cp-widget-video img {
  width: 64px; height: 36px; border-radius: 7px; object-fit: cover;
  background: var(--w-surface); box-shadow: 0 0 0 1px var(--w-line);
}
.cp-widget-video-copy { min-width: 0; }
.cp-widget-video-copy b {
  display: -webkit-box; overflow: hidden; font-size: 12.5px; font-weight: 550; line-height: 1.3;
  -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere;
}
.cp-widget-video-copy small { display: block; margin-top: 3px; overflow: hidden; color: var(--w-text-3); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.cp-widget-speed { text-align: right; white-space: nowrap; }
.cp-widget-speed b { display: block; color: var(--w-green); font-size: 13px; font-weight: 700; }
.cp-widget-speed small { display: block; margin-top: 3px; font-size: 10.5px; font-weight: 600; }
.cp-widget-speed small.hot { color: var(--w-amber); }
.cp-widget-speed small.growing { color: var(--w-green); }
.cp-widget-speed small.cooling { color: color-mix(in srgb, var(--w-amber) 70%, var(--w-text-3)); }
.cp-widget-speed small.warming { color: var(--w-accent); }
.cp-widget-speed small.quiet { color: var(--w-text-3); }

/* States */
.cp-realtime .cp-widget-empty {
  display: grid; gap: 10px; justify-items: center; padding: 16px 14px;
  border: 1px dashed var(--w-line-strong); border-radius: 12px;
  color: var(--w-text-3); background: transparent; font-size: 11.5px; line-height: 1.5; text-align: center;
}
.cp-realtime .cp-widget-empty p { margin: 0; }
.cp-realtime .cp-widget-empty button,
.cp-widget-footer-actions button {
  min-height: 30px; padding: 0 12px; border: 1px solid var(--w-line); border-radius: 9px;
  color: var(--w-text); background: var(--w-surface); cursor: pointer; font-size: 12px; font-weight: 600;
  transition: background .15s ease, border-color .15s ease;
}
.cp-realtime .cp-widget-empty button:hover,
.cp-widget-footer-actions button:hover { border-color: var(--w-line-strong); background: var(--w-surface-hover); }
.cp-realtime .cp-widget-login {
  display: grid; gap: 8px; padding: 18px 16px; border: 1px solid var(--w-line); border-radius: 14px;
  color: var(--w-text); background: var(--w-surface);
}
.cp-realtime .cp-widget-login strong { font-size: 15px; font-weight: 650; letter-spacing: -.2px; }
.cp-realtime .cp-widget-login span { color: var(--w-text-2); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
.cp-realtime .cp-widget-login button {
  width: 100%; min-height: 38px; margin-top: 4px; border: 0; border-radius: 10px;
  color: #fff; background: var(--cp-purple); cursor: pointer; font-size: 13px; font-weight: 650;
}
.cp-realtime .cp-widget-login button:hover:not(:disabled) { background: color-mix(in srgb, var(--cp-purple) 88%, white); }
.cp-realtime .cp-widget-login button:disabled { opacity: .65; cursor: progress; }
.cp-realtime .cp-widget-loading { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 0; }
.cp-realtime .cp-widget-loading i {
  height: 64px; border-radius: 12px;
  background: linear-gradient(90deg, var(--w-surface), var(--w-surface-hover), var(--w-surface)); background-size: 200% 100%;
  animation: cp-shimmer 1.2s linear infinite;
}
.cp-realtime .cp-widget-loading i:first-child { grid-column: 1 / -1; height: 150px; }
.cp-realtime .cp-widget-loading span { grid-column: 1 / -1; color: var(--w-text-3); font-size: 11.5px; text-align: center; }

/* Footer: the destructive action is quiet and on the left, navigation on the right. */
.cp-widget-footer {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding-top: 10px; border-top: 1px solid var(--w-line);
}
.cp-widget-hide {
  padding: 6px 2px; border: 0; color: var(--w-text-3); background: none; cursor: pointer; font-size: 12px;
  transition: color .15s ease;
}
.cp-widget-hide:hover { color: var(--w-red); }
.cp-widget-footer-actions { display: flex; gap: 6px; }
.cp-widget-footer-actions button.primary { color: #fff; border-color: transparent; background: var(--cp-purple); }
.cp-widget-footer-actions button.primary:hover { background: color-mix(in srgb, var(--cp-purple) 88%, white); }

@media (max-width: 420px) {
  .cp-realtime.expanded { right: 8px !important; left: 8px !important; width: auto !important; }
  .cp-realtime-body { padding: 10px; }
  .cp-realtime-brand b { font-size: 13px; }
  .cp-primary-value strong { font-size: 34px; }
  .cp-widget-video { grid-template-columns: 14px 52px minmax(0, 1fr) auto; gap: 8px; }
  .cp-widget-subscriber-list .cp-widget-video { grid-template-columns: 52px minmax(0, 1fr) auto; }
  .cp-widget-video img { width: 52px; height: 30px; }
}
`;
