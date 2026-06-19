/**
 * Resolve and persist product image URLs in MongoDB.
 * Run: node scripts/migrate-product-images.js
 */
const mongoose = require('mongoose');
const {
  resolveProductImageUrls,
} = require('../dist/products/image-url.resolver');

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/prestige-men';

const productSchema = new mongoose.Schema({}, { strict: false, collection: 'products' });
const Product = mongoose.model('Product', productSchema);

function collectRawImageSources(product) {
  const fromImages = Array.isArray(product.images)
    ? product.images.map((value) => String(value).trim()).filter(Boolean)
    : [];

  if (fromImages.length > 0) {
    return fromImages;
  }

  if (product.image) {
    return [String(product.image).trim()];
  }

  return [];
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  const products = await Product.find().lean();
  let updated = 0;

  for (const product of products) {
    const rawImages = collectRawImageSources(product);
    if (rawImages.length === 0) continue;

    const resolvedImages = await resolveProductImageUrls(rawImages);
    const hasChanges = resolvedImages.some(
      (resolved, index) => resolved !== rawImages[index],
    );

    if (!hasChanges) continue;

    await Product.updateOne(
      { _id: product._id },
      { $set: { image: resolvedImages[0], images: resolvedImages } },
    );
    updated += 1;
    console.log(`Updated: ${product.name || product.itemName}`);
    console.log(`  from: ${rawImages[0]}`);
    console.log(`  to:   ${resolvedImages[0]}`);
  }

  console.log(`Done. Updated ${updated}/${products.length} products.`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
