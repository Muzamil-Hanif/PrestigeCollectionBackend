import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type OrderDocument = Order & Document;

@Schema({ timestamps: true })
export class OrderItem {
  // NOTE: the type must be `mongoose.Schema.Types.ObjectId` (the schema type
  // descriptor), not `mongoose.Types.ObjectId` (the BSON value class). Using
  // the latter makes Mongoose treat the path as `Mixed`, which silently
  // skips auto-casting/validation on queries (e.g. `find({ userId })` with a
  // plain string id never matches an ObjectId-valued field).
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  price: number;

  @Prop({ required: true })
  quantity: number;

  @Prop()
  image?: string;
}

const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

@Schema({ timestamps: true })
export class Order {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: [OrderItemSchema], required: true })
  items: OrderItem[];

  @Prop({ required: true })
  totalPrice: number;

  @Prop({ required: true, default: 10.0 })
  shippingCost: number;

  @Prop({ required: true })
  grandTotal: number;

  // Fulfillment lifecycle stage. `payment_pending`/`payment_successful` are
  // entered automatically for orders that require an online/wallet payment
  // (see OrdersService.create and PaymentsController); `placed` is used for
  // Cash on Delivery and other stages are advanced by an admin.
  @Prop({
    required: true,
    enum: [
      'placed',
      'payment_pending',
      'payment_successful',
      'processing',
      'packed',
      'shipped',
      'out_for_delivery',
      'delivered',
      'cancelled',
      'refunded',
    ],
    default: 'placed',
  })
  status: string;

  @Prop({
    type: {
      fullName: String,
      email: String,
      phoneNumber: String,
      street: String,
      city: String,
      zipCode: String,
    },
    required: true,
  })
  shippingAddress: {
    fullName: string;
    email: string;
    phoneNumber: string;
    street: string;
    city: string;
    zipCode: string;
  };

  @Prop({ required: true })
  paymentMethod: string;

  @Prop({ enum: ['pending', 'captured', 'failed', 'refunded'], default: 'pending' })
  paymentStatus?: string;

  @Prop()
  paymentTransactionId?: string;

  @Prop()
  paymentSessionToken?: string;

  @Prop()
  paymentTrackerToken?: string;

  @Prop()
  trackingNumber?: string;

  @Prop()
  walletPhoneNumber?: string;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
