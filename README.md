# ⚡ Volt Surge: Enhanced Edition

Welcome to **Volt Surge: Enhanced Edition**, a complete overhaul of the original browser‑based battle‑royale.  This repo takes the core electric‑trail mechanic from the original **Volt Surge** and expands it into a production‑ready web game with modern architecture, scalable modules, SEO, mobile friendliness and monetization built in.

## What’s Inside?

This repository contains a fully refactored codebase that separates concerns, introduces robust multiplayer and bot logic, and includes room for monetization without disrupting gameplay.  Every file lives under the `src/` directory and is designed to be easily maintained and extended.

```
voltage-enhanced/
├── public/               # Static assets served as-is
│   ├── manifest.json     # PWA manifest
│   └── images/           # Icons and share images
├── src/
│   ├── index.html        # Main HTML entry (imports JS modules)
│   ├── styles.css        # Centralised styles & responsive design
│   ├── game.js           # Core game logic (canvas, physics, players)
│   ├── ai.js             # Bot heuristics and human‑like behaviour
│   ├── network.js        # Firebase/networking wrappers
│   ├── chat.js           # In‑game chat and voice (WebRTC)
│   ├── ads.js            # Monetisation stub (ads only on menus)
│   └── util.js           # Shared utilities (e.g. random, collision)
└── README.md             # This file
```

The original single‑file implementation (`index.html`) has been decomposed into ES modules.  This separation makes it dramatically easier to optimise, debug and extend the game.  It also allows modern bundlers or CDNs to tree‑shake unused code.

## Key Enhancements

- **Mobile‑First Responsive UI:** Styles live in `styles.css` and include responsive breakpoints for both portrait and landscape modes.  Touch controls (joystick and buttons) scale automatically based on device resolution.  A light weight CSS reset eliminates the previous inconsistent spacing issues on Android browsers.
- **SEO & Social:** The `<head>` of the main HTML file contains an extensive set of meta tags, OpenGraph/Twitter cards, JSON‑LD `VideoGame` schema and an FAQ schema.  These greatly improve discoverability in search engines without affecting gameplay performance.
- **Progressive Web App:** Included is a minimal `manifest.json` and the plumbing to register a service worker.  Players can install Volt Surge on their homescreen and play offline once assets are cached.
- **Bots That Feel Human:** The new `ai.js` module exposes a `Bot` class with steering behaviours such as seeking, fleeing and wall‑hugging.  Bots sample the canvas in multiple directions to approximate human reaction times.  They will occasionally make mistakes to keep things fair.
- **Improved Chat & Voice:**  The `chat.js` module implements text chat on top of Firebase Realtime Database and establishes peer‑to‑peer voice calls using WebRTC.  Voice connections are initiated via simple signalling messages in Firebase.  Players can mute/unmute from the HUD.
- **Monetisation Without Distraction:**  All advertising logic resides in `ads.js`.  By default, the game hides ads during active play and only loads interstitial banners in the lobby, results screen or when the player voluntarily opts into a rewarded video (e.g. for an instant respawn).  The code is fully encapsulated, so replacing one ad provider with another is as simple as swapping script tags.
- **Quick Match & Private Rooms:**  The `network.js` module contains helpers for creating/joining public lobbies, matchmaking based on skill (MMR) and generating private invite codes.  These functions abstract the underlying Firebase API calls.
- **Strict Linting & Structure:**  The codebase uses ES6 modules and adheres to a consistent style.  You can easily plug it into any modern build pipeline (Parcel, Vite, Webpack) or deploy it directly on Vercel/Netlify.  No proprietary dependencies are required.

## Zero‑Cost Hosting & Deployment

This project is designed to run entirely on free tiers:

1. **Backend:** Uses [Firebase Realtime Database](https://firebase.google.com/) on the Spark plan (no cost) with anonymous authentication.  Simply replace `YOUR_CONFIG_HERE` in `network.js` with your Firebase config values.
2. **Frontend Hosting:** Deploy the `public/` folder to [Vercel](https://vercel.com/) or [Netlify](https://www.netlify.com/) for free.  You can also use GitHub Pages; Vercel is recommended because it handles service worker caching and rewrites seamlessly.
3. **Voice & Chat:** WebRTC operates peer‑to‑peer.  Signalling uses Firebase, so no additional servers are necessary.
4. **Ads:**  When you are ready to monetise, sign up for Google AdSense or another provider.  Insert your ad codes into `ads.js` in the designated places.  Avoid any ad integration that requires upfront fees.

## Getting Started

1. **Install dependencies (optional):**  There are no runtime dependencies because the game runs in the browser.  However, for local development you may wish to serve the `public/` directory using a tool like `http-server` or `vite`.
   ```bash
   npm install -g http-server
   http-server public
   ```

2. **Configure Firebase:**  Go to the Firebase console, create a new project, enable Anonymous Authentication and Realtime Database.  Copy your config object and paste it into `src/network.js` where indicated.

3. **Develop:**  Modify any of the modules in `src/` to tweak gameplay, design or features.  The entry point `index.html` references these modules via `<script type="module">` tags.

4. **Deploy:**  Commit this repository to GitHub.  Connect it to Vercel and set the output directory to `public`.  Vercel will detect the static site and deploy it automatically.  Alternatively, run `npm run build` if you choose to bundle the code with a build tool.

## How to Contribute

Pull requests are welcome!  Whether you want to improve the AI heuristics, add new abilities, create unique map layouts or integrate additional social features, feel free to fork and open a PR.  Please keep modules focused and maintain the existing folder structure where possible.

---

This enhanced version of Volt Surge gives players a polished, addictive experience with the infrastructure to sustain organic growth and revenue.  May your trails shine and your lightning chain far! ⚡