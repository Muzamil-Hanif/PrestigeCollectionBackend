import {
  BadRequestException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { Product, ProductDocument } from './schemas/product.schema';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  isAllowedExternalImageUrl,
  resolveProductImageUrl,
  resolveProductImageUrls,
} from './image-url.resolver';

const CATEGORY_LABELS: Record<number, string> = {
  0: 'All Items',
  1: 'Perfumes',
  2: 'Watches',
  3: 'Wallets',
  4: 'Shirts',
};

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
  ) {}

  async create(createProductDto: CreateProductDto): Promise<any> {
    const product = new this.productModel(
      await this.normalizeProductPayload(createProductDto),
    );
    const savedProduct = await product.save();
    return this.formatProductResponse(savedProduct);
  }

  async findAll(query?: {
    category?: string;
    search?: string;
    minPrice?: string;
    maxPrice?: string;
    page?: string;
    limit?: string;
  }): Promise<{
    products: any[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Number(query?.page) > 0 ? Number(query?.page) : 1;
    const limit = Number(query?.limit) > 0 ? Number(query?.limit) : 20;
    const skip = (page - 1) * limit;

    const filter: any = { isAvailable: true };

    if (query?.category) {
      const parsedCategory = Number(query.category);
      if (!Number.isNaN(parsedCategory) && parsedCategory > 0) {
        filter.category = parsedCategory;
      }
    }

    if (query?.search) {
      filter.$or = [
        { name: { $regex: query.search, $options: 'i' } },
        { itemName: { $regex: query.search, $options: 'i' } },
        { description: { $regex: query.search, $options: 'i' } },
      ];
    }

    if (query?.minPrice || query?.maxPrice) {
      filter.price = {};
      if (query.minPrice) filter.price.$gte = Number(query.minPrice);
      if (query.maxPrice) filter.price.$lte = Number(query.maxPrice);
    }

    const [products, total] = await Promise.all([
      this.productModel.find(filter).skip(skip).limit(limit).exec(),
      this.productModel.countDocuments(filter).exec(),
    ]);

    return {
      products: await Promise.all(
        products.map((product) => this.formatProductResponse(product)),
      ),
      total,
      page,
      limit,
    };
  }

  async findOne(id: string): Promise<any> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid product id');
    }
    const product = await this.productModel.findById(id).exec();
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return this.formatProductResponse(product);
  }

  async proxyImage(url: string): Promise<StreamableFile> {
    if (!url?.trim() || !isAllowedExternalImageUrl(url)) {
      throw new BadRequestException('Invalid image URL');
    }

    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: {
          Accept: 'image/*,*/*',
          'User-Agent':
            'Mozilla/5.0 (compatible; PrestigeCollectionBot/1.0; +https://prestigecollection.com)',
        },
        redirect: 'follow',
      });
    } catch {
      throw new NotFoundException('Image not found');
    }

    if (!response.ok) {
      throw new NotFoundException('Image not found');
    }

    const contentType = response.headers.get('content-type') ?? 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      throw new BadRequestException('URL does not point to an image');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return new StreamableFile(buffer, { type: contentType });
  }

  async update(id: string, updateData: UpdateProductDto): Promise<any> {
    const product = await this.productModel
      .findByIdAndUpdate(id, await this.normalizeProductPayload(updateData), {
        new: true,
      })
      .exec();

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.formatProductResponse(product);
  }

  async remove(id: string): Promise<void> {
    const result = await this.productModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException('Product not found');
    }
  }

  async updateStock(id: string, quantity: number): Promise<any> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid product id');
    }
    // Atomic updates avoid load + save(). Legacy product documents may omit fields
    // that the Product schema marks required (e.g. itemName, image); re-saving the
    // full document would trigger Mongoose validation and a 500 from the API.
    const res = await this.productModel.updateOne(
      { _id: id },
      { $inc: { stock: quantity } },
    );
    if (res.matchedCount === 0) {
      throw new NotFoundException('Product not found');
    }
    await this.productModel.updateOne(
      { _id: id, stock: { $lt: 0 } },
      { $set: { stock: 0 } },
    );
    const updated = await this.productModel.findById(id).exec();
    if (!updated) {
      throw new NotFoundException('Product not found');
    }
    return this.formatProductResponse(updated);
  }

  private async normalizeProductPayload(
    data: Partial<CreateProductDto | UpdateProductDto>,
  ): Promise<Record<string, any>> {
    const normalized: Record<string, any> = { ...data };

    if (data.itemName !== undefined) {
      normalized.name = data.itemName;
    }
    if (data.image !== undefined) {
      const resolvedImage = await resolveProductImageUrl(data.image);
      normalized.image = resolvedImage;
      normalized.images = [resolvedImage];
    }
    if (data.category !== undefined) {
      const specifications =
        (data as { specifications?: Record<string, any> }).specifications;
      normalized.categoryLabel = CATEGORY_LABELS[data.category] || 'Unknown';
      normalized.specifications = {
        ...(specifications || undefined),
        category: data.category,
      };
    }

    return normalized;
  }

  async migrateStoredImages(): Promise<{ updated: number; total: number }> {
    const products = await this.productModel.find().exec();
    let updated = 0;

    for (const product of products) {
      const rawImages = this.collectRawImageSources(product);
      if (rawImages.length === 0) continue;

      const resolvedImages = await resolveProductImageUrls(rawImages);
      const hasChanges = resolvedImages.some(
        (resolved, index) => resolved !== rawImages[index],
      );

      if (!hasChanges) continue;

      await this.productModel.updateOne(
        { _id: product._id },
        {
          $set: {
            image: resolvedImages[0],
            images: resolvedImages,
          },
        },
      );
      updated += 1;
    }

    return { updated, total: products.length };
  }

  private collectRawImageSources(product: ProductDocument): string[] {
    const productObj = product.toObject ? product.toObject() : product;
    const fromImages = Array.isArray(productObj.images)
      ? productObj.images.map((value) => String(value).trim()).filter(Boolean)
      : [];

    if (fromImages.length > 0) {
      return fromImages;
    }

    if (productObj.image) {
      return [String(productObj.image).trim()];
    }

    return [];
  }

  private async formatProductResponse(
    product: ProductDocument,
  ): Promise<Record<string, any>> {
    const productObj = product.toObject ? product.toObject() : product;
    const resolvedCategory = Number(productObj.category) || 0;
    const rawImages = this.collectRawImageSources(product);
    const resolvedImages =
      rawImages.length > 0
        ? await resolveProductImageUrls(rawImages)
        : [];
    const primaryImage = resolvedImages[0] ?? productObj.image ?? '';

    const hasChanges =
      resolvedImages.length > 0 &&
      resolvedImages.some((resolved, index) => resolved !== rawImages[index]);

    if (hasChanges && product._id) {
      void this.productModel
        .updateOne(
          { _id: product._id },
          { $set: { image: primaryImage, images: resolvedImages } },
        )
        .exec();
    }

    return {
      ...productObj,
      image: primaryImage,
      images: resolvedImages.length > 0 ? resolvedImages : productObj.images,
      category: resolvedCategory,
      categoryLabel: CATEGORY_LABELS[resolvedCategory] || 'Unknown',
      specifications: productObj.specifications
        ? {
            ...productObj.specifications,
            category: resolvedCategory,
          }
        : { category: resolvedCategory },
    };
  }
}
