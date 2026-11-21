import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn } from 'class-validator';
import type { ImportFormat } from '../import/store-import-template.js';

const IMPORT_FORMATS: readonly ImportFormat[] = ['csv', 'xlsx'];

export class ImportTemplateQueryDto {
  @ApiProperty({
    enum: IMPORT_FORMATS,
    description: 'Format du modèle : csv (séparateur ;) ou xlsx',
    example: 'xlsx',
  })
  @IsIn(IMPORT_FORMATS, { message: 'Le format doit être csv ou xlsx' })
  format: ImportFormat;
}

export class StoreImportQueryDto {
  @ApiProperty({
    description:
      'true : vérifie chaque ligne sans rien créer ; false : crée chaque ligne valide',
    example: true,
  })
  // Only the two exact words: "1", "yes" or an empty value stay strings and
  // fail, so an import never runs by accident.
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean({ message: 'dryRun doit valoir true ou false' })
  dryRun: boolean;
}

/** The multipart body, for Swagger only (multer reads it). */
export class StoreImportFileBody {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'Le fichier .csv (UTF-8, séparateur ; ou ,) ou .xlsx (première feuille), 2 Mo et 500 lignes au plus',
  })
  file: unknown;
}

export class StoreImportRowError {
  @ApiProperty({
    description:
      'Colonne en erreur (même nom que dans le fichier) ; vide pour un refus de la ligne entière',
    example: 'manager.phone',
  })
  field: string;

  @ApiProperty({
    description: 'Message en français',
    example: 'Ce numéro n’est pas un numéro valide du pays ML',
  })
  message: string;
}

export type StoreImportRowStatus = 'valid' | 'created' | 'invalid' | 'rejected';

export class StoreImportRow {
  @ApiProperty({
    description: 'Numéro de ligne du fichier (l’en-tête est la ligne 1)',
    example: 2,
  })
  row: number;

  @ApiProperty({
    enum: ['valid', 'created', 'invalid', 'rejected'],
    description:
      'valid : correcte (essai) ; created : quincaillerie créée ; invalid : refusée par les vérifications ; rejected : correcte mais refusée à la création',
  })
  status: StoreImportRowStatus;

  @ApiPropertyOptional({
    description: 'Identifiant de la quincaillerie créée (status created)',
    format: 'uuid',
  })
  storeId?: string;

  @ApiProperty({
    type: [StoreImportRowError],
    description: 'Erreurs de la ligne ; vide quand elle est valid ou created',
  })
  errors: StoreImportRowError[];
}

export class StoreImportResult {
  @ApiProperty({ description: 'Lignes lues (hors en-tête)', example: 3 })
  total: number;

  @ApiProperty({
    description: 'Quincailleries créées (0 en essai)',
    example: 2,
  })
  created: number;

  @ApiProperty({
    description: 'Lignes non créées : invalid + rejected',
    example: 1,
  })
  rejected: number;

  @ApiProperty({ type: [StoreImportRow] })
  rows: StoreImportRow[];
}
