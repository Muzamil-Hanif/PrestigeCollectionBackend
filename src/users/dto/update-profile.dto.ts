import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'John Doe',
    description: 'Display name shown on profile',
  })
  @IsString()
  @IsOptional()
  displayName?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/profile/john-doe.jpg',
    description:
      'Profile image source. Accepts web URL, camera/gallery URI/path, or base64 data URI.',
  })
  @IsString()
  @Matches(
    /^(https?:\/\/|file:\/\/|content:\/\/|\/|data:image\/[a-zA-Z]+;base64,).+/,
    {
      message:
        'profilePhoto must be a valid URL, file/content URI, absolute path, or base64 image data URI',
    },
  )
  @IsOptional()
  profilePhoto?: string;
}
