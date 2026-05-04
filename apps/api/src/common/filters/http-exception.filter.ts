import {
  Catch,
  HttpException,
  HttpStatus,
  Logger
} from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const req = context.getRequest<{ method: string; url: string }>();
    const response = context.getResponse<{
      status: (code: number) => { json: (body: unknown) => void };
    }>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json({
        statusCode: exception.getStatus(),
        error: exception.name,
        message: exception.message
      });
      return;
    }

    const message = exception instanceof Error ? exception.message : String(exception);
    this.logger.error(`${req.method} ${req.url} → ${message}`, exception instanceof Error ? exception.stack : undefined);

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'InternalServerError',
      message
    });
  }
}
