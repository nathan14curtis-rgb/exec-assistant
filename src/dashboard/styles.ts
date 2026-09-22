/**
 * The dashboard stylesheet, served inline. Tokens are taken verbatim from the
 * design spec; light and dark are the same markup with different custom
 * properties.
 */
export const STYLES = `
:root{
  --font:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --bg:#f7f5f1;--card:#fffdfb;--line:#e5e0d7;--line-soft:#efeae1;
  --ink:#1b1917;--ink-2:#5f584f;--ink-3:#8f867b;
  --accent:#b1441c;--danger:#9d2b1f;--good:#3f6b45;
  --idea:#8a5f0a;--todo:#2a5a87;--followup:#634389;
  --decision:#145c54;--roadmap:#49631f;--journal:#82505b;
  --s1:4px;--s2:6px;--s3:10px;--s4:12px;--s5:16px;--s6:24px;
  --r-sm:4px;--r-md:7px;--r-lg:10px;--r-pill:999px;
  --text-meta:10.5px;--text-small:13px;--text-body:14px;--text-title:15px;--text-head:22px;
  --tap:44px;--col:680px;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --bg:#131211;--card:#1c1b19;--line:#302d29;--line-soft:#262421;
    --ink:#efeae2;--ink-2:#a09890;--ink-3:#6b655d;
    --accent:#e57843;--danger:#e2705f;--good:#7aa87f;
    --idea:#d9a441;--todo:#74a9de;--followup:#a98bd8;
    --decision:#4fae9f;--roadmap:#97b95f;--journal:#c98f9a;
  }
}
:root[data-theme="dark"]{
  --bg:#131211;--card:#1c1b19;--line:#302d29;--line-soft:#262421;
  --ink:#efeae2;--ink-2:#a09890;--ink-3:#6b655d;
  --accent:#e57843;--danger:#e2705f;--good:#7aa87f;
  --idea:#d9a441;--todo:#74a9de;--followup:#a98bd8;
  --decision:#4fae9f;--roadmap:#97b95f;--journal:#c98f9a;
}

*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;background:var(--bg);color:var(--ink);
  font:400 var(--text-body)/1.5 var(--font);
  -webkit-font-smoothing:antialiased;
}
a{color:var(--accent);text-decoration:none}
a:hover{opacity:.75}
button{font-family:var(--mono);-webkit-tap-highlight-color:transparent;cursor:pointer}
input,textarea,select{font-family:var(--font);font-size:var(--text-body);color:var(--ink)}
summary::-webkit-details-marker{display:none}
summary{list-style:none;cursor:pointer}
form{margin:0}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* ---- shell -------------------------------------------------------------- */
.wrap{max-width:calc(var(--col) + 220px + 48px);margin:0 auto;padding:0 var(--s5) 96px}
.top{
  display:flex;align-items:baseline;gap:var(--s4);
  padding:var(--s6) 0 var(--s5);flex-wrap:wrap;
}
.top h1{font:600 var(--text-head)/1.1 var(--font);letter-spacing:-.01em;margin:0}
.count{font:500 var(--text-meta)/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.top-sp{margin-left:auto}
.layout{display:block}
.rail{display:none}

/* ---- phone filter chips ------------------------------------------------- */
.chips{
  display:flex;gap:var(--s2);overflow-x:auto;padding-bottom:var(--s4);
  scrollbar-width:none;-ms-overflow-style:none;
}
.chips::-webkit-scrollbar{display:none}
.chip{
  flex:none;display:inline-flex;align-items:center;gap:var(--s1);
  border:1px solid var(--line);background:var(--card);color:var(--ink-2);
  border-radius:var(--r-pill);padding:7px 13px;
  font:600 var(--text-meta)/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;
}
.chip:hover{border-color:var(--ink-3);opacity:1}
.chip[aria-current="true"]{background:var(--ink);border-color:var(--ink);color:var(--bg)}

/* ---- capture card ------------------------------------------------------- */
.cards{display:flex;flex-direction:column;gap:var(--s4)}
.card{
  background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);
  overflow:hidden;
}
.cap-head{
  display:flex;align-items:center;gap:var(--s3);
  padding:var(--s3) var(--s5);border-bottom:1px solid var(--line-soft);
  font:500 var(--text-meta)/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;
  color:var(--ink-3);
}
.cap-head .r{margin-left:auto}
.tag-working{color:var(--accent)}
.tag-failed{color:var(--danger);display:inline-flex;align-items:center;gap:var(--s1)}

/* two or more items get a spine in the left gutter; one item gets none, so a
   single-item capture reads as one record rather than a container */
.items{padding:0}
.items.braced{
  margin:var(--s3) var(--s5) var(--s3) calc(var(--s5) + 9px);
  border-left:2px solid var(--line);padding-left:13px;
}
.items.single{margin:var(--s3) var(--s5)}

.item + .item{border-top:1px solid var(--line-soft)}
.item[open] + .item{border-top-color:var(--line)}
.row{
  display:flex;align-items:flex-start;gap:var(--s3);
  padding:var(--s3) 0;min-height:var(--tap);
}
.row:hover .chev{color:var(--ink-2)}
.row-main{flex:1;min-width:0}
.meta{
  display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap;
  font:600 var(--text-meta)/1 var(--mono);letter-spacing:.09em;text-transform:uppercase;
  margin-bottom:var(--s2);
}
.meta .dim{color:var(--ink-3);font-weight:500}
.title{font:600 var(--text-title)/1.32 var(--font);letter-spacing:-.005em;margin:0;color:var(--ink)}
.item-done .title{text-decoration:line-through;color:var(--ink-3);font-weight:500}
.chev{flex:none;color:var(--ink-3);margin-top:2px;transition:transform .12s}
.item[open] .chev{transform:rotate(180deg)}
.body{
  font:400 var(--text-body)/1.55 var(--font);color:var(--ink-2);
  margin:0 0 var(--s3);text-wrap:pretty;white-space:pre-wrap;
}
.body-none{font-style:italic;color:var(--ink-3);font-size:var(--text-small)}
.tags{display:flex;gap:var(--s2);flex-wrap:wrap;margin-bottom:var(--s3)}
.tag{
  border:1px solid var(--line);border-radius:var(--r-sm);padding:3px 7px;
  font:500 var(--text-meta)/1.4 var(--mono);letter-spacing:.06em;text-transform:uppercase;
  color:var(--ink-3);
}
.badge{
  border:1px solid currentColor;border-radius:var(--r-sm);padding:2px 5px;
  font:600 9.5px/1.4 var(--mono);letter-spacing:.08em;text-transform:uppercase;
}
.badge-good{color:var(--good)}

/* ---- action drawer ------------------------------------------------------ */
.drawer{padding:0 0 var(--s4)}
.drawer-label{
  font:600 var(--text-meta)/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink-3);margin-bottom:var(--s2);
}
.moves{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s2);margin-bottom:var(--s3)}
.btn{
  display:flex;align-items:center;justify-content:center;gap:var(--s2);
  white-space:nowrap;
  min-height:var(--tap);padding:0 var(--s3);
  border:1px solid var(--line);border-radius:var(--r-md);
  background:var(--card);color:var(--ink-2);
  font:600 var(--text-meta)/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;
  text-align:center;
}
.btn:hover{border-color:var(--ink-3);color:var(--ink)}
.btn[aria-current="true"]{cursor:default;position:relative}
.btn-now{
  position:absolute;right:var(--s3);
  font-size:9px;color:var(--ink-3);letter-spacing:.1em;
}
.btn-primary{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.btn-primary:hover{color:var(--bg);opacity:.9}
.btn-danger{color:var(--danger);border:0;justify-content:flex-start;padding:0;min-height:36px}
.btn-danger:hover{color:var(--danger);opacity:.75}
.acts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s2)}
.acts-row{display:flex;gap:var(--s2);flex-wrap:wrap;margin-top:var(--s3)}

/* ---- nested confirm / edit forms ---------------------------------------- */
.confirm > summary{list-style:none}
.acts > form,.acts > details{display:block;min-width:0}
.acts .btn{width:100%}
/* an open drawer form spans the grid, so its fields get the full width */
.acts > details[open]{grid-column:1/-1;margin-top:var(--s2);padding-top:var(--s3);border-top:1px solid var(--line-soft)}
.confirm[open]{margin-top:var(--s3)}
.acts-row .confirm[open]{padding-top:var(--s3);border-top:1px solid var(--line-soft)}
.confirm p{font-size:var(--text-small);color:var(--ink-2);margin:0 0 var(--s3)}
.field{display:block;margin-bottom:var(--s3)}
.field span{
  display:block;font:600 var(--text-meta)/1 var(--mono);letter-spacing:.09em;
  text-transform:uppercase;color:var(--ink-3);margin-bottom:var(--s2);
}
.field input,.field textarea,.field select{
  width:100%;padding:10px var(--s3);background:var(--bg);
  border:1px solid var(--line);border-radius:var(--r-md);
}
.field textarea{min-height:96px;resize:vertical;line-height:1.5}
.field input:focus,.field textarea:focus,.field select:focus{outline:2px solid var(--accent);outline-offset:-1px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:var(--s3)}

/* the split form: each word is a submit button marking where item two starts */
.words{
  display:flex;flex-wrap:wrap;gap:2px;margin-bottom:var(--s3);
  padding:var(--s3);background:var(--bg);border:1px solid var(--line);border-radius:var(--r-md);
}
.word{
  border:0;background:none;padding:2px 3px;border-radius:var(--r-sm);
  font:400 var(--text-body)/1.5 var(--font);color:var(--ink-2);
}
.word:hover{background:var(--accent);color:var(--bg)}

/* ---- transcript --------------------------------------------------------- */
.tx{border-top:1px solid var(--line-soft)}
.tx-head{
  display:flex;align-items:center;gap:var(--s2);padding:var(--s3) var(--s5);
  font:500 var(--text-meta)/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;
  color:var(--ink-3);min-height:var(--tap);
}
.tx-head .r{margin-left:auto}
.tx-body{padding:0 var(--s5) var(--s4)}
.tx-body p{font:400 var(--text-body)/1.6 var(--font);color:var(--ink-2);margin:0 0 var(--s3);text-wrap:pretty}
.fix{background:color-mix(in srgb,var(--idea) 18%,transparent);border-radius:var(--r-sm);padding:0 3px}
.tx-raw{margin-top:var(--s3);border-top:1px dashed var(--line);padding-top:var(--s3)}
.tx-raw .tx-head{padding:0;min-height:32px}
.audio{width:100%;height:40px;margin-top:var(--s3);display:block}
.chev-r{transition:transform .12s;flex:none}
details[open] > summary .chev-r{transform:rotate(90deg)}

/* ---- capture-level states ---------------------------------------------- */
.state{padding:var(--s4) var(--s5)}
.state h2{font:600 var(--text-title)/1.3 var(--font);margin:0 0 var(--s1)}
.state p{font-size:var(--text-small);color:var(--ink-2);margin:0}
.bar{height:2px;background:var(--line-soft);overflow:hidden}
.bar i{display:block;height:2px;width:55%;background:var(--accent);animation:work 1.4s ease-in-out infinite}
@keyframes work{0%,100%{opacity:.4}50%{opacity:1}}
.quote{
  margin:var(--s3) 0 0;padding:var(--s3);background:var(--bg);
  border:1px solid var(--line);border-radius:var(--r-md);
  font-size:var(--text-small);color:var(--ink-2);line-height:1.55;
}
.split-acts{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--line-soft)}
.split-acts > *{min-height:var(--tap)}
.split-acts > * + *{border-left:1px solid var(--line-soft)}
.split-acts .btn{border:0;border-radius:0;width:100%}

/* ---- empty -------------------------------------------------------------- */
.empty{
  background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);
  padding:56px var(--s5);text-align:center;
}
.empty h2{font:600 var(--text-title)/1.3 var(--font);margin:var(--s3) 0 var(--s1)}
.empty p{font-size:var(--text-small);color:var(--ink-2);margin:0 0 var(--s5)}

/* ---- login -------------------------------------------------------------- */
.login{max-width:380px;margin:18vh auto;padding:0 var(--s5)}
.login h1{font:600 var(--text-head)/1.2 var(--font);margin:0 0 var(--s2)}
.login p{font-size:var(--text-small);color:var(--ink-2);margin:0 0 var(--s5)}
.err,.login p.err{color:var(--danger);font-size:var(--text-small);margin:0 0 var(--s4)}

/* ---- desktop ------------------------------------------------------------ */
@media (min-width:900px){
  .wrap{padding:0 var(--s6) 96px}
  .layout{display:grid;grid-template-columns:220px minmax(0,var(--col));gap:48px;align-items:start}
  .chips{display:none}
  .rail{display:block;position:sticky;top:var(--s6)}
  .rail h2{
    font:600 var(--text-meta)/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;
    color:var(--ink-3);margin:0 0 var(--s3);
  }
  .rail h2 + h2{margin-top:var(--s6)}
  .rail-link{
    display:flex;align-items:center;gap:var(--s2);padding:7px 0;
    border-bottom:1px solid var(--line-soft);color:var(--ink-2);
    font-size:var(--text-small);
  }
  .rail-link:hover{color:var(--ink);opacity:1}
  .rail-link[aria-current="true"]{color:var(--ink);font-weight:600}
  .rail-link .n{margin-left:auto;font:500 var(--text-meta)/1 var(--mono);color:var(--ink-3)}
  .rail-chips{display:flex;flex-wrap:wrap;gap:var(--s2)}
  .moves{grid-template-columns:repeat(6,minmax(0,1fr))}
  .moves .btn{padding:0 var(--s2);gap:var(--s1);letter-spacing:.04em}
  .btn-now{display:none}
  .acts{display:flex;flex-wrap:wrap;align-items:flex-start}
  .acts > form,.acts > details{flex:0 0 auto}
  .acts .btn{width:auto;padding:0 var(--s5)}
  .acts > details[open]{flex:1 0 100%;margin-top:var(--s3)}
}
@media (prefers-reduced-motion:reduce){
  *{animation:none!important;transition:none!important}
}
`;
