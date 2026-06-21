import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import TurndownService from "turndown";

const turndown = new TurndownService({ headingStyle: "atx" });
const API_TOKEN = process.env.API_TOKEN;

function isAuthorized(request: Request): boolean {
  return request.headers.get("Authorization") === `Bearer ${API_TOKEN}`;
}

interface ScrapePayload {
  url: string;
}

interface ScrapeResponse {
  url: string;
  title: string;
  subtitle: string;
  author: string;
  publish_date: string;
  hero_image_url: string;
  body_html: string;
  body_markdown: string;
}

function extractPublishDate($: cheerio.CheerioAPI): string {
  const structuredData = $('script[type="application/ld+json"]').first().html();
  if (structuredData) {
    try {
      const parsed = JSON.parse(structuredData) as Record<string, unknown>;
      const datePublished = parsed.datePublished as string | undefined;
      if (datePublished) {
        const parsedDate = new Date(datePublished);
        if (!Number.isNaN(parsedDate.getTime())) {
          return parsedDate.toISOString().slice(0, 10);
        }
      }
    } catch {
      // fall through to remaining selectors
    }
  }

  const selectors = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    "time[datetime]",
  ];

  for (const selector of selectors) {
    const value = $(selector).first().attr("datetime") ?? $(selector).first().attr("content");
    if (value) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
    }
  }

  return new Date().toISOString().slice(0, 10);
}

function extractTitle($: cheerio.CheerioAPI): string {
  return $("h1.post-title").first().text().trim();
}

function extractSubtitle($: cheerio.CheerioAPI): string {
  return $('h3.subtitle').first().text().trim();
}

function extractAuthor($: cheerio.CheerioAPI): string {
  return (
    $('meta[name="author"]').first().attr("content") ??
    $(".post-author").first().text().trim() ??
    $("a.navbar-title").first().text().trim() ??
    ""
  );
}

function extractHeroImageUrl($: cheerio.CheerioAPI): string {
  return (
    $('meta[property="og:image"]').first().attr("content") ??
    $('meta[name="twitter:image"]').first().attr("content") ??
    ""
  );
}

function firstExisting($root: cheerio.CheerioAPI, selectors: string[]): cheerio.Cheerio<AnyNode> {
  for (const selector of selectors) {
    const el = $root(selector).first();
    if (el.length > 0) {
      return el;
    }
  }
  return $root("body");
}

function extractBodyHtml($: cheerio.CheerioAPI): string {
  const container = firstExisting($, [
    ".available-content",
    "article",
    ".post-content",
  ]);

  const html = container.html() ?? "";
  const $body = cheerio.load(html, null, false);

  $body(
    "script, style, iframe, noscript, .subscription-widget, .subscribe-section, .paywall, " +
      ".post-footer, .comments, .comment-section, .post-aux, .like-button, .comment-button, " +
      '[data-component-name="PostFooter"], [data-component-name="SubscriptionWidget"]'
  ).remove();

  return $body.html() ?? "";
}

async function scrape(url: string): Promise<ScrapeResponse> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; SubstackScraper/1.0)",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const title = extractTitle($);
  const subtitle = extractSubtitle($);
  const author = extractAuthor($);
  const publishDate = extractPublishDate($);
  const heroImageUrl = extractHeroImageUrl($);
  const bodyHtml = extractBodyHtml($);
  const markdownBody = turndown.turndown(bodyHtml).trim();

  return {
    url,
    title,
    subtitle,
    author,
    publish_date: publishDate,
    hero_image_url: heroImageUrl,
    body_html: bodyHtml,
    body_markdown: markdownBody,
  };
}

export default {
  port: Number(process.env.PORT ?? "3000"),
  fetch(request: Request): Promise<Response> | Response {
    const url = new URL(request.url);

    if (!isAuthorized(request)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method !== "POST" || url.pathname !== "/v1/scrape/substack-post") {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return (async () => {
      let payload: ScrapePayload;
      try {
        payload = (await request.json()) as ScrapePayload;
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!payload.url || typeof payload.url !== "string") {
        return new Response(JSON.stringify({ error: "Missing or invalid url" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const result = await scrape(payload.url);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Scrape failed";
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    })();
  },
} satisfies Bun.ServeOptions;
