// Static build: renders the pages into public/. Run with `npm run site:build`.
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

/* ---------------- Home + Book a Call (full-bleed redesign; home.css / home.js) ---------------- */
// Fill these in as they come: empty social URLs render without a link, and bracketed
// placeholder quotes are left off the page.
const social = [['YouTube', ''], ['Instagram', ''], ['Facebook', ''], ['LinkedIn', ''], ['Rent-repreneur Podcast', '']];
const proof = [['$10,000+', 'Monthly rental income from my own fleet'], ['150+', 'Rent-repreneurs reading every Sunday'], ['DOZENS', 'Rental categories run on the same system']];
const quotes = [
  ['[Subscriber result — e.g. what they rented and what it made]', '[Name, city]'],
  ['[Subscriber result — e.g. how the newsletter helped them start]', '[Name, city]'],
].filter(([t]) => !t.startsWith('['));
const ideaGroups = ['All', 'Wheels', 'Water', 'Gear & space'];
// [image slot, label, group, who rents]
const ideas = [
  ['rent-trailers', 'Trailers', 'Wheels', 'Movers, landscapers, weekend haulers'],
  ['rent-tools', 'Tools', 'Gear & space', 'DIYers who need it once'],
  ['rent-cars', 'Cars', 'Wheels', 'Travelers and between-car locals'],
  ['rent-outdoor-equipment', 'Outdoor Equipment', 'Water', 'Summer tourists and families'],
  ['rent-water-craft', 'Water craft', 'Water', 'Lake-day groups'],
  ['rent-atvs', 'ATVs', 'Wheels', 'Weekend adventurers'],
  ['rent-spaces', 'Spaces', 'Gear & space', 'People fixing their own cars'],
];
const teach = [
  ['Build the brand', 'Turn one item into a rental people trust — name, photos, listings and reviews.'],
  ['Optimize the systems', 'Automate bookings, deposits, pickups and messages so it runs without you.'],
  ['Replace the income', 'Reinvest and stack rentals until they replace your paycheck. Keep the 9–5 while you build.'],
];
const issue = [
  ['One rental idea', 'Something people rent, who rents it and what to charge.'],
  ['One listing that works', 'A real listing broken down: photos, price, copy.'],
  ['One system or tool', 'How I automate a piece of the business.'],
];
// [thumbnail slot, title, length, url]
const startHere = [
  ['vid-0', 'How I became a rent-repreneur with a 9–5', '18:42', ''],
  ['vid-1', 'My utility trailer paid for itself', '12:05', ''],
  ['vid-2', 'Automating bookings, deposits and pickups', '11:48', ''],
];
const homeFaq = [
  ['How much do I need to start?', 'Most people start with something they already own, so the first rental can cost little or nothing up front. The newsletter covers when it makes sense to buy.'],
  ['How many hours a week does it take?', 'Once bookings, payments and pickups are automated, a rental takes a few hours a week. The system is built to fit around a full-time job.'],
  ['What if something gets damaged?', 'Deposits, rental agreements and the right insurance cover most of the risk. I break down my exact setup in the newsletter.'],
  ['Do I have to quit my job?', "No. The whole point is to build rental income alongside your 9–5 until you decide you don't need it."],
];

const pic = (id, ph, alt = '') => {
  const e = imgFor(id);
  return e ? `<img class="img" src="/img/${id}.${e}" alt="${alt}" loading="lazy">` : `<span class="ph">${ph}</span>`;
};
const logo = (href) => `<a href="${href}" class="logo"><b>Nathan Curtis</b><span>The Rent-repreneur</span></a>`;
const mailForm = (source, note) => `<form class="mail" data-signup="${source}" novalidate>
<input type="email" name="email" required autocomplete="email" placeholder="Your email" aria-label="Your email">
<button type="submit">Join free →</button>
<small>${note}</small>
<span class="err" role="alert" hidden></span>
</form>`;

