import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import TurndownService from "turndown";

const turndown = new TurndownService({ headingStyle: "atx" });

interface ScrapePayload {
  url: string;
}

interface ScrapeResponse {
  filename: string;
  markdown_content: string;
  hero_image_url: string;
}

function escapeForYaml(value: string): string {
  return value.replace(/"/g, '\\"');
}

function sanitizeSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
}

function extractPublishDate($: cheerio.CheerioAPI): string {
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

  const frontMatter = [
    "---",
    "layout: post",
    `title: "${escapeForYaml(title)}"`,
    `subtitle: "${escapeForYaml(subtitle)}"`,
    `author: "${escapeForYaml(author)}"`,
    "---",
    "",
  ].join("\n");

  const slug = sanitizeSlug(title) || "untitled";
  const filename = `${publishDate}-${slug}.md`;

  return {
    filename,
    markdown_content: frontMatter + markdownBody,
    hero_image_url: heroImageUrl,
  };
}

export default {
  port: Number(process.env.PORT ?? "3000"),
  fetch(request: Request): Promise<Response> | Response {
    const url = new URL(request.url);

    if (request.method !== "POST" || url.pathname !== "/api/v1/substack-to-md") {
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
