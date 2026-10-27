# How to Get Non-Slop, Polished Websites Out of Claude (Nick's Playbook for Trade-Business Sites)

The single biggest fix is to stop asking Claude for "a website" and start handing it an art-directed brief that names the exact looks to ban, picks a specific visual direction, limits motion to one standout moment, and makes it check its own work with screenshots. Anthropic's own docs say Claude reverts to a small set of default styles when you don't give it direction.

## TL;DR

- **Why it looks like slop:** Anthropic calls the cause "distributional convergence": with no direction, Claude picks the safest, most common design choices. Back in 2025 that meant Inter, purple gradients and minimal animation. On Opus 5.5 it means cream backgrounds, an italic accent word in the headline, "01/02/03" section labels, monospace labels and pill-shaped buttons. Fix it by banning those patterns *by name*. "Make it not look AI" only swaps one default for another.
- **What the "smooth" viral sites use:** usually Claude Code plus Anthropic's frontend-design skill, an animation layer (GSAP + ScrollTrigger + Lenis, or Motion for React), component sources like 21st.dev/shadcn, and a screenshot → fix loop. GSAP has been 100% free, including all bonus plugins and commercial use, since its official 3.13 release in April 2025. Claude handles all of these well. What makes a site look expensive is real photography and restraint.
- **For the roofer:** build a fast static site with a sticky click-to-call button, an estimate-booking embed (Jobber if they already use it, otherwise Cal.com or Google Calendar's free booking page), a before/after gallery, reviews, a service-area section, and the Nevada contractor license number. Nevada law requires that number on all advertising, including websites. Host on Cloudflare Pages or Netlify, not Vercel's free Hobby plan, which Vercel's Fair Use Guidelines restrict to "non-commercial personal use only."

---

## Key Findings

### 1. Why AI sites look like "AI slop" (and the tells to ban)

**The root cause is statistical, not a lack of skill.** Anthropic's Applied AI team wrote (Nov 12, 2025) that without guidance an LLM building a landing page "will almost always conform to Inter fonts, purple gradients on white backgrounds, and minimal animations." The reason they give: "Safe design choices–those that work universally and offend no one–dominate web training data. Without direction, Claude samples from this high-probability center."

**The default look changed, but the habit didn't.** Anthropic's current "Prompting Claude Opus 5.5" guide says that when Opus 5.5 gets frontend work without design direction, it "falls back on a few default styles, and a general instruction such as 'avoid a generic AI look' mostly swaps one default for another." Its example fix bans five specific patterns: "a cream or off-white background, italic accent words in headlines, numbered '01/02/03' section labels, monospace labels, or pill-shaped buttons."

**Your ban list (combine the old and new tells):**

| Category | Tells to ban |
|---|---|
| Color | Purple→blue gradients; cream/off-white (#F4F1EA-ish) + serif + terracotta accent; near-black + one acid-green/vermilion accent; gradient washes as decoration |
| Type | Inter, Roboto, Arial, Open Sans, Lato, system fonts; Space Grotesk (Anthropic says Claude converges on it even when told to be creative); one italic/colored word in the headline; ALL-CAPS tracked "eyebrow" labels above every heading; monospace data labels |
| Layout | Centered hero + subtext + button + 3 identical feature cards; same border-radius and same soft grey shadow on everything; "01 / 02 / 03" markers on content that isn't a sequence; broadsheet hairline-rule layouts |
| Chrome | Pill buttons; "→" appended to every link; "A · B · C" middle-dot meta strings; emoji as icons |
| Motion | Fade-and-slide-up on every section; hover effects on every card |
| Copy | "Elevate," "seamless," "your trusted partner," headlines that could belong to any business; generic "Submit" buttons |

The motion and layout rows come from Anthropic's own frontend-design skill, which now lists AI-design clusters such as "the SaaS-card kit: content chopped into identical rounded cards, one border-radius on everything regardless of hierarchy, the same soft grey shadow (rgba(0,0,0,.1)) under each." It also warns that "fade-and-slide-up entrances on each section and hover transitions on every card are the generic default and read as AI-generated." It specifically flags the terracotta accent near #D97757 as "Anthropic's own Claude-interaction accent, so on a user's brief it reads as a tell." **Roofing gotcha:** clay-tile terracotta is an obvious roofing color, so if you use it, make it a deliberate, photo-driven choice and never pair it with a cream background and a serif.

**Important nuance:** the skill also says these traits are "legitimate for some briefs, but they are defaults rather than choices." Nothing on the list is banned because it's ugly. It's banned because Claude reaches for it whatever the subject.

### 2. Prompting techniques that actually work (Anthropic's guidance)

**a) Use Anthropic's three strategies.** The official "Prompting for frontend aesthetics" cookbook (Prithvi Rajasekaran, Oct 21, 2025) lists three: "Guide specific design dimensions" (typography, color, motion, backgrounds), "Reference design inspirations" ("without being overly prescriptive"), and "Call out common defaults."

**b) Prompt at the "right altitude."** Anthropic says to avoid two extremes: hard-coded, low-level instructions "like specifying exact hex codes" and "vague high-altitude guidance that assumes shared context." Describe the *feel* and the *constraints* (for example, "high-contrast type, 3x+ size jumps, 800/900 vs 200 weights"), then let Claude pick the hex values and propose them back to you.

