import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ProductDocument = Product & Document;

@Schema({ timestamps: true })
export class Product {
  @Prop({ required: true })
  itemName: string;

  @Prop({ required: true })
  image: string;

  @Prop({ required: true })
  category: number;

  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ required: true })
  price: number;

  @Prop()
  originalPrice?: number;

  @Prop()
  categoryLabel?: string;

  @Prop({ type: [String], default: [] })
  images: string[];

  @Prop({ default: 0 })
  stock: number;

  @Prop({ default: true })
  isAvailable: boolean;

  @Prop({ type: Object })
  specifications?: {
    brand?: string;
    material?: string;
    size?: string;
    color?: string;
    [key: string]: any;
  };

  @Prop({ default: 0 })
  rating: number;

  @Prop({ default: 0 })
  reviewCount: number;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
