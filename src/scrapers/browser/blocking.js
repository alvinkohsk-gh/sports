// Per-tab request filtering. Raising the function's memory to 3009MB
// (Vercel's practical ceiling for this runtime) on top of the concurrency
// cap still wasn't enough — confirmed via runtime logs to keep producing
// net::ERR_INSUFFICIENT_RESOURCES / "Target page, context or browser has
// been closed" failures. These are ad/tracker-heavy tipster sites (see
// fetchHtml.js / singaporePools comments), so the fix is cutting what each
// tab costs rather than raising the ceiling further: block image/media/
// font loads and known ad-serving hosts, since none of the scrapers read
// images, play media, or need ad content — they only read text/DOM
// (fetchHtml.js) or JSON XHR responses (singaporePools/render.js).
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);
const BLOCKED_HOSTNAME_PATTERNS = [
  /(^|\.)doubleclick\.net$/,
  /(^|\.)googlesyndication\.com$/,
  /(^|\.)google-analytics\.com$/,
  /(^|\.)googletagmanager\.com$/,
  /(^|\.)googletagservices\.com$/,
  /(^|\.)adservice\.google\.com$/,
  /(^|\.)facebook\.net$/,
  /(^|\.)connect\.facebook\.com$/,
  /(^|\.)amazon-adsystem\.com$/,
  /(^|\.)taboola\.com$/,
  /(^|\.)outbrain\.com$/,
  /(^|\.)criteo\.com$/,
  /(^|\.)adnxs\.com$/,
  /(^|\.)pubmatic\.com$/,
  /(^|\.)rubiconproject\.com$/,
  /(^|\.)moatads\.com$/,
  /(^|\.)scorecardresearch\.com$/,
  /(^|\.)quantserve\.com$/,
  /(^|\.)hotjar\.com$/,
];

function isBlockedHostname(hostname) {
  return BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(hostname));
}

async function blockHeavyRequests(page) {
  await page.route('**/*', (route) => {
    const request = route.request();
    if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
      return route.abort();
    }
    try {
      if (isBlockedHostname(new URL(request.url()).hostname)) {
        return route.abort();
      }
    } catch {
      // unparseable URL — let it through rather than risk blocking something needed
    }
    return route.continue();
  });
}

module.exports = { blockHeavyRequests, isBlockedHostname };
