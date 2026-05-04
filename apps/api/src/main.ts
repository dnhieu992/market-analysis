import 'reflect-metadata';
import { resolve } from 'path';
import { config } from 'dotenv';

// Load .env from repo root (cwd is set to repo root by pm2/node)
config({ path: resolve(process.cwd(), '.env') });

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const rawOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:3001';
  const allowedOrigins = rawOrigin.split(',').map((o) => o.trim());
  app.enableCors({
    origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  const config = new DocumentBuilder()
    .setTitle('Market Analysis API')
    .setDescription('API for market analysis, back-testing strategies, orders, signals, and daily plans')
    .setVersion('1.0')
    .addCookieAuth('market_analysis_session')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`API listening on port ${port}`, 'Bootstrap');
  Logger.log(`Swagger docs available at http://localhost:${port}/api/docs`, 'Bootstrap');
  const apiKey = (process.env.CLAUDE_API_KEY ?? '').trim();
  const rawLen = (process.env.CLAUDE_API_KEY ?? '').length;
  Logger.log(`CLAUDE_API_KEY: ${apiKey ? `${apiKey.slice(0, 10)}...${apiKey.slice(-4)} (length: ${apiKey.length}, raw: ${rawLen})` : 'NOT SET'}`, 'Bootstrap');
}

void bootstrap();
