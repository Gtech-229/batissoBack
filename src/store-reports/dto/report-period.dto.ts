import { ApiProperty } from '@nestjs/swagger';
import { ValidateBy } from 'class-validator';
import { isDay } from '../period-range.js';

const DAY_MESSAGE = 'La date doit être au format AAAA-MM-JJ';

function IsDay(): PropertyDecorator {
  return ValidateBy({
    name: 'isDay',
    validator: {
      validate: (value) => isDay(value),
      defaultMessage: () => DAY_MESSAGE,
    },
  });
}

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
