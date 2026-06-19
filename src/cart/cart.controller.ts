import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { SyncCartDto } from './dto/sync-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CartService } from './cart.service';

@ApiTags('cart')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Get authenticated user cart' })
  @ApiResponse({ status: 200, description: 'Cart retrieved successfully' })
  async getCart(@Request() req) {
    return this.cartService.getCart(req.user.userId);
  }

  @Put()
  @ApiOperation({ summary: 'Replace and sync full user cart' })
  @ApiBody({ type: SyncCartDto })
  @ApiResponse({ status: 200, description: 'Cart synced successfully' })
  async syncCart(@Request() req, @Body() syncCartDto: SyncCartDto) {
    return this.cartService.syncCart(req.user.userId, syncCartDto);
  }

  @Post('sync')
  @ApiOperation({ summary: 'Alternative sync route for compatibility' })
  @ApiBody({ type: SyncCartDto })
  @ApiResponse({ status: 200, description: 'Cart synced successfully' })
  async syncCartAlternative(@Request() req, @Body() syncCartDto: SyncCartDto) {
    return this.cartService.syncCart(req.user.userId, syncCartDto);
  }

  @Post('items')
  @ApiOperation({ summary: 'Add item to cart' })
  @ApiBody({ type: AddCartItemDto })
  @ApiResponse({ status: 201, description: 'Item added to cart' })
  async addItem(@Request() req, @Body() addCartItemDto: AddCartItemDto) {
    return this.cartService.addItem(req.user.userId, addCartItemDto);
  }

  @Patch('items/:productId')
  @ApiOperation({ summary: 'Update cart item quantity' })
  @ApiParam({ name: 'productId', description: 'Product id in cart' })
  @ApiBody({ type: UpdateCartItemDto })
  @ApiResponse({ status: 200, description: 'Cart item updated' })
  async updateItem(
    @Request() req,
    @Param('productId') productId: string,
    @Body() updateCartItemDto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItem(
      req.user.userId,
      productId,
      updateCartItemDto,
    );
  }

  @Delete('items/:productId')
  @ApiOperation({ summary: 'Remove item from cart' })
  @ApiParam({ name: 'productId', description: 'Product id in cart' })
  @ApiResponse({ status: 200, description: 'Cart item removed' })
  async removeItem(@Request() req, @Param('productId') productId: string) {
    return this.cartService.removeItem(req.user.userId, productId);
  }

  @Delete()
  @ApiOperation({ summary: 'Clear all cart items' })
  @ApiResponse({ status: 200, description: 'Cart cleared successfully' })
  async clearCart(@Request() req) {
    return this.cartService.clearCart(req.user.userId);
  }
}
