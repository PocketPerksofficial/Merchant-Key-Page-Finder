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

function getUrlParts(rawUrl) {
    try {
        const u = new URL(rawUrl);
        return {
            href: u.href,
            pathname: (u.pathname || '').toLowerCase(),
            search: (u.search || '').toLowerCase(),
            hostname: (u.hostname || '').toLowerCase(),
        };
    } catch {
        return {
            href: rawUrl || '',
            pathname: '',
            search: '',
            hostname: '',
        };
    }
}

function isLikelyUtilityPage(url, title) {
    const { pathname } = getUrlParts(url);
    const titleText = (title || '').toLowerCase();

    const utilityPathPatterns = [
        /\/help(\/|$)/i,
        /\/support(\/|$)/i,
        /\/contact(\/|$)/i,
        /\/contact-us(\/|$)/i,
        /\/customer-service(\/|$)/i,
        /\/returns?(\/|$)/i,
        /\/refunds?(\/|$)/i,
        /\/orders?(\/|$)/i,
        /\/order-status(\/|$)/i,
        /\/track(\/|$)/i,
        /\/tracking(\/|$)/i,
        /\/shipping(\/|$)/i,
        /\/delivery(\/|$)/i,
        /\/store-locator(\/|$)/i,
        /\/store(s)?(\/|$)/i,
        /\/locations?(\/|$)/i,
        /\/privacy(\/|$)/i,
        /\/privacy-policy(\/|$)/i,
        /\/terms(\/|$)/i,
        /\/terms-and-conditions(\/|$)/i,
        /\/accessibility(\/|$)/i,
        /\/legal(\/|$)/i,
        /\/faq(s)?(\/|$)/i,
        /\/faqs(\/|$)/i,
        /\/recalls?(\/|$)/i,
    ];

    const utilityTitlePatterns = [
        /\bhelp\b/i,
        /\bsupport\b/i,
        /contact us/i,
        /customer service/i,
        /return policy/i,
        /\breturns\b/i,
        /\brefunds\b/i,
        /\border(s)?\b/i,
        /order status/i,
        /track( my)? order/i,
        /shipping/i,
        /delivery/i,
        /find stores/i,
        /store locator/i,
        /stores near me/i,
        /privacy policy/i,
        /\bprivacy\b/i,
        /\bterms\b/i,
        /accessibility/i,
        /\blegal\b/i,
        /\bfaq\b/i,
        /\bfaqs\b/i,
        /product recalls?/i,
    ];

    return testAny(pathname, utilityPathPatterns) || testAny(titleText, utilityTitlePatterns);
}

function hasStrongUtilityOverride(url, title, text) {
    const haystack = `${url} ${title} ${text}`;

    return testAny(haystack, [
        /join (free|now)/i,
        /sign[\s-]?in or create account/i,
        /create account/i,
        /member-only/i,
        /members only/i,
        /exclusive discounts?/i,
        /unlock exclusive discounts?/i,
        /earn points?/i,
        /redeemable points?/i,
        /save with membership/i,
        /loyalty program/i,
        /rewards program/i,
        /free shipping/i,
        /monthly freebies/i,
        /special member pricing/i,
        /special membership discount/i,
        /verified.*save/i,
        /discounts? for verified/i,
        /join.*rewards/i,
        /join.*membership/i,
    ]);
}

function classifySignals(url, title, text) {
    const haystack = `${url} ${title} ${text}`;
    const { pathname, search } = getUrlParts(url);
    const utilityPage = isLikelyUtilityPage(url, title);
    const strongUtilityOverride = hasStrongUtilityOverride(url, title, text);

    const hasAccountAccess = testAny(haystack, [
        /account/i,
        /sign[\s-]?in/i,
        /log[\s-]?in/i,
        /login/i,
        /sign[\s-]?up/i,
        /create account/i,
        /create your account/i,
        /register/i,
        /my account/i,
        /card management/i,
        /manage your card/i,
    ]);

    const hasRewardsProgram = testAny(haystack, [
        /rewards?/i,
        /loyalty/i,
        /membership/i,
        /member benefits/i,
        /member pricing/i,
        /points?/i,
        /vip/i,
        /rewards club/i,
        /loyalty program/i,
        /rewards program/i,
        /member perks/i,
        /cash back/i,
        /club\b/i,
        /circle\b/i,
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
        /member pricing/i,
        /member deals/i,
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
        /\bspecial offer\b/i,
    ]);

    const urlLooksLikePromoPage = testAny(`${pathname} ${search} ${title}`, [
        /deal/i,
        /offer/i,
        /coupon/i,
        /promo/i,
        /sale/i,
        /clearance/i,
        /rewards?/i,
        /loyalty/i,
        /membership/i,
        /member/i,
        /vip/i,
        /club/i,
        /circle/i,
        /perks/i,
    ]);

    let retailerCategory = 'needs-review';

    if (utilityPage && !strongUtilityOverride && !urlLooksLikePromoPage) {
        retailerCategory = 'ignore-utility-page';
    } else if (hasRewardsProgram && (hasExclusiveMemberOffers || hasPublicDeals)) {
        retailerCategory = 'qualified-loyalty-retailer';
    } else if (hasAccountAccess && hasRewardsProgram) {
        retailerCategory = 'loyalty-retailer';
    } else if (hasPublicDeals && !utilityPage) {
        retailerCategory = 'sales-only-retailer';
    } else if (hasAccountAccess && !utilityPage) {
        retailerCategory = 'account-only-retailer';
    }

    return {
        hasAccountAccess,
        hasRewardsProgram,
        hasExclusiveMemberOffers,
        hasPublicDeals,
        retailerCategory,
        utilityPage,
        strongUtilityOverride,
        urlLooksLikePromoPage,
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

        if (signals.retailerCategory !== 'ignore-utility-page') {
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
                strongUtilityOverride: signals.strongUtilityOverride,
                urlLooksLikePromoPage: signals.urlLooksLikePromoPage,
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
