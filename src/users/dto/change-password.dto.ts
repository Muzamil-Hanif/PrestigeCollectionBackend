import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    example: 'old-password-123',
    description: 'Current account password',
  })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({
    example: 'new-password-123',
    description: 'New account password',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;

  @ApiProperty({
    example: 'new-password-123',
    description: 'Must exactly match newPassword',
  })
  @IsString()
  @IsNotEmpty()
  confirmPassword: string;
}
