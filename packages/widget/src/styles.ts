/** All widget CSS lives inside a shadow root, so host styles never leak in or out. */
export const widgetCss = (primary: string) => `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  --brand: ${primary};
  --brand-ink: #ffffff;
  --bg: #ffffff; --bg-2: #f6f7f9; --bg-3: #eceef2; --ink: #14161a; --ink-2: #4a5160; --ink-3: #7a8191;
  --line: #e3e6eb; --ok: #12805c; --warn: #a15c00; --err: #c0362c;
  --radius: 14px; --shadow: 0 18px 48px rgba(16, 24, 40, .18), 0 2px 6px rgba(16, 24, 40, .08);
  font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink);
  -webkit-font-smoothing: antialiased;
}
.root.dark {
  --bg: #15171c; --bg-2: #1d2027; --bg-3: #272b34; --ink: #eef0f4; --ink-2: #b5bbc8; --ink-3: #868d9c; --line: #2d313b;
  --shadow: 0 18px 48px rgba(0,0,0,.5);
}
button { font: inherit; color: inherit; cursor: pointer; }
:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }

.launcher {
  position: fixed; z-index: 2147483000; bottom: 20px; display: inline-flex; align-items: center; gap: 8px;
  height: 48px; padding: 0 18px 0 14px; border: 0; border-radius: 999px; background: var(--brand); color: var(--brand-ink);
  box-shadow: var(--shadow); font-weight: 600; transition: transform .15s ease;
}
.launcher:hover { transform: translateY(-1px); }
.launcher svg { width: 20px; height: 20px; }
.right { right: 20px; } .left { left: 20px; }

.panel {
  position: fixed; z-index: 2147483001; display: flex; flex-direction: column; background: var(--bg);
  border: 1px solid var(--line); box-shadow: var(--shadow); overflow: hidden;
}
.panel.floating { bottom: 80px; width: min(400px, calc(100vw - 32px)); height: min(640px, calc(100vh - 110px)); border-radius: var(--radius); }
.panel.floating.right { right: 20px; } .panel.floating.left { left: 20px; }
.panel.side_panel { top: 0; bottom: 0; width: min(420px, 100vw); border-radius: 0; border-width: 0 0 0 1px; }
.panel.side_panel.right { right: 0; } .panel.side_panel.left { left: 0; border-width: 0 1px 0 0; }
.panel.fullscreen { inset: 0; border-radius: 0; border: 0; }
.panel.fullscreen .body, .panel.fullscreen .composer { width: 100%; max-width: 760px; margin: 0 auto; }
@media (max-width: 520px) { .panel.floating { inset: 0; width: auto; height: auto; border-radius: 0; } }

.head { display: flex; align-items: center; gap: 10px; padding: 12px 12px 12px 16px; border-bottom: 1px solid var(--line); }
.avatar { width: 30px; height: 30px; border-radius: 9px; background: var(--brand); color: var(--brand-ink); display: grid; place-items: center; font-weight: 700; font-size: 13px; flex: none; }
.title { flex: 1; min-width: 0; }
.title b { display: block; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.title span { display: block; font-size: 12px; color: var(--ink-3); }
.icon-btn { width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--ink-2); }
.icon-btn:hover { background: var(--bg-2); color: var(--ink); }
.icon-btn svg { width: 18px; height: 18px; }
.badge { font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 6px; background: var(--bg-3); color: var(--ink-2); }

.tabs { display: flex; gap: 4px; padding: 8px 12px 0; border-bottom: 1px solid var(--line); }
.tab { border: 0; background: none; padding: 8px 10px; color: var(--ink-3); font-weight: 600; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tab[aria-selected="true"] { color: var(--ink); border-color: var(--brand); }

.body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.msg { max-width: 88%; padding: 10px 12px; border-radius: 12px; white-space: pre-wrap; word-wrap: break-word; }
.msg.assistant { background: var(--bg-2); align-self: flex-start; border-top-left-radius: 4px; }
.msg.user { background: var(--brand); color: var(--brand-ink); align-self: flex-end; border-top-right-radius: 4px; }
.msg .cites { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.cite { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); color: var(--ink-2); text-decoration: none; }
.meta { display: flex; gap: 2px; margin-top: 6px; }
.meta button { border: 0; background: none; color: var(--ink-3); padding: 2px 6px; border-radius: 6px; font-size: 12px; }
.meta button:hover, .meta button[aria-pressed="true"] { color: var(--ink); background: var(--bg-3); }
.typing { display: inline-flex; gap: 4px; padding: 12px; }
.typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-3); animation: blink 1.2s infinite; }
.typing i:nth-child(2) { animation-delay: .2s } .typing i:nth-child(3) { animation-delay: .4s }
@keyframes blink { 0%, 80%, 100% { opacity: .25 } 40% { opacity: 1 } }

.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { border: 1px solid var(--line); background: var(--bg); border-radius: 999px; padding: 6px 12px; font-size: 13px; color: var(--ink-2); }
.chip:hover { border-color: var(--brand); color: var(--ink); }

.card { border: 1px solid var(--line); border-radius: 12px; padding: 12px; background: var(--bg); display: flex; flex-direction: column; gap: 10px; }
.card h4 { margin: 0; font-size: 14px; }
.card p { margin: 0; color: var(--ink-2); font-size: 13px; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field label { font-size: 12px; font-weight: 600; color: var(--ink-2); }
.field input, .field select, .field textarea { font: inherit; color: var(--ink); background: var(--bg-2); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
.field input:focus, .field select:focus { outline: none; border-color: var(--brand); }
.field .err { color: var(--err); font-size: 12px; }
.row { display: flex; gap: 8px; justify-content: flex-end; }
.btn { border: 1px solid var(--line); background: var(--bg); border-radius: 8px; padding: 8px 14px; font-weight: 600; }
.btn.primary { background: var(--brand); color: var(--brand-ink); border-color: var(--brand); }
.btn:disabled { opacity: .6; cursor: default; }
.status { font-size: 13px; font-weight: 600; }
.status.ok { color: var(--ok); } .status.err { color: var(--err); }

.progress { height: 6px; border-radius: 999px; background: var(--bg-3); overflow: hidden; }
.progress > i { display: block; height: 100%; background: var(--brand); transition: width .3s ease; }
.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.step { display: flex; gap: 10px; align-items: flex-start; padding: 8px; border-radius: 10px; }
.step:hover { background: var(--bg-2); }
.check { flex: none; width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--line); display: grid; place-items: center; margin-top: 1px; }
.step.completed .check { background: var(--ok); border-color: var(--ok); color: #fff; }
.step.skipped .check { border-style: dashed; }
.step.locked { opacity: .55; }
.step .t { font-weight: 600; } .step .d { font-size: 13px; color: var(--ink-2); }
.step .acts { display: flex; gap: 6px; margin-top: 6px; }
.link { border: 0; background: none; padding: 0; color: var(--brand); font-weight: 600; font-size: 13px; }
.section-title { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-3); margin: 4px 0 0; }
.lesson { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; }
.lesson small { color: var(--ink-3); display: block; }
.empty { color: var(--ink-3); text-align: center; padding: 24px 8px; }

.composer { display: flex; gap: 8px; padding: 12px; border-top: 1px solid var(--line); align-items: flex-end; }
.composer textarea { flex: 1; resize: none; max-height: 120px; min-height: 40px; font: inherit; color: var(--ink); background: var(--bg-2); border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px; }
.composer textarea:focus { outline: none; border-color: var(--brand); }
.send { width: 40px; height: 40px; border-radius: 10px; border: 0; background: var(--brand); color: var(--brand-ink); display: grid; place-items: center; flex: none; }
.send:disabled { opacity: .5; }
.mic[aria-pressed="true"] { color: var(--err); }
.foot { text-align: center; font-size: 11px; color: var(--ink-3); padding: 0 0 8px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;

/** Overlay lives in its own shadow root above the host page; it only draws, never edits host DOM. */
export const overlayCss = (primary: string) => `
:host { all: initial; }
.spot { position: fixed; z-index: 2147482999; border-radius: 10px; pointer-events: none;
  box-shadow: 0 0 0 4px ${primary}, 0 0 0 9999px rgba(15, 18, 25, .45); transition: all .25s ease; }
.spot.soft { box-shadow: 0 0 0 4px ${primary}, 0 0 24px 6px ${primary}66; }
.tip { position: fixed; z-index: 2147483002; width: min(320px, calc(100vw - 24px)); background: #fff; color: #14161a; border-radius: 12px;
  box-shadow: 0 16px 40px rgba(16,24,40,.22); padding: 14px; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.tip .k { font-size: 12px; color: #7a8191; font-weight: 600; }
.tip h5 { margin: 2px 0 4px; font-size: 15px; }
.tip p { margin: 0 0 10px; color: #4a5160; }
.tip .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.tip button { font: inherit; border-radius: 8px; padding: 6px 12px; border: 1px solid #e3e6eb; background: #fff; cursor: pointer; font-weight: 600; }
.tip button.primary { background: ${primary}; border-color: ${primary}; color: #fff; }
.tip .wait { font-size: 12px; color: #a15c00; font-weight: 600; }
@media (prefers-reduced-motion: reduce) { .spot { transition: none; } }
`;
