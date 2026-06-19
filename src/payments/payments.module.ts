import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { SafepayService } from './safepay.service';
import { PaymentsController } from './payments.controller';
import { OrdersModule } from '../orders/orders.module';
import { CartModule } from '../cart/cart.module';

@Module({
  imports: [
    HttpModule.register({
      timeout: 5000,
    }),
    ConfigModule,
    OrdersModule,
    CartModule,
  ],
  providers: [SafepayService],
  controllers: [PaymentsController],
  exports: [SafepayService],
})
export class PaymentsModule {}
