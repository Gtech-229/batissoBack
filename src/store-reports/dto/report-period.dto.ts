import { ApiProperty } from '@nestjs/swagger';
import { IsDay } from '../../common/validation/day.js';

export class ReportPeriodDto {
  @ApiProperty({
    description: 'Premier jour de la période, inclus (AAAA-MM-JJ, UTC)',
    example: '2026-10-01',
  })
  @IsDay()
  from: string;

  @ApiProperty({
    description:
      'Dernier jour de la période, inclus (AAAA-MM-JJ, UTC). Un an au plus.',
    example: '2026-10-31',
  })
  @IsDay()
  to: string;
}
