import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument } from './schemas/order.schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { ProductsService } from '../products/products.service';

// Payment methods that require an online/wallet payment to be confirmed
// before fulfillment can start. Orders placed with one of these start in
// `payment_pending`; everything else (e.g. Cash on Delivery) starts in
// `placed` since there's nothing to wait on.
const ONLINE_PAYMENT_METHODS = ['Credit Card', 'Debit Card', 'JazzCash', 'easyPaisa'];

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    private productsService: ProductsService,
  ) {}

  async create(userId: string, createOrderDto: CreateOrderDto): Promise<OrderDocument> {
    // Validate and update stock for each product
    for (const item of createOrderDto.items) {
      const product = await this.productsService.findOne(item.productId);
      if (product.stock < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for ${product.name}. Available: ${product.stock}`,
        );
      }
      // Reduce stock
      await this.productsService.updateStock(item.productId, -item.quantity);
    }

    const order = new this.orderModel({
      userId: new Types.ObjectId(userId),
      items: createOrderDto.items.map((item) => {
        if (!Types.ObjectId.isValid(item.productId)) {
          throw new BadRequestException(`Invalid product id: ${item.productId}`);
        }
        return {
          productId: new Types.ObjectId(item.productId),
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          ...(item.image != null && String(item.image).length > 0
            ? { image: String(item.image) }
            : {}),
        };
      }),
      totalPrice: createOrderDto.totalPrice,
      shippingCost: createOrderDto.shippingCost,
      grandTotal: createOrderDto.grandTotal,
      shippingAddress: { ...createOrderDto.shippingAddress },
      paymentMethod: createOrderDto.paymentMethod,
      ...(createOrderDto.walletPhoneNumber
        ? { walletPhoneNumber: createOrderDto.walletPhoneNumber }
        : {}),
      status: ONLINE_PAYMENT_METHODS.includes(createOrderDto.paymentMethod)
        ? 'payment_pending'
        : 'placed',
      paymentStatus: 'pending',
    });

    return order.save();
  }

  async findAll(userId?: string): Promise<OrderDocument[]> {
    const filter = userId ? { userId } : {};
    return this.orderModel
      .find(filter)
      .populate('userId', 'email fullName')
      .exec();
  }

  async findOne(id: string, userId?: string): Promise<OrderDocument> {
    const filter: any = { _id: id };
    if (userId) {
      filter.userId = userId;
    }

    const order = await this.orderModel.findOne(filter).exec();
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  async updateStatus(id: string, status: string): Promise<OrderDocument> {
    // Refunding an order implies the payment was reversed, so keep
    // paymentStatus in sync instead of requiring a second admin action.
    const update: Record<string, string> =
      status === 'refunded' ? { status, paymentStatus: 'refunded' } : { status };

    const order = await this.orderModel
      .findByIdAndUpdate(id, update, { new: true })
      .exec();

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  async getUserOrders(userId: string): Promise<OrderDocument[]> {
    return this.orderModel.find({ userId }).sort({ createdAt: -1 }).exec();
  }

  async updatePaymentInfo(
    orderId: string,
    paymentInfo: {
      paymentStatus: string;
      transactionId: string;
      status: string;
      sessionToken?: string;
      trackerToken?: string;
    },
  ): Promise<OrderDocument> {
    const update: Record<string, any> = {
      paymentStatus: paymentInfo.paymentStatus,
      paymentTransactionId: paymentInfo.transactionId,
      status: paymentInfo.status,
    };

    if (paymentInfo.sessionToken) {
      update.paymentSessionToken = paymentInfo.sessionToken;
    }
    if (paymentInfo.trackerToken) {
      update.paymentTrackerToken = paymentInfo.trackerToken;
    }

    const order = await this.orderModel
      .findByIdAndUpdate(orderId, update, { new: true })
      .exec();

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }
}
