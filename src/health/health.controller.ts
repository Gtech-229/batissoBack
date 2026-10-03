import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponse } from '../common/errors/error-response.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { HealthResponse } from './health-response.js';

@ApiTags('Santé')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: 'Vérifier l’état de l’API',
    description:
      'Indique si l’API répond et si elle peut joindre la base de données.',
  })
  @ApiOkResponse({
    description: 'API et base de données opérationnelles',
    type: HealthResponse,
  })
  @ApiServiceUnavailableResponse({
    description: 'Base de données injoignable',
    type: ErrorResponse,
  })
  async check(): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.warn(`Database check failed: ${String(error)}`);
      throw new ServiceUnavailableException('Base de données indisponible');
    }

    return {
      status: 'ok',
      database: 'up',
      timestamp: new Date().toISOString(),
    };
  }
}