**c) Push typography hard; it improves everything else too.** Anthropic's typography prompt: "Use extremes: 100/200 weight vs 800/900, not 400 vs 600. Size jumps of 3x+, not 1.5x. Pick one distinctive font, use it decisively. Load from Google Fonts." Anthropic noticed that "the mandate to use more interesting fonts seems to encourage the model to improve other aspects of the design as well."

**d) Make it plan before coding, then critique the plan.** The current frontend-design skill tells Claude to work in two passes. First, create "a compact token system with color, type, layout, and principles" (4–6 named hex colors, typefaces with roles, ASCII wireframes). Then "review that plan against the brief before building: if any part of it reads like the generic default you would produce for any similar page… revise that part." Copy this into your own prompts.

**e) Spend the boldness in one place.** The skill's wording: "Let one element be the memorable thing, keep everything around it quiet and disciplined." It adds: "A single orchestrated moment — one page-load sequence or one reveal — lands better than scattered effects." Anthropic's 2025 aesthetics prompt says the same: "one well-orchestrated page load with staggered reveals… creates more delight than scattered micro-interactions."

**f) Give it explicit permission to go big.** Anthropic's general prompting guide recommends lines like "Don't hold back. Give it your all." and "Include as many relevant features and interactions as possible."

**g) Give it a visual target, and make it look at its own output.** Claude Code's official best practices swap *"make the dashboard look better"* for *"[paste screenshot] implement this design. take a screenshot of the result and compare it to the original. list differences and fix them."* The same docs say: "Give Claude a check it can run: tests, a build, a screenshot to compare." The skill says: "Critique your own work as you build, taking screenshots… a picture is worth 1000 tokens."

**h) Iterate on the ban list.** Anthropic's Opus 5.5 guide says: "Work iteratively: check which styles the first result used instead, and extend the list if needed." Expect round one to fall into a *different* default. Name that one too and rerun.

**i) Turn effort up for design work.** Opus 5.5 defaults to "medium" effort. On threejseval, a blind-vote 3D benchmark, Opus 5.5 at high effort ranked first and at the default medium ranked fourth (reported by Muzli). Max effort can run long and expensive for no gain. Use high for the main build.

**j) Keep CLAUDE.md short; put design rules in a skill.** Anthropic warns that "Bloated CLAUDE.md files cause Claude to ignore your actual instructions!" and suggests using skills for domain knowledge that's only sometimes relevant.

### 3. What the "beautiful smooth websites" in viral videos actually use

**The typical TikTok/YouTube stack (2026):** viral posts keep describing the same recipe: "Claude Code → Motion for React → UI UX Pro Max skill → 21st.dev MCP." 21st.dev is a community marketplace of React + Tailwind components built on shadcn/ui and Radix. Its MCP server lets Claude Code search for and install components. Treat creator claims like "a $10,000 website with just a line of code" as marketing. Every serious write-up describes iteration. Charlie Hills, who built 16 motion graphics with Opus 5.5, admitted "it wasn't one prompt. I needed the exact states, a good reference and a few rounds of fixes."

**What Claude handles well:**