const shell2 = ({ title, desc, body, path, cls = '' }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="https://nathancurtis.space${path}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta name="theme-color" content="#121a16">
<link rel="stylesheet" href="https://use.typekit.net/urg8mkb.css">
<link rel="stylesheet" href="/home.css">
</head>
<body${cls ? ` class="${cls}"` : ''}>
${body}
<script src="/home.js" defer></script>
</body>
</html>
`;

const home = shell2({
  title: 'Nathan Curtis — The Rent-repreneur',
  desc: 'Build a rental business around your 9–5. One rental idea and one system every Sunday in the All For Rent newsletter.',
  path: '/',
  body: `
<div class="hz" aria-hidden="true"></div>
<header class="hdr px">
${logo('#top')}
<button type="button" class="burger" aria-label="Menu" aria-expanded="false" aria-controls="menu" data-menu-open><span></span><span></span><span></span></button>
</header>

<div class="menu px" id="menu" role="dialog" aria-modal="true" aria-label="Menu" hidden>
<div class="menu-top"><span>Menu</span><button type="button" class="x" aria-label="Close" data-menu-close>×</button></div>
<nav>${[['Newsletter', '#newsletter'], ['Rental ideas', '#ideas'], ['Videos', '#videos'], ['My story', '#story'], ['Book a call', '#call']]
  .map(([l, h]) => `<a href="${h}" data-menu-close><span>${l}</span><i>→</i></a>`).join('')}</nav>
<a href="#newsletter" class="menu-cta" data-popup>Join the newsletter</a>
</div>

<main>
<section id="top" class="hero cols">
<div class="hero-t px">
<span class="eyebrow dot">The All For Rent Newsletter</span>
<h1 class="disp">build<br>rental<br>business</h1>
<p>I believe rentals are the next part of the digital revolution. Every Sunday I send one rental idea and one system to help you build a brand and replace your income, all while keeping your 9–5.</p>
${mailForm('hero', 'Free every Sunday. 3-minute read. Unsubscribe anytime.')}
<div class="ok" data-ok hidden><b>You're in.</b><span>Check your inbox for your first issue.</span></div>
<a href="/book" class="ulink">Already renting and out of time? Book a free call →</a>
</div>
<div class="hero-p">${pic('hero-portrait', 'Nathan — portrait cutout on white', 'Nathan Curtis')}</div>
</section>

<section class="proof cols" aria-label="By the numbers">
${proof.map(([n, l]) => `<div class="px"><b>${n}</b><span>${l}</span></div>`).join('\n')}
</section>

<section id="ideas" class="ideas px">
<div class="intro">
<span class="eyebrow amber">Where my system has been applied</span>
<h2 class="disp h2d">You can rent anything.</h2>
<p>Start with what's already in your garage, driveway or shed. Pick a category to find your first rental.</p>
</div>
<div class="chips" data-ideas-filter>${ideaGroups.map((g, i) => `<button type="button" class="chip" aria-pressed="${i === 0}">${g}</button>`).join('')}</div>
<div class="igrid">
${ideas.map(([id, l, g, who]) => `<div class="card" data-group="${g}"><div class="pic">${pic(id, l, l)}</div><div class="t"><b>${l}</b><span><i>Who rents: </i>${who}</span></div></div>`).join('\n')}
<a href="#newsletter" class="more" data-popup><b>Don't see yours?</b><span>Join the newsletter and reply with what you own. I'll tell you if it'll rent.</span><strong>Join free →</strong></a>
</div>
</section>

<section class="teach px">
<h2 class="h2">What I teach</h2>
<div class="steps cols">
${teach.map(([t, b], i) => `<div><span class="sq">${i + 1}</span><div><b>${t}</b><span>${b}</span></div></div>`).join('\n')}
</div>
</section>

<div class="hz12" aria-hidden="true"></div>
<section id="newsletter" class="news cols px">
<div>
<span class="eyebrow">All For Rent · Every Sunday</span>
<h2 class="disp h2d">Keep the 9–5. Build the fleet.</h2>
<div class="issue">${issue.map(([t, b], i) => `<div><em>0${i + 1}</em><div><b>${t}</b><span>${b}</span></div></div>`).join('')}</div>
</div>
<div>
${mailForm('newsletter', '3-minute read. Unsubscribe anytime.')}
<div class="ok" data-ok hidden><b>You're in.</b><span>First issue lands Sunday.</span></div>
${quotes.map(([t, w]) => `<figure class="quote"><blockquote>“${t}”</blockquote><figcaption>${w}</figcaption></figure>`).join('\n')}
</div>
</section>

<section id="videos" class="videos">
<div class="head px"><h2>Start here</h2><p>Three free breakdowns for new rent-repreneurs.</p></div>
<div class="rail px">
${startHere.map(([id, t, len, url]) => `<a href="${url || '#videos'}"${url ? ' target="_blank" rel="noopener"' : ''}><div class="th">${pic(id, 'Thumbnail')}<span class="len">${len}</span></div><b>${t}</b></a>`).join('\n')}
</div>
</section>

<section id="story" class="story cols">
<div class="story-p">${pic('story-garage', 'Nathan in the garage bay', 'Nathan in the garage bay')}</div>
<div class="story-t px">
<span class="eyebrow amber">Hey, I'm Nathan</span>
<h2 class="h2">I started by renting garage space.</h2>
<p>My first rental business rented shop space so people could fix their own cars. Once I found the right automated system, I realized it works for almost anything. My mission: every rent-repreneur should know the tools they need to succeed.</p>
<a href="/about" class="ulink">Read the full story →</a>
</div>
</section>

<section id="call" class="call cols px">
<div>
<span class="eyebrow">Already renting? · Free 30-minute call</span>
<h2 class="h2">Your rentals shouldn't run your life.</h2>
<p>For owners juggling bookings, messages, deposits and pickups on top of a 9–5. We'll walk through how you run things today, and you'll leave knowing exactly what to automate first so you can get your time back.</p>
</div>
<div><a href="/book" class="bar-btn"><span>Book a free call</span><span>→</span></a><small>Limited spots each week.</small></div>
</section>

<section id="faq" class="faq cols px">
<h2 class="h2">Before you start</h2>
<div class="faql" data-faq>
${homeFaq.map(([q, a], i) => `<div><button type="button" aria-expanded="false" aria-controls="faq-${i}"><span>${q}</span><i aria-hidden="true">+</i></button><p id="faq-${i}" hidden>${a}</p></div>`).join('\n')}
</div>
</section>
</main>

<footer class="foot px">
<b>Nathan Curtis</b>
<div class="social cols">${social.map(([l, u]) => (u ? `<a href="${u}" target="_blank" rel="noopener"><span>${l}</span><i>↗</i></a>` : `<a><span>${l}</span><i>↗</i></a>`)).join('')}</div>
<small>© 2026 Nathan Curtis · <a href="/guide">Guide</a> · <a href="/about">About</a></small>
</footer>

<div class="sbar px">
<button type="button" data-popup>Join the newsletter</button>
<a href="/book">Book a call</a>
</div>

<div class="ov" data-popup-overlay hidden>
<div class="pop" role="dialog" aria-modal="true" aria-labelledby="pop-h">
<div class="hz" aria-hidden="true"></div>
<div class="pop-in">
<div class="pop-top"><span class="eyebrow">All For Rent · Every Sunday</span><button type="button" class="x" aria-label="Close" data-popup-close>×</button></div>
<div data-pop-form style="display:flex;flex-direction:column;gap:16px">
<h2 id="pop-h" class="disp">One rental idea. Every Sunday.</h2>
<p>Plus one listing that works and one system to automate. Three-minute read.</p>
${mailForm('popup', 'No spam. Unsubscribe anytime.')}
</div>
<div data-ok hidden style="display:flex;flex-direction:column;gap:16px">
<h2 class="disp">You're in.</h2>
<p>Your first issue lands Sunday. Already renting and short on time?</p>
<a href="/book" class="bar-btn o"><span>Book a free call</span><span>→</span></a>
</div>
</div>
</div>
</div>`,
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
<div class="row"><a href="/book" class="btn yel">Free Consultation Call</a><a href="#story" class="btn out">Read the story</a></div>
<div class="vtabs" style="margin-top:12px">${['Rented shop space', 'Found the system', 'Saw the pattern', 'Shares it all'].map((t) => `<div style="height:140px">${t}</div>`).join('')}</div>
</div>
<div class="abt-r">${slot('about-hero', 'Nathan in the garage')}<div class="badge">Own it. Rent it. Replace it.</div></div>
</section></div>
<section id="story" class="tl pad">
<div class="sticky"><span class="label amber">The story</span><h2 class="ind">From one garage to a system anyone can use.</h2><p>Four chapters, and the mission that came out of them.</p><a href="/book" class="btn yel sm" style="width:max-content">Free Consultation Call</a></div>
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
<div class="row"><a href="/book" class="btn blk-y" style="padding:18px 32px">Free Consultation Call</a><a href="/newsletter" class="btn out-k" style="padding:18px 32px">Get chapter one free</a></div></div>
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

const book = shell2({
  title: 'Book a free call — Nathan Curtis',
  desc: "Already renting and out of time? Book a free 30-minute call and leave knowing exactly what to automate first.",
  path: '/book',
  body: `
<div class="bk-page">
<div class="hz" aria-hidden="true"></div>
<header class="hdr px">${logo('/')}<a href="/" class="back">← Back</a></header>
<main class="book cols">
<div class="bk-l">
<div>
<span class="eyebrow" style="color:#FAA534">Already renting? · Free 30-minute call</span>
<h1 class="disp">Get your time back.</h1>
<p>For owners juggling bookings, messages, deposits and pickups on top of a 9–5. We'll walk through how you run things today and find what to automate first.</p>
</div>
<div class="agenda">
${[['How you run it today', 'Bookings, payments, messages, handoffs — where your hours go.'], ['What to automate first', 'The one or two changes that free up the most time.'], ['The tools I use', 'My exact setup, so you can copy what works.']]
  .map(([t, b], i) => `<div><em>0${i + 1}</em><div><b>${t}</b><span>${b}</span></div></div>`).join('\n')}
</div>
</div>
<div class="bk-r" data-book>
<div data-step="0">
<div class="bk-h"><em>Step 1 of 2</em><h2>Pick a time</h2><small>Times shown in your local time zone.</small></div>
<div class="days" role="group" aria-label="Day" data-days></div>
<div class="times" role="group" aria-label="Time" data-times></div>
<p class="ferr" data-slots-msg>Loading open times…</p>
<button type="button" class="cta" data-next disabled>Select a time</button>
</div>
<form data-step="1" hidden novalidate>
<div class="bk-h"><em>Step 2 of 2</em><h2>A little about your rentals</h2>
<div class="slot"><span class="tag" data-slot-label></span><button type="button" class="change" data-back>Change</button></div></div>
<div class="two cols">
<label class="fld">Name<input name="name" required autocomplete="name" placeholder="Jane Smith"></label>
<label class="fld">Email<input type="email" name="email" required autocomplete="email" placeholder="you@email.com"></label>
</div>
<div class="grp"><span>What do you rent?</span><div class="chips" data-chips="renting">${['Trailers', 'Tools', 'Cars', 'Outdoor equipment', 'Water craft', 'ATVs', 'Spaces', 'Other'].map((o) => `<button type="button" class="chip" aria-pressed="false">${o}</button>`).join('')}</div></div>
<div class="grp"><span>What eats most of your time?</span><div class="chips" data-chips="drains">${['Booking & scheduling', 'Messages', 'Payments & deposits', 'Pickups & returns', 'Cleaning & upkeep', 'Listings & pricing'].map((o) => `<button type="button" class="chip" aria-pressed="false">${o}</button>`).join('')}</div></div>
<label class="fld">Anything else? <em>Optional</em><textarea name="notes" rows="3" placeholder="How many rentals, what tools you use today, where you're stuck."></textarea></label>
<div class="ferr" role="alert" data-err></div>
<button type="submit" class="cta">Confirm my call →</button>
</form>
<div class="done" data-step="2" hidden>
<span class="eyebrow amber">You're booked</span>
<h2 class="disp">Talk soon.</h2>
<span class="tag" data-slot-label></span>
<p>I'll confirm with a calendar invite and call link in your inbox.</p>
<a href="/" class="bar-btn l"><span>Back to home</span><span>→</span></a>
</div>
</div>
</main>
<footer class="bk-foot px"><b>Nathan Curtis</b><span>© 2026 Nathan Curtis</span></footer>
</div>`,
});

const pages = { 'index.html': home, 'guide.html': guide, 'about.html': about, 'newsletter.html': signup, 'book.html': book };
for (const [f, html] of Object.entries(pages)) writeFileSync(join(out, f), html);
copyFileSync(join(root, 'src/styles.css'), join(out, 'styles.css'));
copyFileSync(join(root, 'src/site.js'), join(out, 'site.js'));
copyFileSync(join(root, 'src/home.css'), join(out, 'home.css'));
copyFileSync(join(root, 'src/home.js'), join(out, 'home.js'));
writeFileSync(join(out, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://nathancurtis.space/sitemap.xml\n');
const paths = ['/', '/book', '/guide', '/about', '/newsletter'];
writeFileSync(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((p) => `<url><loc>https://nathancurtis.space${p}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log('built', Object.keys(pages).length, 'pages');
