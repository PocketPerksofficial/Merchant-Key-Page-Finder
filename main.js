import { Actor, log } from 'apify';
import { CheerioCrawler, RequestQueue } from 'crawlee';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
    startUrls = [],
    maxPages = 25,
    maxDepth = 2,
    sameDomainOnly = true,
} = input;

if (!Array.isArray(startUrls) || startUrls.length === 0) {
    throw new Error('Input must include at least one URL in startUrls.');
}

const requestQueue = await RequestQueue.open();
const startHosts = new Set();

for (const urlItem of startUrls) {
    const normalizedUrl = typeof urlItem === 'string' ? urlItem : urlItem?.url;
    if (!normalizedUrl) continue;

    const hostname = new URL(normalizedUrl).hostname;
    startHosts.add(hostname);

    await requestQueue.addRequest({
        url: normalizedUrl,
        userData: {
            depth: 0,
            sourceUrl: normalizedUrl,
        },
    });
}

const pageRules = [
    { type: 'rewards', rx: /reward|rewards|circle|loyalty/i },
    { type: 'gift-card', rx: /gift[-\s]?card|card management|reloadable card/i },
    { type: 'weekly-ad', rx: /weekly ad|weekly deal|weekly-ad/i },
    { type: 'offers', rx: /deal|deals|offer|offers|coupon|promo/i },
    { type: 'account', rx: /account|sign[\s-]?in|login|create account/i },
    { type: 'app', rx: /app|download the app|mobile app/i },
    { type: 'registry', rx: /registry|wish list/i },
];

function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
}

function classifyPage(url, title, text) {
    const haystack = `${url} ${title} ${text}`;
    const matchedTypes = pageRules
        .filter((rule) => rule.rx.test(haystack))
        .map((rule) => rule.type);

    const uniqueMatches = [...new Set(matchedTypes)];

    let score = 0;

    if (/reward|rewards|circle|loyalty/i.test(url)) score += 35;
    if (/gift[-\s]?card|card/i.test(url)) score += 30;
    if (/weekly[-/]?ad|weekly ad/i.test(url)) score += 30;
    if (/deal|deals|offer|offers|coupon|promo/i.test(url)) score += 20;
    if (/account|login|sign[\s-]?in/i.test(url)) score += 25;
    if (/app/i.test(url)) score += 10;
    if (/registry|wish/i.test(url)) score += 20;

    if (/reward|loyalty|gift card|weekly ad|deal|offer|account|login|app|registry/i.test(title)) score += 20;

    score += uniqueMatches.length * 10;

    score = Math.min(100, score);

    return {
        matchedTypes: uniqueMatches,
        score,
    };
}

function shouldKeepResult(url, title, matchedTypes, score) {
    if (matchedTypes.length === 0) return false;

    const strongUrlPattern = /reward|rewards|circle|loyalty|gift[-\s]?card|weekly[-/]?ad|deal|deals|offer|offers|coupon|promo|account|login|sign[\s-]?in|registry|wish|app/i;
    const strongTitlePattern = /reward|rewards|circle|loyalty|gift card|weekly ad|deal|deals|offer|offers|account|login|registry|wish|app/i;

    return score >= 35 || strongUrlPattern.test(url) || strongTitlePattern.test(title);
}

const crawler = new CheerioCrawler({
    requestQueue,
    maxRequestsPerCrawl: maxPages,

    async requestHandler({ request, $, enqueueLinks }) {
        const depth = request.userData.depth ?? 0;
        const url = request.loadedUrl || request.url;
        const title = normalizeText($('title').first().text());
        const bodyText = normalizeText($('body').text()).slice(0, 4000);

        log.info(`Visited: ${url}`);

        const { matchedTypes, score } = classifyPage(url, title, bodyText);

        if (shouldKeepResult(url, title, matchedTypes, score)) {
            await Actor.pushData({
                url,
                title,
                sourceUrl: request.userData.sourceUrl,
                depth,
                pageType: matchedTypes[0] ?? 'generic',
                matchedKeywords: matchedTypes,
                score,
                evidence: bodyText.slice(0, 500),
            });
        }

        if (depth < maxDepth) {
            await enqueueLinks({
                strategy: 'same-domain',
                limit: 25,
                transformRequestFunction: (req) => {
                    const host = new URL(req.url).hostname;

                    if (sameDomainOnly && !startHosts.has(host)) return false;

                    req.userData = {
                        depth: depth + 1,
                        sourceUrl: request.userData.sourceUrl,
                    };

                    return req;
                },
            });
        }
    },

    async failedRequestHandler({ request }) {
        log.warning(`Request failed too many times: ${request.url}`);
    },
});

await crawler.run();
await Actor.exit();
