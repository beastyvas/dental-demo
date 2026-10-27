---
name: trade-site
description: Building or changing a client's website — the generated sites in lib/site.js (api/site.js) or a custom art-directed build for a Full Office / website-only client. Use for any page a trade business's customers will see. Covers the ban list of AI-default looks, Nevada's license-number rule, conversion requirements, and the plan → build → screenshot loop.
---

# Client websites (trade businesses)

Full playbook, sources and the master prompt: `docs/site-playbook.md`. Read it
before a custom build. The rules below apply to every client-facing page,
including the generated sites in `lib/site.js`.

## Non-negotiables

- **Nevada license number** (NRS 624.720) on every page: header or hero AND
  footer, with the company name. A site is never published without it
  (`site.license`). Never invent one, or reviews, warranties, ratings or badges.
  Every trust signal comes from the client.
- **Mobile conversion:** phone visible above the fold on every viewport; sticky
  bottom bar on mobile with "Call" (tel:) + the estimate CTA; booking embed at
  `#book` when the client has one (Jobber / HCP / Cal.com / Google appointment
  schedule), with the short form (→ `/api/leads/form?key=…`) as a fallback.
- **CTA labels say what happens** ("Book my free estimate", "Send my
  request"), never "Submit".
- **Real photos only.** Missing photo = a labeled, correctly sized placeholder;
  never stock or AI imagery.
- Fast: no framework runtime for generated sites, lazy images, LocalBusiness
  schema, unique title/description. Lighthouse 90+ on mobile.

## Ban list (AI defaults; ban by name, then extend with whatever round one fell into)

- Fonts: Inter, Roboto, Arial, Open Sans, Lato, Space Grotesk, system-ui stacks.
- Purple→blue gradients; decorative gradient washes; cream/off-white + serif +
  terracotta (#D97757-ish); near-black + one acid-green/vermilion accent.
- Centered hero + 3 identical cards; one radius + one soft grey shadow on
  everything (the "SaaS-card kit").
- Italic/colored accent word in headlines; ALL-CAPS tracked eyebrow labels;
  monospace labels; "01/02/03" unless it's a real sequence.
- Pill buttons/chips; "→" on every link; "A · B · C" meta strings; emoji icons.
- Fade-and-slide-up on every section; hover effects on every card.
- Copy: "elevate", "seamless", "your trusted partner", "solutions", "Submit",
  headlines that could belong to any business.

`test/site.test.js` checks the generated HTML against the mechanical parts of
this list. Keep it passing, and add a check when you find a new default.

## Generated sites (lib/site.js)

- Each client picks a **design direction** (`site.direction`): a distinct
  type pairing + layout feel. The brand color comes from the client
  (`site.color`) and the accent from the direction. Add directions here
  rather than tweaking one look for everyone.
- Spend boldness in one place: the before/after drag slider (`site.projects`)
  is the memorable moment. Everything else stays quiet. No scroll animations.
- Areas get their own pages (`/s/<slug>/<area>`), linked as plain text.

## Custom builds (Full Office, or when a client wants more)

Follow `docs/site-playbook.md`: art-directed brief (master prompt), 3 hero
directions for the client to pick from, a design plan reviewed against the ban
list **before** code, then build. GSAP + ScrollTrigger for one moment, Lenis
desktop-only, everything off under `prefers-reduced-motion`. Screenshot at
390px and 1440px, list the flaws, fix them, and repeat at least twice. Use high
effort for the main build. Keep the quote form posting to the client's
`/api/leads/form?key=…` so speed-to-lead still fires.

## Done means

Screenshots at 390 and 1440 checked against the ban list. Call button and
form tested. License number visible in header/hero and footer. Then list what
couldn't be verified (real-device scroll, older phones).
