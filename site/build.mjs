// Static build: renders the five pages into public/. Run with `npm run site:build`.
// Photos: drop files named after the slot id (e.g. img/hero-portrait.jpg) into site/img/
// and rebuild; empty slots render as a labelled placeholder.
import { mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'public');
mkdirSync(join(out, 'img'), { recursive: true });
if (existsSync(join(root, 'img'))) {
  for (const f of readdirSync(join(root, 'img'))) copyFileSync(join(root, 'img', f), join(out, 'img', f));
}
const imgFor = (id) =>
  ['jpg', 'jpeg', 'png', 'webp', 'avif'].find((e) => existsSync(join(root, 'img', `${id}.${e}`)));

const slot = (id, ph) => {
  const e = imgFor(id);
  return `<div class="slot">${e ? `<img src="/img/${id}.${e}" alt="" loading="lazy">` : ph}</div>`;
};

const nav = (active) => `
<header class="hdr pad">
<a href="/" class="logo"><b>Nathan Curtis</b><span>The Rent-repreneur Guide</span></a>
<nav class="nav">
${[['guide', '/guide', 'guide'], ['videos', '/#videos', 'videos'], ['story', '/about', 'story'], ['newsletter', '/newsletter', 'newsletter']]
  .map(([k, h, l]) => `<a href="${h}"${active === k ? ' class="on"' : ''}>${l}</a>`).join('\n')}
</nav>
<a href="/newsletter" class="join">Join free</a>
</header>`;

const navBack = (active, href, text) => `
<header class="hdr pad">
<a href="/" class="logo"><b>Nathan Curtis</b><span>The Rent-repreneur Guide</span></a>
<nav class="nav">
${[['guide', '/guide', 'guide'], ['videos', '/#videos', 'videos'], ['story', '/about', 'story'], ['newsletter', '/newsletter', 'newsletter']]
  .map(([k, h, l]) => `<a href="${h}"${active === k ? ' class="on"' : ''}>${l}</a>`).join('\n')}
</nav>
<a href="${href}" class="back">${text}</a>
</header>`;

const footer = (dark, last = ['Newsletter', '/newsletter']) => `
<footer class="foot pad${dark ? ' dark' : ''}">
<b>Nathan Curtis</b>
<div><a href="/guide">Guide</a><a href="/#videos">Videos</a><a href="/about">About</a><a href="${last[1]}">${last[0]}</a></div>
<span>© 2026 Nathan Curtis</span>
</footer>`;

const hazard = '<div class="hazard" aria-hidden="true"></div>';