| Tool/library | What it does | Claude fit | Use for a $500 roofer site? |
|---|---|---|---|
| **Anthropic frontend-design skill** | Loads anti-slop design rules automatically | Native | **Yes, always** |
| **GSAP + ScrollTrigger** | Scroll-linked animation, pinning, text splits | Excellent; free incl. all plugins and commercial use per GSAP's official 3.13 release post (Apr 2025) | Yes, for one hero moment |
| **Lenis** | Momentum "smooth scroll" | Excellent; sync with GSAP's ticker | Optional; disable for reduced-motion |
| **Motion (Framer Motion)** | React animation | Excellent; Anthropic's prompt says "Use Motion library for React when available" | Only if you build in React |
| **Tailwind + shadcn/ui** | Styling + components | Excellent; Anthropic's web-artifacts-builder skill uses React, Tailwind and shadcn/ui | Fine, but the source of "template look" if left unstyled |
| **21st.dev / Aceternity / Magic UI** | Prebuilt flashy components | Good | Use sparingly; glassmorphism and gradient effects are their own tell |
| **Three.js / WebGL** | 3D, shaders | Strong on Opus 5.5 | **No.** Overkill and slow on phones for a roofer |
| **Claude Design** (claude.ai/design) | Visual prototyping canvas, hands off to Claude Code | Anthropic Labs research preview since Apr 17, 2026 (Pro/Max/Team/Enterprise) | Good for mocking up 2–3 directions to show the client |
| v0 / Lovable / Bolt / Framer / Webflow | Alternative builders | Not Claude-specific | Framer/Webflow if the client must self-edit |

**The best public proof of Claude's ceiling:** Muzli gave Opus 5.5 a single brief for a two-person sea-salt brand. Claude Code had the frontend-design skill installed and a browser it could screenshot. The prompt specified mood ("quiet, tidal, tactile"), "one memorable thing" (a WebGL water hero), section order, motion rules ("one orchestrated page load, then scroll-linked scenes with GSAP ScrollTrigger and Lenis. No fade-up on every section. Respect prefers-reduced-motion"), mobile, and a quality bar. Before building, it set the wordmark in eight type pairings on its own. It then ran "for about 80 minutes with nobody watching, through four rounds of screenshots and fixes." **Copy that brief's structure, not its WebGL.**

**What actually makes a site feel "expensive":** real photos of the client's own work, confident type, generous spacing, and one great motion moment. Comradeweb's 2026 roundup of top roofing sites praised galleries with "drone shots, crews actively working… No AI images in sight."

### 4. Setup (do this once)

