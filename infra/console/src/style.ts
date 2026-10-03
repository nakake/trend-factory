export const CSS = `:root {
  --bg: #fafaf8; --fg: #1d1d1b; --muted: #5f5f5a; --line: #d8d8d2; --link: #0b5cad; --warn-bg: #fff3d6; --warn-fg: #6b4500; --bad: #a3261c;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #161615; --fg: #e8e8e4; --muted: #a0a09a; --line: #3a3a37; --link: #7db4f0; --warn-bg: #3a2f10; --warn-fg: #f2d48a; --bad: #f08a80; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.6 system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 1.4rem; margin: 0 0 8px; }
h2 { font-size: 1.1rem; margin: 40px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--line); }
a { color: var(--link); }
.muted { color: var(--muted); }
.bad { color: var(--bad); }
.warn { background: var(--warn-bg); color: var(--warn-fg); padding: 8px 12px; margin: 8px 0; border-left: 4px solid var(--warn-fg); }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; vertical-align: top; padding: 6px 10px; border-bottom: 1px solid var(--line); }
th { font-weight: 600; color: var(--muted); white-space: nowrap; }
td.num { text-align: right; white-space: nowrap; }
td.nowrap { white-space: nowrap; }
ul { margin: 0; padding-left: 1.2em; }
.kv th { width: 14em; }
.scores { white-space: nowrap; }
`;
