/*
  ads.js

  Centralised monetisation logic for Volt Surge.  Ads are deliberately
  separated from gameplay code so that the player experience is never
  interrupted while they are actively controlling their avatar.  This
  module provides helpers to insert ad containers into the DOM and to
  request rewarded videos.  Actual ad integration must be configured
  by the developer by pasting their network’s script tags and IDs.

  To add AdSense or another provider, set the `AD_CLIENT` and
  `AD_SLOT` constants below.  Banner ads are displayed only in the
  menu and results screens, while rewarded videos are shown upon
  player death or when a power pack is requested.
*/

const AD_CLIENT = 'ca-pub-XXXXXXXXXX'; // TODO: replace with your AdSense client ID
const BANNER_SLOT = '1234567890';       // TODO: replace with your AdSense slot ID

let bannerContainer;

export function init() {
  // Load Google AdSense script once
  if (!document.querySelector('script[data-adsbygoogle]')) {
    const s = document.createElement('script');
    s.async = true;
    s.setAttribute('data-adsbygoogle', 'true');
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${AD_CLIENT}`;
    s.crossOrigin = 'anonymous';
    document.head.appendChild(s);
  }
}

export function showBanner(parentEl) {
  if (bannerContainer) hideBanner();
  bannerContainer = document.createElement('ins');
  bannerContainer.className = 'adsbygoogle';
  bannerContainer.style.display = 'block';
  bannerContainer.style.width = '100%';
  bannerContainer.style.height = '90px';
  bannerContainer.setAttribute('data-ad-client', AD_CLIENT);
  bannerContainer.setAttribute('data-ad-slot', BANNER_SLOT);
  bannerContainer.setAttribute('data-ad-format', 'auto');
  parentEl.appendChild(bannerContainer);
  // Initialise ad
  (window.adsbygoogle = window.adsbygoogle || []).push({});
}

export function hideBanner() {
  if (bannerContainer && bannerContainer.parentNode) {
    bannerContainer.parentNode.removeChild(bannerContainer);
    bannerContainer = null;
  }
}

export function showRewarded(onComplete) {
  /*
    Rewarded ads incentivise players to opt‑in for extra
    content (respawn, power packs).  This stub simply
    shows a modal overlay for 5 seconds and then calls
    the callback.  Replace this with actual rewarded
    video integration by embedding the provider’s SDK.
  */
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.background = 'rgba(0,0,0,0.8)';
  overlay.style.display = 'flex';
  overlay.style.flexDirection = 'column';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = '1000';
  const msg = document.createElement('p');
  msg.style.color = '#fff';
  msg.style.fontSize = '1.2rem';
  msg.style.marginBottom = '12px';
  msg.textContent = 'Watching rewarded video...';
  overlay.appendChild(msg);
  document.body.appendChild(overlay);
  setTimeout(() => {
    document.body.removeChild(overlay);
    if (typeof onComplete === 'function') onComplete();
  }, 5000);
}