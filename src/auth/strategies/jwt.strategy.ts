import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { UsersService } from '../../users/users.service';

const tolerantBearerExtractor = (req: Request): string | null => {
  const rawAuth = req?.headers?.authorization;
  if (!rawAuth) return null;

  // Extract JWT by pattern so malformed prefixes/suffixes do not break auth.
  // Works with:
  // - "Bearer <jwt>"
  // - "Bearer bearer <jwt>"
  // - quoted values or extra pasted text around token
  const value = rawAuth.trim().replaceAll(/^['"]|['"]$/g, '');
  const tokenMatch = /([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)/.exec(
    value,
  );

  return tokenMatch?.[1] || null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        tolerantBearerExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret') || 'default-secret',
    });
  }

  async validate(payload: any) {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException();
    }
    return { userId: payload.sub, email: payload.email, role: user.role };
  }
}