1. **Claude Code + plugin:** `/plugin install frontend-design@claude-plugins-official`, then `/reload-plugins` (install steps per third-party guides; the plugin itself lives in Anthropic's official `claude-plugins-official` repo). Its README says "Claude automatically uses this skill for frontend work."
2. **Claude.ai app:** enable code execution in Settings › Capabilities, then turn on skills. Anthropic's web-artifacts-builder skill lets artifacts use React + Tailwind + shadcn/ui instead of one plain HTML file.
3. **Let it see the page:** give Claude Code a browser it can screenshot (Claude in Chrome or a Puppeteer/Playwright MCP), so the screenshot → fix loop runs without you.
4. **Model/effort:** Opus 5.5 for design, effort high for the main build pass.

---

## The Master Prompt Template (copy this)

Paste it into Claude Code (best) or the Claude app. Fill in the brackets. Keep the BAN LIST and PROCESS sections as they are on every job.

```
ROLE
You are the design lead at a small studio known for giving every client a visual identity that couldn't be mistaken for anyone else's. This client has rejected templated proposals before. Don't hold back — build something I'd be proud to put in my portfolio.

THE BUSINESS
- Name: [Business name]  | Trade: [e.g., roofing]
- Location & service area: [City + list of neighborhoods/cities]
- License / credentials: [license #, insurance, certifications, years in business]
- Services (each gets a real section, not a card): [list]
- What makes them different (real facts only): [e.g., family-owned since 2009, owner on every job, 10-yr workmanship warranty]
- Customers: [who they are, what they're worried about when they land here]
- Primary goal of the site: [e.g., book a free estimate]  Secondary: [call now]
- Tone of voice: [e.g., plain-spoken, confident, local; no corporate filler]

DESIGN DIRECTION
- Mood in 3 words: [e.g., sun-hardened, precise, trustworthy]
- Inspiration (feel, not copy): [2–3 reference sites, an industry/material, a cultural aesthetic]
- Typography: one distinctive display family + at most one body family, loaded from Google Fonts. Use extremes (800/900 vs 300 weight; 3x+ size jumps). State your choice and why before coding.
- Color: commit to a dominant color with one sharp accent, defined as CSS variables. Propose 4–6 named hex values derived from [the client's truck/logo/materials].
- The ONE memorable thing: [e.g., a hero where the roof line draws itself as you scroll]. Spend boldness there; keep everything else quiet and disciplined.
- Photography: use these real photos [list/paths]. Where a photo is missing, leave a clearly labeled, correctly sized placeholder — never stock or AI imagery.

BAN LIST (do not use any of these)
- Fonts: Inter, Roboto, Arial, Open Sans, Lato, Space Grotesk, system fonts
- Purple/blue gradients; gradient washes as decoration
- Cream/off-white background with serif + terracotta accent; near-black with a single acid-green accent
- Centered hero + 3 identical feature cards; same radius + same soft grey shadow on everything
- Italic or colored accent word in headlines; ALL-CAPS eyebrow labels above headings; monospace labels
- "01/02/03" numbering unless content is truly a sequence; pill-shaped buttons; "→" on every link; emoji icons
- Fade-and-slide-up on every section; hover animations on every card
- Copy clichés: "elevate," "seamless," "your trusted partner," "solutions," "Submit"

MOTION
- One orchestrated page-load sequence + [one] scroll-linked moment using GSAP + ScrollTrigger (and Lenis smooth scroll synced to GSAP's ticker, desktop only).
- Motion that responds to user actions (open, expand, confirm) is welcome.
- Respect prefers-reduced-motion (disable Lenis and scroll animations). No jank on mid-range phones.

PAGE STRUCTURE (mobile-first)
[List sections in order, e.g.: Hero w/ primary CTA → Services → Proof (before/after, reviews) → Process → Service area → FAQ → Booking → Footer with license #]

CONVERSION REQUIREMENTS
- Sticky bottom bar on mobile: "Call [number]" (tel: link) + "[Book free estimate]".
- Phone number visible above the fold on every viewport.
- Booking: embed [Jobber / Cal.com / Google appointment schedule] inline at #book; CTAs scroll there.
- Short form fallback (name, phone, address/ZIP, message) → [form endpoint].
- Trust: license # in header or footer, insurance, warranty, review stars with count, manufacturer badges if real.
- CTA labels say exactly what happens ("Book my free inspection," not "Submit").

TECH
- [Static HTML/CSS/JS or Astro] + GSAP/Lenis from CDN/npm. Semantic HTML, accessible contrast, visible keyboard focus, alt text, lazy-loaded images, LocalBusiness schema markup, unique <title>/meta description. Target Lighthouse 90+ on mobile.

PROCESS (follow in order)
1. Before any code: write a 1-page design plan — palette (named hex), type roles, layout concept with ASCII wireframes for mobile and desktop, the memorable element, motion plan.
2. Review your plan against this brief: if any part resembles the default you'd produce for any similar site, revise it and tell me what you changed. Then STOP and wait for my approval.
3. Build section by section.
4. After building, screenshot at 390px and 1440px widths. List every flaw (spacing, hierarchy, overflow, anything on the ban list) and fix it. Repeat at least twice.
5. Finish with a list of what you couldn't verify (real-device scroll feel, older phones).
```

---

## Filled-In Example: Las Vegas Roofing Company

Swap in the real details. Anything in brackets has to come from the client. Don't let Claude make up reviews, warranties or license numbers.

```
ROLE
You are the design lead at a small studio known for giving every client a visual identity that couldn't be mistaken for anyone else's. This client has rejected templated proposals before. Don't hold back.

THE BUSINESS
- Name: [Desert Ridge Roofing]  | Trade: residential + light commercial roofing
- Service area: Las Vegas, Henderson, North Las Vegas, Summerlin, [Boulder City]
- License: NV State Contractors Board License #[000000], monetary limit $[X]; licensed, bonded & insured; [X] years in business
- Services (each its own section with a real photo): tile roof repair & re-lay (concrete & clay), shingle replacement, foam (SPF) & coatings for flat roofs, roof inspections & leak repair, [storm/monsoon damage repair]
- Differentiators (real only): [owner-operated, owner inspects every roof], [X-yr workmanship warranty], [free written estimates within 48 hrs]
- Customers: Vegas homeowners, often anxious about a leak after monsoon storms or sun-cracked tiles; mostly on their phone.
- Primary goal: book a free estimate. Secondary: tap to call.
- Tone: plain-spoken, confident, local. Short sentences. No corporate filler.

DESIGN DIRECTION
- Mood: sun-hardened, precise, trustworthy — Mojave daylight, not "luxury."
- Inspiration (feel only): desert modernism; the geometry of tile courses and roof pitches; construction signage and site documentation.
- Typography: a condensed or wide-width grotesk display face with real weight, plus one highly readable body face. Propose 3 pairings, pick one, justify it.
- Color: derive from [the client's truck color/logo] + sun-bleached concrete + a single high-visibility accent for CTAs. Do NOT use cream + serif + terracotta. 4–6 named hex values as CSS variables.
- Memorable thing: a hero with a large real photo of a finished Vegas tile roof; on scroll, a thin line traces the roof pitch and resolves into the headline. Everything else quiet.
- Photos: /photos/ (before/after pairs named job-01-before.jpg / job-01-after.jpg, crew shots, drone shots). Missing photos = labeled placeholders, never stock/AI.

BAN LIST
[paste the standard ban list from the template]

MOTION
One page-load sequence; one scroll-linked roof-line moment (GSAP ScrollTrigger); before/after drag slider in the gallery; Lenis on desktop only; everything off under prefers-reduced-motion.

PAGE STRUCTURE (mobile-first)
1. Hero: headline about Vegas roofs specifically, subline with service area, CTAs "Book a free estimate" + "Call [702-xxx-xxxx]", star rating + review count, license #.
2. Services: tile / shingle / foam & coatings / inspections & leak repair — what it is, when you need it, a real photo.
3. Proof: before/after slider gallery (6–12 jobs, captioned with neighborhood + roof type + scope).
4. Reviews: 3–6 real Google reviews with names and dates + link to Google profile.
5. How it works: Book → On-site inspection → Written estimate → Install → Warranty (a real sequence, so numbering is OK here).
6. Service area: list of cities/neighborhoods + simple map.
7. FAQ: cost factors, insurance claims, how long a re-roof takes, monsoon prep, financing [if offered].
8. Book: embedded scheduler at #book + short fallback form.
9. Footer: NAP (name, address, phone), hours, license # and monetary limit, insurance note.

CONVERSION REQUIREMENTS
- Sticky mobile bar: "Call now" (tel:) + "Free estimate" (scrolls to #book).
- Phone number visible above the fold on every viewport.
- Booking: embed [Jobber request/booking form | Cal.com "Free Roof Estimate" event | Google Calendar appointment schedule] inline at #book. Booking form asks: name, phone, address, roof type, issue, photos optional.
- License # in the header or hero and in the footer (required by Nevada law on all advertising).
- CTA text says what happens: "Book my free inspection."

TECH
Static site (HTML/CSS/JS or Astro), GSAP + Lenis, LocalBusiness/RoofingContractor schema, compressed WebP images, Lighthouse 90+ mobile, deploy-ready for Cloudflare Pages.

PROCESS
[paste the standard 5-step process from the template]
```

---

## Details: Roofing-Client Specifics

### Self-serve estimate booking: which tool to use

Roofing estimates happen on site, so "booking" really means the customer picks an inspection window and sends the address and details. Pick based on what the client already uses:

| Option | Cost | Best when | Notes |
|---|---|---|---|
| **Jobber** | Core plan from $29/mo (annual), includes online booking | Client already runs jobs/quotes in Jobber | Request-form embed or hosted booking link. Requests flow straight into Jobber; WordPress/Wix plugins exist |
| **Housecall Pro** | Paid plans | Client already uses HCP | "Book online" button embed code opens booking in a modal; also hosted link + Google Business Profile booking |
| **Cal.com** | Free for 1 user, unlimited event types | No field-service software; you want custom intake questions | Free plan shows Cal.com branding; HTML/React embeds |
| **Google Calendar appointment schedule** | Free: per Google, "anyone with a personal Google Account can create one booking page" (unlimited pages and reminders need Workspace) | Simplest possible setup; owner lives in Google Calendar | Inline iframe or button embed; minimal branding control |
| Calendly | Free/paid | Familiar to clients | Fine alternative; nothing roofing-specific |

**Recommendation:** if the roofer already uses Jobber or Housecall Pro, embed theirs, because a separate calendar creates double entry. If they don't use either, start with Cal.com free (custom questions for address and roof type), or a Google appointment schedule if the owner won't touch anything new. Always keep a short fallback form and the phone button, because many roofing leads are urgent.

### What top roofing/home-service sites include

- **Click-to-call everywhere on mobile.** Resultsdigitalus's 2026 roundup calls a persistent above-the-fold click-to-call button "the single most impactful change most roofing websites can make." It pairs that with "a three-field estimate form and city-level service pages."
- **Before/after galleries of real local jobs,** organized by roof type, each with a short note on material and scope.
- **Specific service pages** (repair, replacement, tile, foam/coatings, inspections). JobNimbus notes that "Google rewards specificity."
- **Reviews, license, insurance, warranty and manufacturer badges** near the CTAs.
- **Financing and insurance-claim help,** explained in plain language if the client offers them.
- **Speed:** load in under 3 seconds on mobile; Google's "The Need for Mobile Speed" study found "53% of visits are abandoned if a mobile site takes more than three seconds to load."
- **Treat vendor stats with caution:** numbers like "before-and-after photos boost conversions by 83%" or "click-to-call converts 30–45% better" come from marketing agencies with no published methodology. The direction is consistent across sources; the exact numbers aren't proven.

### Nevada legal must-have

The Nevada State Contractors Board's guidance says: "Make sure your license number is on all business advertisements, including vehicles, business cards, letterhead, signage, directories, newspapers, website, etc." (NRS 624.720). The statute says "All advertising by a licensed contractor must include the name of the contractor's company and the number of the contractor's license." Under NRS 624.710, the Board can impose a fine of "not less than $1,000 and not more than $50,000" for each advertising violation. Verify the number on the NSCB license search before launch. Showing it prominently also works as a trust signal.

---

## Recommendations: Iteration Workflow (Brief → Launch)

1. **Intake (30 min with client):** services, service area, license #, real differentiators, logo/truck colors, 20+ real job photos (ask for before/after pairs and drone shots), Google review link, booking tool they use.
2. **Moodboard (15 min):** collect 3 reference sites and screenshots (other trades, architecture firms, signage). Note *why* each works.
3. **Directions:** in Claude Design or Claude Code, ask for **3 distinct directions** as hero-only mockups. Send screenshots to the client, who picks one. This is your best defense against "it all looks the same," and it makes $500 feel custom.
4. **Plan gate:** run the master prompt. Claude writes the design plan, critiques it, and stops. You approve or edit (Ctrl+G opens the plan in your editor in Claude Code plan mode).
5. **Build section by section,** at high effort with the frontend-design skill on.
6. **Screenshot loop:** have Claude screenshot at 390px and 1440px, list its own flaws, and fix them at least twice. Then *you* look on a real phone. Whatever default it fell into, add it to the ban list and rerun that section.
7. **Conversion QA:** tap the call button, finish a test booking, submit the fallback form, check the license # is visible, run Lighthouse on mobile.
8. **Lock it in:** save the final palette/type/spacing as a short `DESIGN.md` or a custom skill. The next trade client starts from your system, not Claude's defaults.

### Hosting and deployment basics (solo freelancer)

- **Use Cloudflare Pages or Netlify (free tiers allow commercial use).** Vercel's Fair Use Guidelines say "Hobby teams are restricted to non-commercial personal use only," and list "Receiving payment to create, update, or host the site" as commercial use. A client site you were paid to build needs Vercel Pro ($20/month).
- **Flow:** GitHub repo → connect to Cloudflare Pages → buy the domain in the *client's* name (or transfer it at handoff) → point DNS → HTTPS is automatic.
- **Forms:** static hosts need a form backend (Formspree, Web3Forms or Netlify Forms are common choices). Booking runs through the embed.
- **Google Business Profile:** link the site and the booking URL. Housecall Pro can also embed booking directly in the profile.
- **Business note:** $500 is cheap for this scope. Consider $500 build + a monthly fee for hosting, updates and photo/review refreshes. The screenshot-loop workflow makes this quality repeatable, so charge for it.

---

## Caveats

- **The frontend-design skill text changes.** Anthropic updated it in September 2026, and different copies circulate. The quoted "SaaS-card kit" and five-cluster list come from the newer version (seen via GitHub snippets and a mirror). An older 55-line version lists only three looks. The install command comes from third-party guides; check `/plugin` in your Claude Code version.
- **Model claims are early.** Opus 5.5 launched Sept 22, 2026. Most quality evidence (Muzli, Every, threejseval) comes from testers and media, not controlled studies. Every found it "better at looking right than at being right about your brand," so always supply the client's real colors, logo and facts.
- **Smooth scroll isn't automatically good.** Lenis can feel floaty on phones and cause accessibility problems. Keep it desktop-only, honor reduced-motion, and never let animation delay the phone number.
- **Don't let Claude invent trust signals.** Fake reviews, warranties or license numbers are a legal and reputational risk, and in Nevada an invalid license number in an ad is specifically unlawful.
- **Pricing figures** (Jobber, Cal.com, Vercel) come from 2026 third-party reviews and can change. Confirm on vendor sites before quoting a client.
