# Developer Guide [DEPRACATED PROJECT]

## Overview

This guide provides comprehensive information for developers working on the EvenApp backend codebase. The application is built with NestJS, following a modular architecture with dependency injection, TypeORM for database operations, Firebase Admin for authentication, and WebSocket support for real-time features.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Modules](#modules)
3. [Services](#services)
4. [Creating a New Feature Module](#creating-a-new-feature-module)
5. [Working with TypeORM](#working-with-typeorm)
6. [Authentication and Authorization](#authentication-and-authorization)
7. [WebSocket Gateway](#websocket-gateway)
8. [Cron Jobs](#cron-jobs)
9. [File Storage (S3)](#file-storage-s3)
10. [Caching with Redis](#caching-with-redis)
11. [Running and Building](#running-and-building)
12. [Testing](#testing)
13. [Code Documentation Standards](#code-documentation-standards)

## Architecture Overview

### Directory Structure

```
backend/
├── src/
│   ├── admin/              # Admin functionality
│   │   ├── admin.controller.ts
│   │   ├── admin.module.ts
│   │   ├── admin.service.ts
│   │   └── dto/            # Data Transfer Objects
│   ├── auth/               # Authentication module
│   │   ├── auth.module.ts
│   │   ├── firebase/       # Firebase Admin integration
│   │   └── guards/         # Authentication guards
│   ├── chat/               # Chat functionality
│   │   ├── chat.controller.ts
│   │   ├── chat.gateway.ts # WebSocket gateway
│   │   ├── chat.mapper.ts
│   │   ├── chat.module.ts
│   │   └── chat.service.ts
│   ├── cron/               # Scheduled tasks
│   │   ├── cron.module.ts
│   │   └── cron.service.ts
│   ├── database/           # Database configuration
│   │   ├── entities/       # TypeORM entities
│   │   ├── migrations/     # Database migrations
│   │   └── typeorm.config.ts
│   ├── like/               # Like functionality
│   ├── matches/            # Match management
│   ├── message-req/        # Message requests
│   ├── profiles/           # User profiles
│   ├── redis/              # Redis caching
│   ├── reviews/            # Review system
│   ├── s3/                 # S3 file storage
│   ├── search/             # Search functionality
│   ├── types/              # TypeScript type definitions
│   ├── users/              # User management
│   ├── utils/              # Utility functions
│   ├── app.module.ts       # Root module
│   ├── app.controller.ts
│   ├── app.service.ts
│   └── main.ts             # Application entry point
├── test/                   # E2E tests
├── typeorm/                # TypeORM CLI configuration
├── package.json
├── tsconfig.json
└── docker-compose.yml      # Local development setup
```

### Key Concepts

#### Dependency Injection

NestJS uses dependency injection via decorators. Services are injected into constructors using `@Inject()` or by type:

```typescript
import { Injectable, Inject } from '@nestjs/common';

@Injectable()
export class MyService {
  constructor(
    @Inject('FIREBASE_ADMIN') private firebase: typeof admin,
    private readonly otherService: OtherService,
  ) {}
}
```

#### Module Architecture

The application follows NestJS's modular architecture:

- **Modules** (`*.module.ts`) - Organize providers, controllers, and imports
- **Services** (`*.service.ts`) - Business logic
- **Controllers** (`*.controller.ts`) - HTTP endpoints
- **DTOs** (`dto/*.dto.ts`) - Data validation and transfer objects
- **Entities** (`database/entities/*.entity.ts`) - TypeORM database models
- **Guards** (`guards/*.guard.ts`) - Route protection

#### Global Configuration

- **FirebaseAuthGuard** - Applied globally via `APP_GUARD` in `AppModule`
- **ConfigModule** - Global configuration via `@nestjs/config`
- **API Prefix** - All routes prefixed with `/api` (configured in `main.ts`)

## Modules

### Available Modules

- **AuthModule** - Firebase authentication and guards
- **UsersModule** - User identity lifecycle management
- **ProfilesModule** - Profile management and CRUD operations
- **LikeModule** - Like/unlike functionality
- **MatchesModule** - Match management
- **ChatModule** - Real-time chat with WebSocket support
- **SearchModule** - User search functionality
- **ReviewsModule** - Review system with safety features
- **MessageRequestModule** - Message request handling
- **AdminModule** - Administrative operations
- **RedisModule** - Caching layer
- **S3Module** - File storage operations
- **CronModule** - Scheduled tasks

### Module Dependencies

Modules can import other modules to use their services:

```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([Profile, Like, Match]),
    UsersModule,  // Import to use UsersService
    S3Module,      // Import to use S3Service
    RedisModule,   // Import to use RedisService
  ],
  providers: [ProfilesService],
  controllers: [ProfilesController],
  exports: [ProfilesService], // Export to allow other modules to use
})
export class ProfilesModule {}
```

## Services

### Using Services

Services are injected via constructor injection:

```typescript
import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { S3Service } from '../s3/s3.service';

@Injectable()
export class MyService {
  constructor(
    private readonly usersService: UsersService,
    private readonly s3Service: S3Service,
  ) {}

  async doSomething() {
    const user = await this.usersService.findOne(uid);
    // Use user...
  }
}
```

### Service Lifecycle

Services are singletons by default. They are instantiated once and shared across the application.

## Creating a New Feature Module

### Step 1: Generate Module Structure

```bash
nest g module my-feature
nest g service my-feature
nest g controller my-feature
```

### Step 2: Create the Module

```typescript
// src/my-feature/my-feature.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MyFeatureService } from './my-feature.service';
import { MyFeatureController } from './my-feature.controller';
import { MyEntity } from '../database/entities/my-entity.entity';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MyEntity]),
    UsersModule,
  ],
  providers: [MyFeatureService],
  controllers: [MyFeatureController],
  exports: [MyFeatureService],
})
export class MyFeatureModule {}
```

### Step 3: Create the Service

```typescript
// src/my-feature/my-feature.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MyEntity } from '../database/entities/my-entity.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class MyFeatureService {
  constructor(
    @InjectRepository(MyEntity)
    private readonly myEntityRepository: Repository<MyEntity>,
    private readonly usersService: UsersService,
  ) {}

  async findAll(): Promise<MyEntity[]> {
    return this.myEntityRepository.find();
  }
}
```

### Step 4: Create the Controller

```typescript
// src/my-feature/my-feature.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { MyFeatureService } from './my-feature.service';
import { FirebaseUser } from '../auth/firebase/firebase-user.decorator';

@Controller('my-feature')
export class MyFeatureController {
  constructor(private readonly myFeatureService: MyFeatureService) {}

  @Get()
  async findAll(@FirebaseUser() user: { uid: string }) {
    return this.myFeatureService.findAll();
  }
}
```

### Step 5: Register in AppModule

```typescript
// src/app.module.ts
import { MyFeatureModule } from './my-feature/my-feature.module';

@Module({
  imports: [
    // ... other modules
    MyFeatureModule,
  ],
})
export class AppModule {}
```

## Working with TypeORM

### Creating an Entity

```typescript
// src/database/entities/my-entity.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('my_entities')
export class MyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @CreateDateColumn()
  createdAt: Date;
}
```

### Using Repository in Service

```typescript
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class MyService {
  constructor(
    @InjectRepository(MyEntity)
    private readonly myEntityRepository: Repository<MyEntity>,
  ) {}

  async create(data: Partial<MyEntity>): Promise<MyEntity> {
    const entity = this.myEntityRepository.create(data);
    return this.myEntityRepository.save(entity);
  }

  async findOne(id: string): Promise<MyEntity | null> {
    return this.myEntityRepository.findOne({ where: { id } });
  }

  async findAll(): Promise<MyEntity[]> {
    return this.myEntityRepository.find();
  }
}
```

### Database Migrations

Generate a migration:

```bash
npm run typeorm migration:generate src/database/migrations/MyMigration
```

Run migrations:

```bash
npm run typeorm:migration:run
```

Revert last migration:

```bash
npm run typeorm:migration:revert
```

### TypeORM Configuration

Database configuration is in `src/database/typeorm.config.ts`:

```typescript
export const typeormConfig: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: 5432,
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'devpassword',
  database: process.env.DB_NAME || 'evenapp',
  synchronize: false, // Never true in production
  logging: true,
  entities: [__dirname + '/entities/*.{ts,js}'],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
};
```

## Authentication and Authorization

### Firebase Authentication

All routes are protected by `FirebaseAuthGuard` (applied globally). The guard:

1. Extracts the `Authorization: Bearer <token>` header
2. Verifies the Firebase ID token
3. Attaches user info to `req.user`:

```typescript
interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email: string | null;
    phone: string | null;
  };
}
```

### Accessing Authenticated User

Use the `@FirebaseUser()` decorator in controllers:

```typescript
import { FirebaseUser } from '../auth/firebase/firebase-user.decorator';

@Get('profile')
async getProfile(@FirebaseUser() user: { uid: string }) {
  return this.profilesService.findOne(user.uid);
}
```

### Admin Guard

For admin-only routes, use `@UseGuards(AdminGuard)`:

```typescript
import { UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';

@UseGuards(AdminGuard)
@Post('admin-action')
async adminAction() {
  // Admin-only logic
}
```

## WebSocket Gateway

### Creating a WebSocket Gateway

```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import * as admin from 'firebase-admin';

@WebSocketGateway({ cors: { origin: '*' } })
export class MyGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  async handleConnection(client: Socket) {
    // Authenticate client
    const token = client.handshake.auth.token;
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      client.data.uid = decoded.uid;
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    // Cleanup
  }

  @SubscribeMessage('message')
  handleMessage(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    // Handle message
    this.server.emit('response', data);
  }
}
```

### Broadcasting Messages

```typescript
// To all clients
this.server.emit('event', data);

// To specific room
this.server.to('roomId').emit('event', data);

// To specific client
client.emit('event', data);
```

## Cron Jobs

### Creating a Scheduled Task

```typescript
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class MyCronService {
  @Cron(CronExpression.EVERY_HOUR)
  handleCron() {
    // Runs every hour
  }

  @Cron('0 0 * * *') // Every day at midnight
  handleDaily() {
    // Runs daily
  }
}
```

### Registering Cron Service

Ensure `ScheduleModule.forRoot()` is imported in `AppModule` (already configured).

## File Storage (S3)

### Using S3Service

```typescript
import { S3Service } from '../s3/s3.service';

@Injectable()
export class MyService {
  constructor(private readonly s3Service: S3Service) {}

  async uploadFile(file: Buffer, key: string): Promise<string> {
    return this.s3Service.uploadFile(file, key);
  }

  async getPresignedUrl(key: string): Promise<string> {
    return this.s3Service.getPresignedUrl(key);
  }

  async deleteFile(key: string): Promise<void> {
    return this.s3Service.deleteFile(key);
  }
}
```

### S3 Configuration

S3 credentials are configured via environment variables:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `AWS_S3_BUCKET`

## Caching with Redis

### Using RedisService

```typescript
import { RedisService } from '../redis/redis.service';

@Injectable()
export class MyService {
  constructor(private readonly redisService: RedisService) {}

  async getCachedData(key: string): Promise<string | null> {
    return this.redisService.get(key);
  }

  async setCachedData(key: string, value: string, ttl?: number): Promise<void> {
    await this.redisService.set(key, value, ttl);
  }

  async deleteCachedData(key: string): Promise<void> {
    await this.redisService.del(key);
  }
}
```

### Redis Configuration

Redis connection is configured via environment variables:
- `REDIS_HOST` (default: `localhost`)
- `REDIS_PORT` (default: `6379`)

## Running and Building

### Development

```bash
# Install dependencies
npm install

# Start development server (with hot reload)
npm run start:dev

# Start with debugger
npm run start:debug
```

The server runs on `http://localhost:3000` with API prefix `/api`.

### Building

```bash
# Build TypeScript
npm run build

# Production build
npm run build:prod
```

### Production

```bash
# Start production server
npm run start:prod
```

### Environment Variables

Create a `.env` file in the `backend/` directory:

```env
# Database
DB_HOST=localhost
DB_USER=postgres
DB_PASSWORD=devpassword
DB_NAME=evenapp

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# AWS S3
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-bucket

# Firebase (uses application default credentials)
# Or set GOOGLE_APPLICATION_CREDENTIALS path
```

## Testing

### Unit Tests

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:cov
```

### E2E Tests

```bash
npm run test:e2e
```

### Test Structure

```typescript
// my-feature.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { MyFeatureService } from './my-feature.service';

describe('MyFeatureService', () => {
  let service: MyFeatureService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MyFeatureService],
    }).compile();

    service = module.get<MyFeatureService>(MyFeatureService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

## Code Documentation Standards

All exported functions, classes, and interfaces use a standardized documentation format:

```typescript
//********************************************************************
//
// Function/Class Name
//
// Brief description of what the function/class does and how it works.
//
// Return Value
// ------------
// Type    Description
//
// Value Parameters
// ----------------
// param1    Type    Description
//
// Reference Parameters
// --------------------
// None (or list if any)
//
// Local Variables
// ---------------
// var1    Type    Description
//
//*******************************************************************
```

### Example

```typescript
//********************************************************************
//
// createProfile Method
//
// Creates a new user profile with the provided data. Validates input,
// checks for existing profile, and saves to database.
//
// Return Value
// ------------
// Promise<Profile>    Created profile entity
//
// Value Parameters
// ----------------
// uid       string              Firebase user ID
// data      CreateProfileDto    Profile data
//
// Reference Parameters
// --------------------
// None
//
// Local Variables
// ---------------
// existing  Profile|null    Existing profile if found
// profile   Profile         New profile entity
//
//*******************************************************************
async createProfile(uid: string, data: CreateProfileDto): Promise<Profile> {
  // Implementation
}
```

## Best Practices

### Type Safety

- Always use TypeScript types and interfaces
- Use DTOs for request/response validation
- Leverage TypeORM's type safety

### Error Handling

- Use NestJS built-in exceptions (`NotFoundException`, `BadRequestException`, etc.)
- Wrap database operations in try/catch
- Provide meaningful error messages

```typescript
import { NotFoundException } from '@nestjs/common';

async findOne(id: string): Promise<Entity> {
  const entity = await this.repository.findOne({ where: { id } });
  if (!entity) {
    throw new NotFoundException(`Entity with ID ${id} not found`);
  }
  return entity;
}
```

### Validation

Use `class-validator` decorators in DTOs:

```typescript
import { IsString, IsEmail, IsOptional } from 'class-validator';

export class CreateUserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
```

### Performance

- Use database indexes for frequently queried fields
- Implement caching for expensive operations
- Use pagination for list endpoints
- Optimize database queries (avoid N+1 problems)

### Security

- All routes are protected by `FirebaseAuthGuard` (applied globally)
- Validate all user input via DTOs
- Use parameterized queries (TypeORM handles this)
- Sanitize file uploads
- Rate limit sensitive endpoints

### Code Organization

- Keep modules focused on a single feature
- Extract reusable logic into services
- Use DTOs for data validation
- Keep controllers thin (delegate to services)

## Troubleshooting

### Service Not Found

Ensure the service is:
1. Marked with `@Injectable()` decorator
2. Added to the module's `providers` array
3. The module is imported where needed

### Database Connection Issues

1. Check environment variables (`DB_HOST`, `DB_USER`, etc.)
2. Verify PostgreSQL is running
3. Check database exists
4. Verify credentials

### Firebase Authentication Issues

1. Ensure Firebase Admin SDK is initialized
2. Check `GOOGLE_APPLICATION_CREDENTIALS` environment variable
3. Verify Firebase project configuration

### Redis Connection Issues

1. Check `REDIS_HOST` and `REDIS_PORT` environment variables
2. Verify Redis server is running
3. Check network connectivity

### TypeORM Migration Issues

1. Ensure database connection is working
2. Check migration files are in correct directory
3. Verify entity definitions match database schema

## Additional Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [TypeORM Documentation](https://typeorm.io/)
- [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup)
- [Socket.IO Documentation](https://socket.io/docs/v4/)
- [Redis Documentation](https://redis.io/docs/)
- [AWS S3 SDK](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-examples.html)

