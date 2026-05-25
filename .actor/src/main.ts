import { Actor, log } from 'apify';
import { CheerioCrawler, RequestQueue } from 'crawlee';

await Actor.init();

const input = await Actor.getInput() ?? {};
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

for (const url of startUrls) {
    const normalizedUrl = typeof url === 'string' ? url : url?.url;
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

const keywordPatterns = [
    /reward/i,
    /loyalty/i,
    /gift[-\s]?card/i,
    /coupon/i,
    /offer/i,
    /deal/i,
    /promo/i,
    /account/i,
    /login/i,
    /sign[\s-]?in/i,
    /app/i,
];

const crawler = new CheerioCrawler({
    requestQueue,
    maxRequestsPerCrawl: maxPages,

    async requestHandler({ request, $, enqueueLinks }) {
        const depth = request.userData.depth ?? 0;
        const url = request.loadedUrl || request.url;
        const title = $('title').first().text().trim();

        const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3000);
        const matchedKeywords = keywordPatterns
            .filter((pattern) => pattern.test(`${url} ${title} ${bodyText}`))
            .map((pattern) => pattern.source);

        if (matchedKeywords.length > 0) {
            const score = Math.min(100, matchedKeywords.length * 20);

            await Actor.pushData({
                url,
                title,
                sourceUrl: request.userData.sourceUrl,
                depth,
                matchedKeywords,
                score,
                evidence: bodyText.slice(0, 500),
            });
        }

        if (depth < maxDepth) {
            await enqueueLinks({
                strategy: 'same-domain',
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
