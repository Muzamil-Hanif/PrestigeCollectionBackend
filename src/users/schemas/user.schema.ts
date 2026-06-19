import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ required: true })
  fullName: string;

  @Prop()
  profilePhoto?: string;

  @Prop()
  phoneNumber?: string;

  @Prop({ default: 'customer' })
  role: string; // 'customer' | 'admin'

  @Prop({ default: true })
  isActive: boolean;

  @Prop({
    type: {
      street: String,
      city: String,
      zipCode: String,
      country: String,
    },
    required: false,
  })
  address?: {
    street: string;
    city: string;
    zipCode: string;
    country: string;
  };
}

export const UserSchema = SchemaFactory.createForClass(User);
