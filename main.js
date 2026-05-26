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

function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
}

function testAny(text, patterns) {
    return patterns.some((rx) => rx.test(text));
}

function classifySignals(url, title, text) {
    const haystack = `${url} ${title} ${text}`;

    const hasAccountAccess = testAny(haystack, [
        /account/i,
        /sign[\s-]?in/i,
        /log[\s-]?in/i,
        /login/i,
        /sign[\s-]?up/i,
        /create account/i,
        /create your account/i,
        /register/i,
    ]);

    const hasRewardsProgram = testAny(haystack, [
        /rewards?/i,
        /loyalty/i,
        /membership/i,
        /member benefits/i,
        /member pricing/i,
        /points?/i,
        /vip/i,
    ]);

    const hasExclusiveMemberOffers = testAny(haystack, [
        /exclusive/i,
        /member-only/i,
        /members only/i,
        /loyalty pricing/i,
        /redeemable points/i,
        /earn points/i,
        /free shipping/i,
        /monthly freebies/i,
        /special discount/i,
        /save with membership/i,
    ]);

    const hasPublicDeals = testAny(haystack, [
        /deal|deals/i,
        /offer|offers/i,
        /coupon|coupons/i,
        /promo|promotion/i,
        /sale|sales/i,
        /weekly ad/i,
    ]);

    let retailerCategory = 'needs-review';

    if (hasAccountAccess && hasRewardsProgram && hasExclusiveMemberOffers) {
        retailerCategory = 'qualified-loyalty-retailer';
    } else if (hasAccountAccess && !hasRewardsProgram) {
        retailerCategory = 'account-only-retailer';
    } else if (hasPublicDeals && !hasRewardsProgram) {
        retailerCategory = 'sales-only-retailer';
    }

    return {
        hasAccountAccess,
        hasRewardsProgram,
        hasExclusiveMemberOffers,
        hasPublicDeals,
        retailerCategory,
    };
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

        const signals = classifySignals(url, title, bodyText);

        if (
            signals.hasAccountAccess ||
            signals.hasRewardsProgram ||
            signals.hasExclusiveMemberOffers ||
            signals.hasPublicDeals
        ) {
            await Actor.pushData({
                url,
                title,
                sourceUrl: request.userData.sourceUrl,
                depth,
                hasAccountAccess: signals.hasAccountAccess,
                hasRewardsProgram: signals.hasRewardsProgram,
                hasExclusiveMemberOffers: signals.hasExclusiveMemberOffers,
                hasPublicDeals: signals.hasPublicDeals,
                retailerCategory: signals.retailerCategory,
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
