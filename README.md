# Merchant Key Page Finder

Merchant Key Page Finder crawls merchant websites and finds pages related to rewards, loyalty, gift cards, coupons, offers, login, account access, and mobile apps.

It is designed as a starter Apify Actor for discovering high-value merchant pages and saving matching results into an Apify dataset.

## What it does

- Accepts one or more merchant website URLs
- Crawls pages on the same domain
- Looks for pages related to rewards, loyalty, gift cards, offers, coupons, accounts, login, and apps
- Assigns a simple score based on keyword matches
- Saves matching pages to the dataset

## Input

Example input:

```json
{
  "startUrls": [
    "https://www.example.com"
  ],
  "maxPages": 25,
  "maxDepth": 2,
  "sameDomainOnly": true
}
```

### Input fields

- `startUrls`: One or more merchant URLs to scan
- `maxPages`: Maximum pages to crawl per website
- `maxDepth`: Maximum crawl depth from each start URL
- `sameDomainOnly`: Restrict crawling to the same domain

## Output

Example dataset item:

```json
{
  "url": "https://www.example.com/rewards",
  "title": "Rewards Program | Example",
  "sourceUrl": "https://www.example.com",
  "depth": 1,
  "matchedKeywords": [
    "reward",
    "loyalty"
  ],
  "score": 40,
  "evidence": "Join our rewards program and earn points on every purchase..."
}
```

## Notes

This is an initial working version focused on fast setup and testing. The current scoring logic is keyword-based and can be expanded later with better page classification, link scoring, path heuristics, structured extraction, and merchant-specific rules.

## Development

Main files in this repository:

- `.actor/actor.json`
- `.actor/Dockerfile`
- `INPUT_SCHEMA.json`
- `package.json`
- `src/main.js`

## Usage

1. Connect this repository to Apify as a Git repository source
2. Build the Actor
3. Open the input form in Apify
4. Enter one or more merchant URLs
5. Run the Actor and review results in the dataset
