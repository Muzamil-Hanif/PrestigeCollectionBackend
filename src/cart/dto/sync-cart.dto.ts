import { Type } from 'class-transformer';
import { IsArray, IsInt, IsMongoId, Min, ValidateNested } from 'class-validator';

class SyncCartItemDto {
  @IsMongoId()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class SyncCartDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncCartItemDto)
  items: SyncCartItemDto[];
}
