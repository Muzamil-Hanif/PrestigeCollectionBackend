import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  UseGuards,
  Request,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('orders')
@ApiBearerAuth('JWT-auth')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create a new order',
    description: 'Requires authentication',
  })
  @ApiBody({ type: CreateOrderDto })
  @ApiResponse({ status: 201, description: 'Order created successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(@Request() req, @Body() createOrderDto: CreateOrderDto) {
    return this.ordersService.create(req.user.userId, createOrderDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get user orders',
    description: 'Get all orders for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'User orders retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getUserOrders(@Request() req) {
    return this.ordersService.getUserOrders(req.user.userId);
  }

  @Get('all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({
    summary: 'Get all orders',
    description: 'Admin only. Get all orders across all users.',
  })
  @ApiResponse({
    status: 200,
    description: 'All orders retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin access required' })
  async getAllOrders() {
    return this.ordersService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get order by ID',
    description: 'Get a specific order by ID',
  })
  @ApiParam({ name: 'id', description: 'Order ID' })
  @ApiResponse({ status: 200, description: 'Order retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async findOne(@Request() req, @Param('id') id: string) {
    return this.ordersService.findOne(id, req.user.userId);
  }

  @Put(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({
    summary: 'Update order status',
    description: 'Admin only. Update the fulfillment status of an order.',
  })
  @ApiParam({ name: 'id', description: 'Order ID' })
  @ApiBody({
    schema: { type: 'object', properties: { status: { type: 'string' } } },
  })
  @ApiResponse({
    status: 200,
    description: 'Order status updated successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin access required' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.ordersService.updateStatus(id, status);
  }

  @Put(':id/payment/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({
    summary: 'Verify wallet payment (JazzCash/easyPaisa)',
    description:
      'Admin only. Mark wallet payment as verified after confirming the transaction manually.',
  })
  @ApiParam({ name: 'id', description: 'Order ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        transactionId: { type: 'string', description: 'Wallet transaction ID' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Payment verified successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin access required' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async verifyWalletPayment(
    @Param('id') orderId: string,
    @Body('transactionId') transactionId: string,
  ) {
    // Verify order exists (don't enforce user ID in test mode)
    const order = await this.ordersService.findOne(orderId);

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    return this.ordersService.updatePaymentInfo(orderId, {
      paymentStatus: 'captured',
      transactionId: transactionId || `WALLET_${Date.now()}`,
      status: 'payment_successful',
    });
  }
}