const shell = ({ title, desc, body, path }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="https://nathancurtis.space${path}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<link rel="stylesheet" href="https://use.typekit.net/urg8mkb.css">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div class="outer"><div class="page">
${body}
</div></div>
<script src="/site.js" defer></script>
</body>
</html>
`;

const chipGroup = (name, opts) =>
  `<div class="chips" data-chips="${name}">${opts.map((o) => `<button type="button" class="chip" aria-pressed="false">${o}</button>`).join('')}</div>`;
const seg = (name, opts, sel) =>
  `<div class="seg" data-seg="${name}">${opts.map((o, i) => `<button type="button" aria-pressed="${i === sel}">${o}</button>`).join('')}</div>`;

/* ---------------- Home ---------------- */
const videos = [
  ['How I became a rent-repreneur with a 9–5', '18:42', 'Popular'],
  ['My utility trailer paid for itself in 7 weeks', '12:05', 'Trailers'],
  ['Renting paddleboards: the summer playbook', '09:31', 'Water'],
  ['Tools people rent every weekend', '14:20', 'Tools'],
  ['Renting out a car without losing sleep', '21:10', 'Cars'],
  ['Automating bookings, deposits and pickups', '11:48', 'Popular'],
];
const tabs = ['Popular', 'Trailers', 'Water', 'Tools', 'Cars', 'See all'];

const home = shell({
  title: 'Nathan Curtis — The Rent-repreneur Guide',
  desc: 'Rent anything — trailers, tools, cars, paddleboards, camping gear, shop space. Replace your income and keep your 9–5.',
  path: '/',
  body: `
<div class="rel">
<div class="vline" style="left:calc(clamp(20px,4vw,56px) + 120px + clamp(10px,2vw,32px))" aria-hidden="true"></div>
<div class="vline" style="left:50%" aria-hidden="true"></div>
<div class="vline" style="right:90px" aria-hidden="true"></div>
${nav('')}
<section id="top" class="hero">
<div class="hero-l">
<aside class="side">
<div><span class="ind">Start</span>
<nav><a href="/guide">The Guide</a><a href="/#videos">YouTube</a><a href="/newsletter">Newsletter <i>free</i></a><a href="/about">About</a></nav></div>
<span class="ind">Info</span>
</aside>
<div class="hero-c">
<span style="font-size:14px;color:#2c3a33" data-slide="eyebrow"></span>
<h1 class="disp" data-slide="word"></h1>
<p data-slide="desc"></p>
<form class="mail" data-email-redirect>
<input type="email" name="email" required placeholder="Your email" aria-label="Your email">
<button type="submit" class="blk">Get the free guide</button>
</form>
<a href="/#videos" class="watch"><i>▶</i> Watch: my first $1k rental month</a>
<div class="vtabs" style="margin-top:auto">${['Trailers', 'Paddleboards', 'Tools & gear', 'Cars'].map((p) => `<div style="height:150px">${p}</div>`).join('')}</div>
</div>
</div>
<div class="hero-r">
<div class="pic">${slot('hero-portrait', 'Nathan — portrait cutout on white')}</div>
<div class="rail" data-rail></div>
<div class="pn"><button type="button" data-prev aria-label="Previous">‹</button><button type="button" data-next aria-label="Next">›</button></div>
</div>
</section>
</div>
${hazard}
<div class="channels pad"><b>Find me on</b><span>YouTube</span><span>Instagram</span><span>Facebook</span><span>LinkedIn</span><span>The Rent-repreneur Podcast</span></div>

<section id="guide" class="offers">
<div class="offer" style="background:#FAA534;color:#121a16">
<div class="dim" style="opacity:.35">${slot('block-guide', 'Trailer / paddleboards / gear lineup')}</div>
<div class="in">
<span class="label">01 — The flagship</span>
<h2 class="ind">The Rent-repreneur Guide</h2>
<p>How to buy the right gear, list it, price it and automate bookings — trailers, paddleboards, tools, cars. Built to run around your 9–5.</p>
<div class="row"><a href="/guide" class="btn blk">Get the guide</a><a href="/guide#chapters" class="btn out-k">What's inside</a></div>
</div></div>
<div class="offer" style="background:#121a16;color:#fbfcfa">
<div class="dim" style="opacity:.3">${slot('block-news', 'Nathan handing off a rental')}</div>
<div class="in">
<span class="label">02 — Every Sunday</span>
<h2 class="ind">All For Rent<br>Newsletter</h2>
<p>One item worth renting, one listing that works, one number from my week. Three-minute read, free forever.</p>
<div class="row"><a href="/newsletter" class="btn" style="background:#fbfcfa;color:#121a16">Subscribe</a><a href="#newsletter" class="btn" style="border:1.5px solid #fbfcfa;color:#fbfcfa">Read an issue</a></div>
</div></div>
</section>

<section id="videos" class="videos pad">
<div class="center"><h2 class="ind h2c">Start here</h2><p>Free breakdowns for new rent-repreneurs. What to buy, what it earns, how to run it on autopilot.</p></div>
<div class="vwrap">
<div class="vtab" data-vtabs>${tabs.map((t, i) => `<button type="button"${i === 0 ? ' class="on"' : ''}>${t}</button>`).join('')}</div>
<div class="vgrid" data-vgrid>
${videos.map((v, i) => `<a href="/#videos" class="vcard" data-cat="${v[2]}"><div class="th">${slot('vid-' + i, 'Thumbnail')}</div><div class="t"><b>${v[0]}</b><span>${v[1]}</span></div><small>${v[2]}</small></a>`).join('\n')}
</div></div>
</section>

<div class="band" aria-hidden="true">Trailers ■ Tools ■ Cars ■ Camping gear ■ Paddleboards ■ Shop space ■ Trailers ■ Tools ■ Cars</div>

<section id="story" class="story pad">
<div class="wordmark disp" aria-hidden="true">CURTIS</div>
<div class="story-g">
<div class="story-t">
<span class="label amber">Hey, I'm Nathan</span>
<h2 class="ind">I started by renting garage space.</h2>
<p>My first rental business rented shop space so people could fix their own cars. Once I found the right automated system, I realized it works for almost anything. Trailers or tools, cars or camping supplies: my mission is to make sure every rent-repreneur knows the tools they need to succeed.</p>
<div class="row" style="align-items:center;gap:24px"><a href="/consultation" class="btn yel sm">Free Consultation Call</a><a href="/about" class="ulink">Read the full story →</a></div>
</div>
<div class="photos">
<div style="height:260px">${slot('story-1', 'Nathan in the garage bay')}</div>
<div style="height:400px;border-radius:200px 200px 0 0;overflow:hidden">${slot('story-2', 'Nathan — arch portrait')}</div>
</div>
</div>
</section>

${hazard}
<section id="newsletter" class="cta news pad">
<div class="lab"><span class="label">All For Rent<br>Newsletter</span><h2 class="disp">Own it.<br>Rent it.<br>Replace it.</h2></div>
<div style="display:flex;flex-direction:column;gap:20px">
<p>Become a rent-repreneur. Get the first chapter of the guide today, then one item worth renting every Sunday. Keep your 9–5 and build income on the side.</p>
<form data-email-redirect><input type="email" name="email" required placeholder="Your email" aria-label="Your email"><button type="submit">Get the free guide</button></form>
<span style="font-size:12px;color:#2a2210">No spam. Unsubscribe anytime.</span>
</div>
</section>
${footer(true)}`,
});

/* ---------------- Guide ---------------- */
const chapters = [
  ['Pick what to rent', 'How to spot items with real demand in your area — and the ones that look good but never book.'],
  ['Buy it right', 'New vs. used, where to find deals, and how to make sure an item can pay itself back.'],
  ['List it', 'Where to list, how to photograph, and the listing copy that gets booked.'],
  ['Price it', 'Daily, weekend and weekly rates, deposits, and when to raise prices.'],
  ['Protect it', 'Rental agreements, deposits, insurance basics and handling damage calmly.'],
  ['Automate it', 'Online booking, payments, lockboxes and pickup scheduling — so it runs while you work.'],
  ['Scale around your 9–5', 'When to add the next item, how to reinvest, and how to keep it a side business.'],
];
const faqs = [
  ['Do I need a lot of money to start?', 'No. The guide starts with gear you may already own, then shows how to choose a first purchase that can pay itself back.'],
  ['Will this work with a full-time job?', "That's the whole point. Everything is designed around nights, weekends and automation so it doesn't compete with your job."],
  ['What about damage and insurance?', 'Chapter five covers agreements, deposits and insurance basics. Rules vary by location, so the guide shows you what to check locally.'],
  ['What can I actually rent?', "Trailers, paddleboards, kayaks, tools, cars, camping gear — if people need it occasionally and don't want to own it, it's a candidate."],
  ['Is chapter one really free?', 'Yes. Sign up and it lands in your inbox right away.'],
];
const forYou = ["You have a job and want income that isn't tied to it.", 'You already own gear that sits unused most of the week.', 'You want a business that runs without you on the phone.'];

const guide = shell({
  title: 'The Rent-repreneur Guide — Nathan Curtis',
  desc: 'The step-by-step playbook for buying gear, renting it out and automating the whole thing — built for people who keep their 9–5.',
  path: '/guide',
  body: `
<div class="rel"><div class="gridbg" aria-hidden="true"><div></div><div></div><div></div><div></div></div>
${nav('guide')}
<section class="split rel">
<div class="pad" style="padding-top:48px;padding-bottom:72px;display:flex;flex-direction:column;gap:24px;justify-content:center">
<span style="font-size:14px;color:#2c3a33">The Rent-repreneur Guide</span>
<h1 class="disp h1">Rent anything.</h1>
<p class="lead" style="max-width:440px">The step-by-step playbook for buying gear, renting it out and automating the whole thing — built for people who want to keep their 9–5.</p>
<div class="row"><a href="/newsletter" class="btn yel" style="padding:18px 28px">Get chapter one free</a><a href="#chapters" class="btn out">See all chapters</a></div>
</div>
<div class="rel" style="min-height:560px;background:#f1f3f2">${slot('guide-hero', 'Guide cover / tablet mockup')}</div>
</section></div>
<section class="for">
${forYou.map((t) => `<div class="pad"><span class="label">For you if</span><span class="ind">${t}</span></div>`).join('')}
</section>
<section id="chapters" class="chapters pad">
<div class="center"><h2 class="ind h2c">What's inside</h2><p>Seven chapters, in the order you'll need them.</p></div>
<div class="chgrid">
${chapters.map((c, i) => `<div><div class="n"><b>0${i + 1}</b><span>${i === 0 ? 'Free' : ''}</span></div><h3>${c[0]}</h3><p>${c[1]}</p></div>`).join('\n')}
<div class="free"><span>Start with chapter one — free.</span><a href="/newsletter" class="ulink" style="width:max-content">Send it to me →</a></div>
</div>
</section>
<section class="faq pad">
<div style="display:flex;flex-direction:column;gap:14px"><span class="label amber">Questions</span><h2 class="ind">Before you start</h2></div>
<div class="faql" data-faq>
${faqs.map((f, i) => `<div><button type="button" aria-expanded="${i === 0}"><span>${f[0]}</span><i>${i === 0 ? '−' : '+'}</i></button><p${i === 0 ? '' : ' hidden'}>${f[1]}</p></div>`).join('\n')}
</div>
</section>
${hazard}
<section class="cta pad">
<h2 class="disp">Own it.<br>Rent it.<br>Replace it.</h2>
<div style="display:flex;flex-direction:column;gap:22px"><p>Join free and get chapter one today, plus All For Rent<br>Newsletter every Sunday.</p><a href="/newsletter" class="btn blk-y" style="padding:18px 32px;width:max-content">Become a rent-repreneur</a></div>
</section>
${footer(false)}`,
});

/* ---------------- About ---------------- */
const story = [
  ['Renting space to fix cars', "My first rental business wasn't gear. It was space: garage bays, lifts and tools rented by the hour so people could fix their own cars without paying shop prices."],
  ['Finding the perfect system', 'Bookings, payments, door access, reminders, check-outs. I kept automating until the whole thing ran without me standing at the counter.'],
  ['The applications are endless', 'Once the system worked, I saw it everywhere. The same booking, payment and access flow works for trailers, tools, cars, camping supplies, anything people rent.'],
  ['The mission', "Whether you rent out a boat or a bounce house, party tables or power washers, every rent-repreneur should know the tools they need to succeed. That's what I teach here."],
];
const cats = [
  ['cat-trailers', 'Trailers', 'Moves, dump runs, weekend projects. Steady demand all year.', 'Utility trailer', '#FAA534', '#121a16'],
  ['cat-water', 'Paddleboards', 'Seasonal, high-demand, easy to store.', 'Paddleboards on a rack', '#121a16', '#fbfcfa'],
  ['cat-tools', 'Tools', 'The gear people need once and never want to buy.', 'Pressure washer / tools', '#2c3a33', '#fbfcfa'],
  ['cat-cars', 'Cars', 'Your idle weekday car, working while you do.', 'Car rental handoff', '#FAA534', '#121a16'],
];
const beliefs = [
  ['Keep the 9–5.', 'A steady paycheck is leverage, not a trap. Build the side income first — decide what to do with the job later.'],
  ['Buy assets, not stuff.', 'Before anything comes home, ask one question: will someone pay to use this on a Saturday?'],
  ['Automate before you scale.', 'If one rental needs you on the phone, ten will bury you. Systems first, second item after.'],
];

const about = shell({
  title: 'About Nathan Curtis — It started with a garage',
  desc: 'My first rental business rented shop space so people could fix their own cars. Automating it showed me the same system works for almost anything you can rent.',
  path: '/about',
  body: `
<div class="rel"><div class="gridbg" aria-hidden="true"><div></div><div></div><div></div><div></div></div>
${nav('story')}
<section class="split rel">
<div class="pad" style="padding-top:48px;padding-bottom:72px;display:flex;flex-direction:column;gap:24px;justify-content:center">
<span style="font-size:14px;color:#2c3a33">About Nathan</span>
<h1 class="disp h1">It started with a garage.</h1>
<p class="lead">I'm Nathan. My first rental business rented shop space so people could fix their own cars. Automating it showed me the same system works for almost anything you can rent.</p>
<div class="row"><a href="/consultation" class="btn yel">Free Consultation Call</a><a href="#story" class="btn out">Read the story</a></div>
<div class="vtabs" style="margin-top:12px">${['Rented shop space', 'Found the system', 'Saw the pattern', 'Shares it all'].map((t) => `<div style="height:140px">${t}</div>`).join('')}</div>
</div>
<div class="abt-r">${slot('about-hero', 'Nathan in the garage')}<div class="badge">Own it. Rent it. Replace it.</div></div>
</section></div>
<section id="story" class="tl pad">
<div class="sticky"><span class="label amber">The story</span><h2 class="ind">From one garage to a system anyone can use.</h2><p>Four chapters, and the mission that came out of them.</p><a href="/consultation" class="btn yel sm" style="width:max-content">Free Consultation Call</a></div>
<div>${story.map((c, i) => `<div class="tli"><b>0${i + 1}</b><div><h3>${c[0]}</h3><p>${c[1]}</p></div></div>`).join('\n')}</div>
</section>
<section class="cats">
${cats.map((c, i) => `<div class="cat" style="background:${c[4]};color:${c[5]}"><div class="dim" style="opacity:.35">${slot(c[0], c[3])}</div><div class="in"><span class="label">0${i + 1}</span><h3>${c[1]}</h3><p>${c[2]}</p></div></div>`).join('\n')}
</section>
<section class="beliefs pad">
<div class="center"><h2 class="ind h2c">What I believe</h2><p>Three rules that run the whole fleet.</p></div>
<div class="bgrid">${beliefs.map((b, i) => `<div><b>0${i + 1}</b><h3>${b[0]}</h3><p>${b[1]}</p></div>`).join('')}</div>
</section>
${hazard}
<section class="cta pad">
<h2 class="disp" style="font-size:clamp(44px,5.5vw,80px)">Your first rental is closer than you think.</h2>
<div style="display:flex;flex-direction:column;gap:22px"><p>Get chapter one of the Rent-repreneur Guide free — how to choose what to rent first, and what to avoid.</p>
<div class="row"><a href="/consultation" class="btn blk-y" style="padding:18px 32px">Free Consultation Call</a><a href="/newsletter" class="btn out-k" style="padding:18px 32px">Get chapter one free</a></div></div>
</section>
${footer(false)}`,
});

/* ---------------- Signup ---------------- */
const signup = shell({
  title: 'Join free — All For Rent Newsletter',
  desc: 'Get chapter one of the Rent-repreneur Guide and one item worth renting every Sunday.',
  path: '/newsletter',
  body: `
${navBack('newsletter', '/', '← Back home')}
<section class="fpage">
<div class="fdark">
<div style="display:flex;flex-direction:column;gap:22px">
<span class="label">Free — join the rent-repreneurs</span>
<h1 class="disp">Own it.<br>Rent it.<br>Replace it.</h1>
<p>Rent anything — trailers, paddleboards, tools, cars — and build income on the side without quitting your 9–5.</p>
</div>
<div class="steps">
<div><span class="ind">01</span><div><b>Chapter one of the guide</b><span class="d">How to pick your first rental — sent the moment you join.</span></div></div>
<div><span class="ind">02</span><div><b>All For Rent<br>Newsletter</b><span class="d">One item worth renting and one listing that works, every Sunday.</span></div></div>
<div><span class="ind">03</span><div><b>My rental agreement template</b><span class="d">The starting point I use for every item in my fleet.</span></div></div>
</div>
</div>
<div class="fright">
<form class="f" data-form="newsletter" novalidate>
<div style="display:flex;flex-direction:column;gap:10px"><h2>Start your rental side hustle.</h2><p class="sub">Takes 20 seconds. No spam, unsubscribe anytime.</p></div>
<label class="field">First name<input name="name" required autocomplete="given-name" placeholder="Nathan"></label>
<label class="field">Email<input type="email" name="email" required autocomplete="email" placeholder="you@email.com"></label>
<div class="grp"><span>What do you want to rent?</span>${chipGroup('interests', ['Trailers', 'Paddleboards & water', 'Tools & gear', 'Cars', 'Not sure yet'])}</div>
<div class="grp"><span>Where are you at?</span>${seg('stage', ['Just curious', 'Ready to buy', 'Already renting'], 1)}</div>
<div class="err" role="alert" data-err></div>
<button type="submit" class="submit">Send me chapter one →</button>
</form>
<div class="done" data-done hidden>
<span class="label amber">You're in</span>
<h2 class="disp">Welcome, <span data-name></span>.</h2>
<p>Chapter one is on its way to <span data-email></span>. Here's what to do while it lands:</p>
<div class="links"><a href="/#videos"><span>Watch the start-here video</span><span>→</span></a><a href="/guide"><span>See what's inside the full guide</span><span>→</span></a><a href="/about"><span>Read how I started</span><span>→</span></a></div>
<button type="button" class="linkbtn" data-reset>Use a different email</button>
</div>
</div>
</section>
${footer(false)}`,
});

/* ---------------- Consultation ---------------- */
const consultation = shell({
  title: 'Free Consultation Call — Nathan Curtis',
  desc: "Tell me what you're renting (or want to rent) and we'll map out the tools you need to run it on autopilot.",
  path: '/consultation',
  body: `
${navBack('', '/about', '← Back to story')}
<section class="fpage" style="min-height:0">
<div class="fdark" style="justify-content:flex-start">
<div style="display:flex;flex-direction:column;gap:22px">
<span class="label">Free consultation call</span>
<h1 class="disp" style="font-size:clamp(46px,5.4vw,78px)">Let's build your rental system.</h1>
<p>Trailers or tools, cars or camping gear — tell me what you're renting (or want to rent) and we'll map out the tools you need to run it on autopilot.</p>
</div>
<div class="steps">
<div><span class="ind">01</span><div><b>Where you are now</b><span class="d">What you rent, how bookings happen today, what eats your time.</span></div></div>
<div><span class="ind">02</span><div><b>The system that fits</b><span class="d">Booking, payments, access and reminders — the stack I'd use in your shoes.</span></div></div>
<div><span class="ind">03</span><div><b>Your next three steps</b><span class="d">You leave with a clear plan, whether or not we work together.</span></div></div>
</div>
</div>
<div class="fright" style="justify-content:flex-start">
<form class="f" style="gap:36px;max-width:520px" data-form="consultation" novalidate>
<div style="display:flex;flex-direction:column;gap:10px"><h2 style="font-size:clamp(28px,3vw,38px)">Book your free call</h2><p class="sub">Fill this out and I'll reach out to schedule a time.</p></div>
<div class="fsec"><span class="ind">01 — Contact</span>
<div class="two"><label class="field">Full name<input name="name" required autocomplete="name" placeholder="Jane Smith"></label><label class="field">Phone<input type="tel" name="phone" autocomplete="tel" placeholder="(555) 123-4567"></label></div>
<label class="field">Email<input type="email" name="email" required autocomplete="email" placeholder="you@email.com"></label></div>
<div class="fsec"><span class="ind">02 — Your business</span>
<div class="grp"><span>Have you already started a company?</span>${seg('started', ['Yes', 'Not yet', 'Getting started'], 1)}</div>
<div class="grp"><span>What are you renting?</span>${chipGroup('renting', ['Shop / garage space', 'Trailers', 'Tools & equipment', 'Cars', 'Camping gear', 'Water gear', 'Other'])}</div>
<label class="field">Website <em>Optional</em><input type="url" name="website" placeholder="https://yourrentals.com"></label></div>
<div class="fsec"><span class="ind">03 — What you want to learn</span>
${chipGroup('learn', ['Booking & payments', 'Automation', 'Pricing', 'Insurance & contracts', 'Marketing & listings', 'Scaling up', 'Choosing what to rent'])}
<label class="field">Anything else?<textarea name="notes" rows="4" placeholder="Tell me what you're stuck on or what you want out of the call."></textarea></label></div>
<div class="err" role="alert" data-err></div>
<button type="submit" class="submit">Request my free call →</button>
</form>
<div class="done" data-done hidden style="padding-top:40px">
<span class="label amber">Request received</span>
<h2 class="disp">Talk soon.</h2>
<p>I'll email you within two business days to lock in a time. In the meantime:</p>
<div class="links"><a href="/guide"><span>Browse the Rent-repreneur Guide</span><span>→</span></a><a href="/#videos"><span>Watch the free videos</span><span>→</span></a><a href="/newsletter"><span>Join the newsletter</span><span>→</span></a></div>
</div>
</div>
</section>
${footer(false, ['Free consultation', '/consultation'])}`,
});

const pages = { 'index.html': home, 'guide.html': guide, 'about.html': about, 'newsletter.html': signup, 'consultation.html': consultation };
for (const [f, html] of Object.entries(pages)) writeFileSync(join(out, f), html);
copyFileSync(join(root, 'src/styles.css'), join(out, 'styles.css'));
copyFileSync(join(root, 'src/site.js'), join(out, 'site.js'));
writeFileSync(join(out, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://nathancurtis.space/sitemap.xml\n');
const paths = ['/', '/guide', '/about', '/newsletter', '/consultation'];
writeFileSync(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((p) => `<url><loc>https://nathancurtis.space${p}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log('built', Object.keys(pages).length, 'pages');
