# Prestige Collection Backend API

A robust NestJS backend API for the Prestige Collection e-commerce platform, built with MongoDB and TypeScript.

## 🚀 Features

- **Authentication & Authorization**: JWT-based authentication with secure password hashing
- **User Management**: User registration, login, and profile management
- **Product Management**: CRUD operations for products with search and filtering
- **Order Management**: Complete order processing with stock management
- **MongoDB Integration**: Mongoose ODM for database operations
- **Validation**: Request validation using class-validator
- **CORS Enabled**: Ready for Flutter mobile app integration

## 📋 Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- MongoDB (local or cloud instance)
- Git

## 🛠️ Installation

1. **Navigate to the backend directory:**

   ```bash
   cd prestige-men-backend
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Set up environment variables:**
   Create a `.env` file in the root directory:

   ```env
   # Server Configuration
   PORT=3000
   NODE_ENV=development

   # MongoDB Configuration
   MONGODB_URI=mongodb://localhost:27017/prestige-men

   # JWT Configuration
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
   JWT_EXPIRES_IN=7d

   # CORS Configuration
   CORS_ORIGIN=http://localhost:3000
   ```

4. **Start MongoDB:**
   Make sure MongoDB is running on your system. If using local MongoDB:

   ```bash
   mongod
   ```

   Or use MongoDB Atlas (cloud) and update the `MONGODB_URI` in `.env`.

## 🏃 Running the Application

### Development Mode

```bash
npm run start:dev
lsof -i :3000
kill -9 55546
```

The API will be available at `http://localhost:3000/api`

### Production Mode

```bash
npm run build
npm run start:prod
```

## 📚 API Endpoints

### Authentication

- `POST /api/auth/login` - User login
- `POST /api/users/register` - User registration

### Users

- `GET /api/users/profile` - Get user profile (Protected)
- `POST /api/users/register` - Register new user

### Products

- `GET /api/products` - Get all products (with optional query params: category, search, minPrice, maxPrice, page, limit)
- `GET /api/products/:id` - Get single product
- `POST /api/products` - Create product (Protected)
- `PUT /api/products/:id` - Update product (Protected)
- `DELETE /api/products/:id` - Delete product (Protected)

### Orders

- `POST /api/orders` - Create new order (Protected)
- `GET /api/orders` - Get user's orders (Protected)
- `GET /api/orders/:id` - Get single order (Protected)
- `PUT /api/orders/:id/status` - Update order status (Protected)

## 🔐 Authentication

Most endpoints require authentication. Include the JWT token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## 📁 Project Structure

```
prestige-men-backend/
├── src/
│   ├── auth/              # Authentication module
│   │   ├── guards/        # JWT guards
│   │   ├── strategies/    # Passport strategies
│   │   └── ...
│   ├── users/             # User management
│   │   ├── dto/          # Data Transfer Objects
│   │   ├── schemas/      # Mongoose schemas
│   │   └── ...
│   ├── products/          # Product management
│   ├── orders/            # Order management
│   ├── config/            # Configuration files
│   ├── database/          # Database connection
│   ├── app.module.ts      # Root module
│   └── main.ts            # Application entry point
├── .env                   # Environment variables (create this)
└── package.json
```

## 🧪 Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

## 🔧 Available Scripts

- `npm run start` - Start the application
- `npm run start:dev` - Start in development mode with hot reload
- `npm run start:debug` - Start in debug mode
- `npm run start:prod` - Start in production mode
- `npm run build` - Build the application
- `npm run format` - Format code using Prettier
- `npm run lint` - Lint code using ESLint

## 📝 Environment Variables

| Variable         | Description               | Default                                  |
| ---------------- | ------------------------- | ---------------------------------------- |
| `PORT`           | Server port               | `3000`                                   |
| `NODE_ENV`       | Environment               | `development`                            |
| `MONGODB_URI`    | MongoDB connection string | `mongodb://localhost:27017/prestige-men` |
| `JWT_SECRET`     | JWT secret key            | -                                        |
| `JWT_EXPIRES_IN` | JWT expiration time       | `7d`                                     |
| `CORS_ORIGIN`    | CORS allowed origin       | `*`                                      |

## 🔗 Integration with Flutter App

The backend is configured to work with your Flutter app. Make sure to:

1. Update your Flutter app's API base URL to: `http://localhost:3000/api` (or your server URL)
2. Include the JWT token in API requests after login
3. Handle CORS if deploying to a different domain

## 🚨 Security Notes

- **Never commit `.env` file** to version control
- **Change JWT_SECRET** in production to a strong, random string
- **Use HTTPS** in production
- **Implement rate limiting** for production
- **Validate all inputs** (already implemented with class-validator)

## 📦 Dependencies

### Core

- `@nestjs/common` - NestJS core
- `@nestjs/mongoose` - MongoDB integration
- `@nestjs/config` - Configuration management
- `@nestjs/jwt` - JWT authentication
- `mongoose` - MongoDB ODM

### Security

- `passport` & `passport-jwt` - Authentication
- `bcrypt` - Password hashing

### Validation

- `class-validator` - DTO validation
- `class-transformer` - Object transformation

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Test thoroughly
4. Submit a pull request

## 📄 License

This project is private and proprietary.

## 🆘 Support

For issues or questions, please contact the development team.

---

**Built with ❤️ using NestJS**

## 🌐 ngrok Setup (For Testing with External Services)

ngrok creates a secure public tunnel to your local API, useful for testing with physical devices, webhooks, or external integrations.

### Installation

1. **Download ngrok:**
   Visit [ngrok.com](https://ngrok.com) and download for your OS.

2. **Install (macOS via Homebrew):**
   ```bash
   brew install ngrok
   ```

3. **Sign up and authenticate:**
   ```bash
   ngrok config add-authtoken <your-auth-token>
   ```
   Get your auth token from your ngrok dashboard.

### Running ngrok

Start a tunnel to your local backend:

```bash
ngrok http 3000
```

Output example:
```
Forwarding                    https://turmoil-borough-sincere.ngrok-free.dev -> http://localhost:3000
```

### Using the Public URL

Replace your local API URL with the ngrok URL:
- **Local:** `http://localhost:3000/api`
- **Public:** `https://turmoil-borough-sincere.ngrok-free.dev/api`

Update your Flutter app:
```bash
flutter run --dart-define=API_BASE_URL=https://turmoil-borough-sincere.ngrok-free.dev
```

### Tips

- URL changes each time ngrok restarts (unless you have a paid plan with static domains)
- Keep the ngrok terminal window open while using the tunnel
- Use `-subdomain=custom-name` for paid plans to get a fixed URL
- Perfect for testing on physical devices or webhooks from external services
# PrestigeCollectionBackend
