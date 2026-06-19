const IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.svg',
  '.avif',
  '.bmp',
];

const FETCH_TIMEOUT_MS = 10_000;

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function sanitizeImageUrl(url: string): string {
  let sanitized = decodeHtmlEntities(url.trim());
  if (sanitized.startsWith('http://')) {
    sanitized = `https://${sanitized.slice('http://'.length)}`;
  }
  return sanitized;
}

export function isAllowedExternalImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;

    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('172.16.') ||
      host.endsWith('.local')
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function extractGoogleImgResUrl(url: string): string | null {
  let uri: URL;
  try {
    uri = new URL(url);
  } catch {
    return null;
  }

  const host = uri.hostname.toLowerCase();
  if (!host.includes('google.') || !uri.pathname.includes('/imgres')) {
    return null;
  }

  const directUrl = uri.searchParams.get('imgurl') ?? uri.searchParams.get('url');
  if (!directUrl?.trim()) return null;

  try {
    return decodeURIComponent(directUrl.trim());
  } catch {
    return directUrl.trim();
  }
}

export function isDirectImageUrl(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }

  if (IMAGE_EXTENSIONS.some((ext) => pathname.endsWith(ext))) {
    return true;
  }

  // Common CDN paths that serve images without a file extension in the path.
  return (
    pathname.includes('/cdn/') ||
    pathname.includes('/media/') ||
    pathname.includes('/images/') ||
    pathname.includes('/files/')
  );
}

function extractMetaContent(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

export function extractImageUrlFromHtml(html: string, pageUrl: string): string | null {
  const candidates = [
    extractMetaContent(html, [
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    ]),
    extractMetaContent(html, [
      /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
    ]),
    extractMetaContent(html, [
      /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
      /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']image_src["']/i,
    ]),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const resolved = resolveRelativeUrl(decodeHtmlEntities(candidate), pageUrl);
    if (resolved) return sanitizeImageUrl(resolved);
  }

  return null;
}

function resolveRelativeUrl(candidate: string, baseUrl: string): string | null {
  const value = candidate.trim();
  if (!value || value.startsWith('data:')) return null;

  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

async function fetchPageImageUrl(pageUrl: string): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(pageUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent':
          'Mozilla/5.0 (compatible; PrestigeCollectionBot/1.0; +https://prestigecollection.com)',
      },
      redirect: 'follow',
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.startsWith('image/')) {
    return response.url || pageUrl;
  }

  const html = await response.text();
  return extractImageUrlFromHtml(html, response.url || pageUrl);
}

export async function resolveProductImageUrl(raw: string): Promise<string> {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return trimmed;
  }

  const googleImage = extractGoogleImgResUrl(trimmed);
  if (googleImage) {
    return resolveProductImageUrl(googleImage);
  }

  if (isDirectImageUrl(trimmed)) {
    return sanitizeImageUrl(trimmed);
  }

  const pageImage = await fetchPageImageUrl(trimmed);
  if (pageImage) {
    return sanitizeImageUrl(pageImage);
  }

  return sanitizeImageUrl(trimmed);
}

export async function resolveProductImageUrls(
  urls: string[],
): Promise<string[]> {
  return Promise.all(urls.map((url) => resolveProductImageUrl(url)));
}
