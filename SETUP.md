# Hub setup — wiring the funnel

The hub ships as a static site with clearly-marked placeholders. Nothing tracks anyone until you connect the pieces below. The free tools in the other repos stay no-tracking regardless — analytics live on this hub only.

## 1. Publish
Enable GitHub Pages on this repo (Settings → Pages → deploy from `main`). The hub goes live at `https://mpacarroll.github.io/ai-mick/`. (See the firewall note at the bottom before you decide that's the final home.)

## 2. Email provider (the funnel's core)
Pick one (buttondown or beehiiv are simple). Create a list, then in `index.html`:
- Replace `REPLACE_WITH_EMAIL_PROVIDER_ENDPOINT` in the `<form action=...>` with your provider's form endpoint.
- Most providers give an embeddable form; you can paste theirs in place of the simple one if you prefer double opt-in.

## 3. Cookieless analytics (so revenue experiments are legible)
Pick a privacy-friendly, cookieless tool (Plausible, GoatCounter, or Cloudflare Web Analytics). Paste its snippet into `<head>` where the ANALYTICS PLACEHOLDER comment is.
- The CTAs already carry `data-funnel="..."` markers. Wire these as custom events in your provider so you can watch the funnel:
  - `tool-try` → a visitor opened a tool
  - `email-signup` → joined the list
  - `work-inquiry` → clicked the build-it-for-you contact
  - `book-click` → clicked a book/product
- The funnel to watch: **tool-try → email-signup → book-click / work-inquiry.**

## 4. Money links
- `REPLACE_WITH_BOOK_LINK` → your Gumroad/Amazon link for The AI Practice Book (under the Mick brand, not a separate site).
- `REPLACE_WITH_MICK_EMAIL` → the email address for build-it-for-you inquiries.
- When you add paid "Pro" tool tiers, link them from the Tools cards (each already says "Pro soon").

## 5. Surname is a branding choice, not a payment requirement
A pen/brand surname is not a legal identity, so it does **not** gate payments. You can sell as "Mick" right now: Gumroad, KDP, and Stripe all support a public creator/brand name over a real legal account, and the legal/tax/payout layer just uses your real self behind the scenes. The public surname is locked: **Mick Cairn**. Light caveats, not blockers: your real legal name may appear on tax forms and some receipts, a *registered* pen-name business is an optional DBA/LLC filing, and confirm tax specifics with the platform or an accountant.

## Firewall note
The day job is never named anywhere — keep it that way; that is the only hard rule here. On hosting: your personal `mpacarroll` GitHub is fully separate from the employer (which has its own GitHub the personal account never touches), so hosting the hub there carries **no employer risk**. The only remaining separation is brand ↔ personal identity — purely a branding preference, not compliance. If you ever want Mick to stand fully apart from your personal handle, move the hub to a **dedicated account or a custom domain** and update the cross-repo "who's Mick?" links. Optional, do it whenever, one find-and-replace.
