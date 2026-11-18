import { BadRequestException } from "@nestjs/common";
import { Resolver } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { load } from "cheerio";

const blocked = new BlockList();
const reserved: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
for (const [address, bits] of reserved) blocked.addSubnet(address, bits);
blocked.addAddress("168.63.129.16");
const maxPageBytes = 512 * 1024;

export function parseWebsite(value: string): URL {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new BadRequestException("Enter a valid business website.");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port
    || !url.hostname.includes(".") || url.hostname.endsWith(".local")) {
    throw new BadRequestException("Use a public business website.");
  }
  url.hash = "";
  if (url.href.length > 320) throw new BadRequestException("Use a shorter business website URL.");
  return url;
}

async function publicAddress(url: URL): Promise<string> {
  const hostname = url.hostname;
  const resolver = new Resolver({ timeout: 1700, tries: 1 });
  const addresses = isIP(hostname) === 4 ? [hostname] : await resolver.resolve4(hostname);
  if (!addresses.length || addresses.some((address) => blocked.check(address))) {
    throw new BadRequestException("Use a public business website.");
  }
  return addresses[0];
}

async function readPage(
  url: URL, ip: string, signal: AbortSignal,
): Promise<{ html: Buffer } | { location: string }> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const outgoing = request(url, {
      agent: false,
      family: 4,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Encoding": "identity",
        "User-Agent": "AIReceptionist/1.0",
      },
      lookup: (_hostname, _options, callback) => callback(null, ip, 4),
      signal,
    }, async (response) => {
      try {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.destroy();
          resolve({ location: response.headers.location });
          return;
        }
        const contentType = response.headers["content-type"] ?? "";
        if (status < 200 || status >= 300 || !/^(text\/html|application\/xhtml\+xml)\b/i.test(contentType)
          || (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity")) {
          response.destroy();
          throw new BadRequestException("This site did not return a readable web page.");
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of response) {
          const bytes: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > maxPageBytes) throw new BadRequestException("This web page is too large to import.");
          chunks.push(bytes);
        }
        resolve({ html: Buffer.concat(chunks) });
      } catch (error) {
        response.destroy();
        reject(error);
      }
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

interface WebsitePage {
  website: string;
  title: string;
  businessName: string;
  knowledge: string;
  links: { url: string; title: string }[];
}

export type TrainingProgress =
  | { stage: "reading" }
  | { stage: "finding"; domain: string; pages: string[] }
  | { stage: "extracting"; domain: string; pages: string[]; current: string }
  | { stage: "preparing"; domain: string; pages: string[] };

export interface Training {
  domain: string;
  pages: string[];
  services: string[];
  faqs: string[];
  hours: string[];
}

async function readWebsite(value: string, signal: AbortSignal): Promise<WebsitePage> {
  let url = parseWebsite(value);
  try {
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      signal.throwIfAborted();
      const result = await readPage(url, await publicAddress(url), signal);
      if ("location" in result) {
        url = parseWebsite(new URL(result.location, url).href);
        continue;
      }
      const page = load(result.html.toString("utf8"));
      const title = page("title").first().text().trim().slice(0, 120);
      const businessName = (page('meta[property="og:site_name"]').attr("content") || title
        || url.hostname.replace(/^www\./, "")).trim().slice(0, 120);
      const description = page('meta[name="description"]').attr("content");
      const links: WebsitePage["links"] = [];
      const seen = new Set([url.pathname.replace(/\/$/, "")]);
      page("a[href]").each((_index, link) => {
        try {
          const candidate = new URL(page(link).attr("href") ?? "", url);
          const path = candidate.pathname.replace(/\/$/, "");
          if (candidate.origin !== url.origin || seen.has(path) || candidate.search
            || /\.(?:pdf|jpe?g|png|zip|svg)$/i.test(path)
            || !/about|services?|faq|menu|hours|contact|special|locations?|pricing|repairs?|treatments?|cater/i.test(path)) return;
          seen.add(path);
          candidate.hash = "";
          links.push({ url: candidate.href, title: (page(link).text().replace(/\s+/g, " ").trim() || path).slice(0, 75) });
        } catch { /* Ignore malformed navigation links. */ }
      });
      page("script, style, noscript, nav, footer, header, svg, form, template, [hidden], [aria-hidden=true]").remove();
      const selected = page("main, article").first();
      const root = selected.length ? selected : page("body");
      const paragraphs = root.find("h1,h2,h3,p,li,dt,dd,address").map((_index, el) => page(el).text()).get();
      const notes = [title, description ?? "", ...(paragraphs.length ? paragraphs : [root.text()])]
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const knowledge = [...new Set(notes)].join("\n").slice(0, 4000);
      if (!knowledge) throw new BadRequestException("No readable business information was found on this page.");
      return { website: url.href, title, businessName, knowledge, links };
    }
    throw new BadRequestException("The website redirects too many times.");
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException("This website couldn’t be reached. You can enter business information manually.");
  }
}

export async function importWebsite(value: string): Promise<{ website: string; knowledge: string }> {
  const { website, knowledge } = await readWebsite(value, AbortSignal.timeout(6500));
  return { website, knowledge };
}

export async function trainWebsite(value: string, progress: (event: TrainingProgress) => void, cancelled: AbortSignal) {
  const signal = AbortSignal.any([cancelled, AbortSignal.timeout(16000)]);
  progress({ stage: "reading" });
  const home = await readWebsite(value, signal);
  const domain = new URL(home.website).hostname;
  const links = home.links.slice(0, 5);
  progress({ stage: "finding", domain, pages: ["Homepage", ...links.map((item) => item.title)] });
  const pages = ["Homepage"];
  const documents = [home.knowledge];
  const results = await Promise.allSettled(links.map(async (link) => {
    const document = await readWebsite(link.url, signal);
    if (new URL(document.website).origin !== new URL(home.website).origin) return;
    pages.push(link.title);
    documents.push(document.knowledge.slice(0, 1050));
    progress({ stage: "extracting", domain, current: link.title, pages: [...pages] });
  }));
  cancelled.throwIfAborted();
  if (results.length === 0 || pages.length === 1) {
    progress({ stage: "extracting", domain, current: "Homepage", pages });
  }
  progress({ stage: "preparing", domain, pages });
  const lines = [...new Set(documents.flatMap((document) => document.split("\n")))];
  const knowledge = [...new Set([...(documents[0].slice(0, 2400).split("\n")), ...lines.slice(0, 1), ...documents.slice(1)])]
    .join("\n").slice(0, 4000);
  const category = (pattern: RegExp) => lines.filter((line) => pattern.test(line)).slice(0, 5).map((line) => line.slice(0, 190));
  const training: Training = {
    domain, pages,
    services: category(/\b(service|menu|repair|treatment|catering|consultation|appointment)s?\b/i),
    faqs: category(/\?$/),
    hours: category(/hours?|\b(mon(day)?|tue(sday)?|sat(urday)?|sun(day)?|[ap]\.m\.)\b/i),
  };
  return { profile: { name: home.businessName, website: home.website, knowledge }, training };
}
