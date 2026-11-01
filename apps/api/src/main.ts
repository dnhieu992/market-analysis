import 'reflect-metadata';
import { resolve } from 'path';
import { config } from 'dotenv';

// __dirname = dist/apps/api/src → go up 6 levels to reach repo root
config({ path: resolve(__dirname, '../../../../../../.env') });

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

  // Swagger is opt-in: on the server the API sits behind /api-proxy and its
  // route map is nobody's business.
  if (process.env.SWAGGER_ENABLED === 'true') {
    const config = new DocumentBuilder()
      .setTitle('Market Analysis API')
      .setDescription('API for market analysis, back-testing strategies, orders, signals, and daily plans')
      .setVersion('1.0')
      .addCookieAuth('market_analysis_session')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = Number(process.env.PORT ?? 3000);
  // Localhost only by default — the web app reaches the API through its
  // /api-proxy rewrite, so the port never needs to face the internet.
  const host = process.env.API_HOST ?? '127.0.0.1';
  await app.listen(port, host);
  Logger.log(`API listening on ${host}:${port}`, 'Bootstrap');
  if (process.env.SWAGGER_ENABLED === 'true') {
    Logger.log(`Swagger docs available at http://localhost:${port}/api/docs`, 'Bootstrap');
  }
  Logger.log(`CLAUDE_API_KEY: ${(process.env.CLAUDE_API_KEY ?? '').trim() ? 'set' : 'NOT SET'}`, 'Bootstrap');
}

void bootstrap();
