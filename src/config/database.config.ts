import { registerAs } from '@nestjs/config';

export default registerAs('database', () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set. Define it in .env.production (Atlas) or .env.local (local MongoDB).',
    );
  }
  return { uri };
});
