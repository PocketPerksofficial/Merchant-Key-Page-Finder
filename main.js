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

function isLikelyUtilityPage(url, title) {
    const haystack = `${url} ${title}`;

    return testAny(haystack, [
        /\/help\b/i,
        /\/help\//i,
        /\/returns\b/i,
        /\/orders\b/i,
        /\/store-locator\b/i,
        /contact us/i,
        /privacy policy/i,
        /accessibility/i,
        /product recalls?/i,
        /find stores/i,
        /stores near me/i,
    ]);
}

function classifySignals(url, title, text) {
    const haystack = `${url} ${title} ${text}`;
    const utilityPage = isLikelyUtilityPage(url, title);

    const hasAccountAccess = testAny(haystack, [
        /account/i,
        /sign[\s-]?in/i,
        /log[\s-]?in/i,
        /login/i,
        /sign[\s-]?up/i,
        /create account/i,
        /create your account/i,
        /register/i,
        /card management/i,
        /manage your card/i,
    ]);

    const hasRewardsProgram = testAny(haystack, [
        /rewards?/i,
        /loyalty/i,
        /target circle/i,
        /membership/i,
        /member benefits/i,
        /member pricing/i,
        /points?/i,
        /vip/i,
        /circle 360/i,
    ]);

    const hasExclusiveMemberOffers = testAny(haystack, [
        /exclusive discounts?/i,
        /member-only/i,
        /members only/i,
        /loyalty pricing/i,
        /redeemable points?/i,
        /earn points?/i,
        /free shipping/i,
        /monthly freebies/i,
        /special discount/i,
        /save with membership/i,
        /verified.*save/i,
        /discounts? for verified/i,
        /unlock exclusive discounts?/i,
        /save even more/i,
    ]);

    const hasPublicDeals = testAny(haystack, [
        /deals?/i,
        /offers?/i,
        /coupons?/i,
        /promo/i,
        /promotion/i,
        /sales?/i,
        /weekly ad/i,
        /top deals/i,
        /current promotions/i,
        /save \d+%/i,
        /up to \d+% off/i,
        /\bclearance\b/i,
        /\bdiscount\b/i,
    ]);

    let retailerCategory = 'needs-review';

    if (utilityPage && !hasExclusiveMemberOffers && !hasRewardsProgram) {
        retailerCategory = 'ignore-utility-page';
    } else if (hasRewardsProgram && (hasExclusiveMemberOffers || hasPublicDeals)) {
        retailerCategory = 'qualified-loyalty-retailer';
    } else if (hasAccountAccess && hasRewardsProgram) {
        retailerCategory = 'loyalty-retailer';
    } else if (hasAccountAccess) {
        retailerCategory = 'account-only-retailer';
    } else if (hasPublicDeals) {
        retailerCategory = 'sales-only-retailer';
    }

    return {
        hasAccountAccess,
        hasRewardsProgram,
        hasExclusiveMemberOffers,
        hasPublicDeals,
        retailerCategory,
        utilityPage,
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
            signals.retailerCategory !== 'ignore-utility-page' &&
            (
                signals.hasAccountAccess ||
                signals.hasRewardsProgram ||
                signals.hasExclusiveMemberOffers ||
                signals.hasPublicDeals
            )
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
                utilityPage: signals.utilityPage,
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
