import { ApiProperty, PickType } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ReportPeriodDto } from './report-period.dto.js';
import { CustomersQueryDto } from './report-views.js';

export const EXPORT_FORMATS = ['pdf', 'xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

const FORMAT_MESSAGE = 'Le format doit être pdf ou xlsx';

export class ExportPeriodDto extends ReportPeriodDto {
  @ApiProperty({
    description: 'Format du fichier',
    enum: EXPORT_FORMATS,
    example: 'xlsx',
  })
  @IsIn(EXPORT_FORMATS, { message: FORMAT_MESSAGE })
  format: ExportFormat;
}

export class ExportCustomersDto extends PickType(CustomersQueryDto, [
  'status',
] as const) {
  @ApiProperty({
    description: 'Format du fichier',
    enum: EXPORT_FORMATS,
    example: 'xlsx',
  })
  @IsIn(EXPORT_FORMATS, { message: FORMAT_MESSAGE })
  format: ExportFormat;
}
