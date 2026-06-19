import {
  BadRequestException,
  Controller,
  Post,
  Body,
  Get,
  Patch,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register a new user',
    description: 'Create a new user account',
  })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation error' })
  async register(@Body() createUserDto: CreateUserDto) {
    const user = await this.usersService.create(createUserDto);
    const userDoc = user as any;
    const userObj = userDoc.toObject ? userDoc.toObject() : user;
    const { password, ...result } = userObj;
    return {
      message: 'User registered successfully',
      user: result,
    };
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get user profile',
    description: 'Get the authenticated user profile',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getProfile(@Request() req) {
    const user = await this.usersService.findById(req.user.userId);
    if (!user) {
      return { message: 'User not found' };
    }
    const userDoc = user as any;
    const userObj = userDoc.toObject ? userDoc.toObject() : user;
    const { password, ...result } = userObj;
    return result;
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('profilePhoto', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadDir = 'uploads/profile-photos';
          mkdirSync(uploadDir, { recursive: true });
          cb(null, uploadDir);
        },
        filename: (_req, file, cb) => {
          const extension = extname(file.originalname || '').toLowerCase();
          cb(null, `${randomUUID()}${extension || '.jpg'}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype?.startsWith('image/')) {
          return cb(
            new BadRequestException(
              'profilePhoto file must be an image format',
            ) as any,
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  @ApiBearerAuth('JWT-auth')
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({
    summary: 'Update user profile',
    description:
      'Update profile information such as display name and profile photo. Email is read-only.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        displayName: { type: 'string', example: 'John Doe' },
        profilePhoto: {
          oneOf: [
            { type: 'string', format: 'binary' },
            { type: 'string', example: 'https://cdn.example.com/john.jpg' },
            { type: 'string', example: 'file:///storage/emulated/0/DCIM/IMG_001.jpg' },
            {
              type: 'string',
              example: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...',
            },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'User profile updated successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateProfile(
    @Request() req,
    @Body() updateProfileDto: UpdateProfileDto,
    @UploadedFile() profilePhotoFile?: { path: string },
  ) {
    const payload = updateProfileDto as UpdateProfileDto & { email?: string };
    if (payload.email !== undefined) {
      throw new BadRequestException('Email cannot be changed');
    }

    if (profilePhotoFile) {
      payload.profilePhoto = `/${profilePhotoFile.path.replaceAll('\\', '/')}`;
    }

    const user = await this.usersService.updateProfileInfo(req.user.userId, payload);
    const userDoc = user as any;
    const userObj = userDoc.toObject ? userDoc.toObject() : user;
    const { password, ...result } = userObj;
    return result;
  }

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Change user password',
    description:
      'Secure password update flow requiring current password verification and confirm password match.',
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({ status: 200, description: 'Password updated successfully' })
  @ApiResponse({
    status: 400,
    description: 'Validation error or password confirmation mismatch',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized or wrong current password' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async changePassword(
    @Request() req,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    await this.usersService.changePassword(req.user.userId, changePasswordDto);
    return { message: 'Password updated successfully' };
  }
}
