import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsInt,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @ApiProperty({
    example: 'Dolce & Gabbana Cologne',
    description: 'Item name',
  })
  @IsString()
  @IsNotEmpty()
  itemName: string;

  @ApiPropertyOptional({
    example: 'Premium fragrance with long-lasting scent.',
    description: 'Item description',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    example: 89,
    description: 'Item price as integer',
  })
  @Type(() => Number)
  @IsInt()
  @IsNotEmpty()
  @Min(0)
  price: number;

  @ApiProperty({
    example: 3,
    description: 'Item category code as integer',
  })
  @Type(() => Number)
  @IsInt()
  @IsNotEmpty()
  category: number;

  @ApiProperty({
    example: 'https://cdn.shopify.com/s/files/example/product.jpg',
    description:
      'Image source: local asset path, direct image URL, Google Images link, or product page URL (og:image is resolved automatically)',
  })
  @IsString()
  @IsNotEmpty()
  image: string;

  @ApiPropertyOptional({
    example: 20,
    description: 'Optional stock quantity',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  stock?: number;
}
