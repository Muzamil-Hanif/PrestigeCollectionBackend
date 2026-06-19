import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductsService } from '../products/products.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { SyncCartDto } from './dto/sync-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { Cart, CartDocument } from './schemas/cart.schema';

@Injectable()
export class CartService {
  constructor(
    @InjectModel(Cart.name) private cartModel: Model<CartDocument>,
    private readonly productsService: ProductsService,
  ) {}

  async getCart(userId: string): Promise<Cart> {
    const cart = await this.getOrCreateCart(userId);
    return this.enrichCart(cart);
  }

  async syncCart(userId: string, syncCartDto: SyncCartDto): Promise<Cart> {
    const normalizedItems = await this.normalizeItems(syncCartDto.items);
    const cart = await this.getOrCreateCart(userId);
    cart.items = normalizedItems;
    await cart.save();
    return this.enrichCart(cart);
  }

  async addItem(userId: string, addCartItemDto: AddCartItemDto): Promise<Cart> {
    const product = await this.productsService.findOne(addCartItemDto.productId);
    const cart = await this.getOrCreateCart(userId);

    const existingItem = cart.items.find(
      (item) => item.productId.toString() === addCartItemDto.productId,
    );
    const requestedQty =
      (existingItem?.quantity ?? 0) + Number(addCartItemDto.quantity);

    if (product.stock < requestedQty) {
      throw new BadRequestException(
        `Insufficient stock for ${product.name}. Available: ${product.stock}`,
      );
    }

    if (existingItem) {
      existingItem.quantity = requestedQty;
    } else {
      cart.items.push({
        productId: new Types.ObjectId(addCartItemDto.productId),
        quantity: addCartItemDto.quantity,
      } as any);
    }

    await cart.save();
    return this.enrichCart(cart);
  }

  async updateItem(
    userId: string,
    productId: string,
    updateCartItemDto: UpdateCartItemDto,
  ): Promise<Cart> {
    const cart = await this.getOrCreateCart(userId);
    const existingItem = cart.items.find(
      (item) => item.productId.toString() === productId,
    );

    if (!existingItem) {
      throw new BadRequestException('Cart item does not exist');
    }

    if (updateCartItemDto.quantity === 0) {
      cart.items = cart.items.filter((item) => item.productId.toString() !== productId);
      await cart.save();
      return this.enrichCart(cart);
    }

    const product = await this.productsService.findOne(productId);
    if (product.stock < updateCartItemDto.quantity) {
      throw new BadRequestException(
        `Insufficient stock for ${product.name}. Available: ${product.stock}`,
      );
    }

    existingItem.quantity = updateCartItemDto.quantity;
    await cart.save();
    return this.enrichCart(cart);
  }

  async removeItem(userId: string, productId: string): Promise<Cart> {
    const cart = await this.getOrCreateCart(userId);
    cart.items = cart.items.filter((item) => item.productId.toString() !== productId);
    await cart.save();
    return this.enrichCart(cart);
  }

  async clearCart(userId: string): Promise<Cart> {
    const cart = await this.getOrCreateCart(userId);
    cart.items = [];
    await cart.save();
    return this.enrichCart(cart);
  }

  private async getOrCreateCart(userId: string): Promise<CartDocument> {
    let cart = await this.cartModel.findOne({ userId }).exec();
    if (!cart) {
      cart = await this.cartModel.create({ userId, items: [] });
    }
    return cart;
  }

  private async normalizeItems(
    items: Array<{ productId: string; quantity: number }>,
  ): Promise<Array<{ productId: Types.ObjectId; quantity: number }>> {
    const merged = new Map<string, number>();
    for (const item of items) {
      merged.set(item.productId, (merged.get(item.productId) || 0) + item.quantity);
    }

    const normalized: Array<{ productId: Types.ObjectId; quantity: number }> = [];
    for (const [productId, quantity] of merged) {
      const product = await this.productsService.findOne(productId);
      if (product.stock < quantity) {
        throw new BadRequestException(
          `Insufficient stock for ${product.name}. Available: ${product.stock}`,
        );
      }
      normalized.push({ productId: new Types.ObjectId(productId), quantity });
    }
    return normalized;
  }

  private async enrichCart(cart: CartDocument): Promise<any> {
    const enrichedItems = await Promise.all(
      cart.items.map(async (item) => {
        const product = await this.productsService.findOne(item.productId.toString());
        const lineTotal = product.price * item.quantity;
        return {
          productId: item.productId,
          quantity: item.quantity,
          product: {
            _id: product['_id'],
            name: product.name,
            price: product.price,
            images: product.images,
            stock: product.stock,
            isAvailable: product.isAvailable,
          },
          lineTotal,
        };
      }),
    );

    return {
      ...cart.toObject(),
      items: enrichedItems,
      totals: {
        itemCount: enrichedItems.reduce((sum, item) => sum + item.quantity, 0),
        subtotal: enrichedItems.reduce((sum, item) => sum + item.lineTotal, 0),
      },
    };
  }
}
