import {
  extractGoogleImgResUrl,
  extractImageUrlFromHtml,
  isDirectImageUrl,
  resolveProductImageUrl,
} from './image-url.resolver';

describe('image-url.resolver', () => {
  describe('extractGoogleImgResUrl', () => {
    it('extracts imgurl from Google Images wrapper links', () => {
      const googleUrl =
        'https://www.google.com/imgres?q=rolex&imgurl=https%3A%2F%2Fcdn.shopify.com%2Ffiles%2Fwatch.jpg';

      expect(extractGoogleImgResUrl(googleUrl)).toBe(
        'https://cdn.shopify.com/files/watch.jpg',
      );
    });

    it('returns null for non-Google URLs', () => {
      expect(extractGoogleImgResUrl('https://example.com/image.jpg')).toBeNull();
    });
  });

  describe('isDirectImageUrl', () => {
    it('detects common image file extensions', () => {
      expect(isDirectImageUrl('https://example.com/photo.jpg')).toBe(true);
      expect(isDirectImageUrl('https://example.com/photo.webp')).toBe(true);
    });

    it('detects CDN-style paths without extensions', () => {
      expect(
        isDirectImageUrl('https://cdn.shopify.com/s/files/1/0278/product'),
      ).toBe(true);
    });

    it('returns false for product page URLs', () => {
      expect(
        isDirectImageUrl(
          'https://thewebster.com/shop/medusa-logo-t-shirt-black.html',
        ),
      ).toBe(false);
    });
  });

  describe('extractImageUrlFromHtml', () => {
    it('extracts og:image from HTML', () => {
      const html = `
        <html>
          <head>
            <meta property="og:image" content="https://cdn.example.com/product.jpg" />
          </head>
        </html>
      `;

      expect(extractImageUrlFromHtml(html, 'https://shop.example.com/item')).toBe(
        'https://cdn.example.com/product.jpg',
      );
    });

    it('resolves relative og:image URLs against the page URL', () => {
      const html =
        '<meta property="og:image" content="/media/product-main.jpg" />';

      expect(
        extractImageUrlFromHtml(html, 'https://shop.example.com/items/shirt'),
      ).toBe('https://shop.example.com/media/product-main.jpg');
    });
  });

  describe('resolveProductImageUrl', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('returns local asset paths unchanged', async () => {
      await expect(
        resolveProductImageUrl('assets/images/perfume.jpeg'),
      ).resolves.toBe('assets/images/perfume.jpeg');
    });

    it('returns direct image URLs unchanged', async () => {
      const direct = 'https://cdn.example.com/product.png';
      await expect(resolveProductImageUrl(direct)).resolves.toBe(direct);
    });

    it('resolves Google wrapper links to the direct image URL', async () => {
      const googleUrl =
        'https://www.google.com/imgres?imgurl=https%3A%2F%2Fcdn.example.com%2Fwatch.jpg';
      await expect(resolveProductImageUrl(googleUrl)).resolves.toBe(
        'https://cdn.example.com/watch.jpg',
      );
    });

    it('upgrades http image URLs to https', async () => {
      await expect(
        resolveProductImageUrl('http://cdn.example.com/product.jpg'),
      ).resolves.toBe('https://cdn.example.com/product.jpg');
    });

    it('decodes HTML entities in fetched og:image URLs', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        url: 'https://shop.example.com/product',
        headers: {
          get: () => 'text/html; charset=utf-8',
        },
        text: async () =>
          '<meta property="og:image" content="https://cdn.example.com/product.jpg?width=265&amp;height=265" />',
      }) as typeof fetch;

      await expect(
        resolveProductImageUrl('https://shop.example.com/product'),
      ).resolves.toBe('https://cdn.example.com/product.jpg?width=265&height=265');
    });

    it('fetches product pages and stores og:image URL', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        url: 'https://thewebster.com/shop/medusa-logo-t-shirt-black.html',
        headers: {
          get: () => 'text/html; charset=utf-8',
        },
        text: async () =>
          '<meta property="og:image" content="https://cdn.example.com/medusa-shirt.jpg" />',
      }) as typeof fetch;

      await expect(
        resolveProductImageUrl(
          'https://thewebster.com/shop/medusa-logo-t-shirt-black.html',
        ),
      ).resolves.toBe('https://cdn.example.com/medusa-shirt.jpg');
    });

    it('falls back to the original URL when page resolution fails', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network error'));

      const pageUrl = 'https://shop.example.com/product/123';
      await expect(resolveProductImageUrl(pageUrl)).resolves.toBe(pageUrl);
    });
  });
});
