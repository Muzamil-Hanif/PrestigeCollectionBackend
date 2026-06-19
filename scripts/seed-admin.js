/**
 * Create or update the default admin user.
 * Run: node scripts/seed-admin.js
 *
 * Default credentials:
 *   Email:    admin@prestige-men.com
 *   Password: Admin@12345
 */
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/prestige-men';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@prestige-men.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@12345';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Prestige Admin';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    fullName: { type: String, required: true },
    role: { type: String, default: 'customer' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

async function seedAdmin() {
  await mongoose.connect(MONGODB_URI);
  const User = mongoose.model('User', userSchema, 'users');

  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const existing = await User.findOne({ email: ADMIN_EMAIL });

  if (existing) {
    existing.password = hashedPassword;
    existing.fullName = ADMIN_NAME;
    existing.role = 'admin';
    existing.isActive = true;
    await existing.save();
    console.log(`Updated admin user: ${ADMIN_EMAIL}`);
  } else {
    await User.create({
      email: ADMIN_EMAIL,
      password: hashedPassword,
      fullName: ADMIN_NAME,
      role: 'admin',
      isActive: true,
    });
    console.log(`Created admin user: ${ADMIN_EMAIL}`);
  }

  console.log(`Password: ${ADMIN_PASSWORD}`);
  await mongoose.disconnect();
}

seedAdmin().catch((err) => {
  console.error('Failed to seed admin:', err);
  process.exit(1);
});
