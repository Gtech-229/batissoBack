import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';
import {
  PERMISSION_NAMES,
  type Permission,
} from '../../admin-auth/permissions.js';
import { Trim } from '../../common/validation/trim.js';

const NAME_MESSAGE = 'Le nom du rôle doit contenir 1 à 60 caractères';
const PERMISSIONS_MESSAGE = 'Les permissions doivent être une liste';
const UNKNOWN_PERMISSION = `Permission inconnue : valeurs possibles ${PERMISSION_NAMES.join(', ')}`;

export class CreateRoleDto {
  @ApiProperty({ description: 'Nom du rôle', example: 'Support' })
  @Trim()
  @IsString({ message: NAME_MESSAGE })
  @Length(1, 60, { message: NAME_MESSAGE })
  name: string;

  @ApiProperty({
    description: 'Les permissions du rôle (voir `GET /admin/permissions`)',
    enum: PERMISSION_NAMES,
    isArray: true,
    example: ['countries.read', 'stores.read'],
  })
  @IsArray({ message: PERMISSIONS_MESSAGE })
  @ArrayUnique({ message: 'Une permission figure deux fois' })
  @IsIn(PERMISSION_NAMES, { each: true, message: UNKNOWN_PERMISSION })
  permissions: Permission[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ description: 'Nouveau nom', example: 'Support' })
  // Optional when omitted, but null is refused (F-33): @IsOptional() would let
  // null through to Prisma, which answers 500.
  @ValidateIf((_object, value) => value !== undefined)
  @Trim()
  @IsString({ message: NAME_MESSAGE })
  @Length(1, 60, { message: NAME_MESSAGE })
  name?: string;

  @ApiPropertyOptional({
    description:
      'Les nouvelles permissions : elles remplacent les précédentes et s’appliquent dès la requête suivante de chaque administrateur du rôle',
    enum: PERMISSION_NAMES,
    isArray: true,
  })
  // Optional when omitted, but null is refused (F-33): @IsOptional() would let
  // null through to Prisma, which answers 500.
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: PERMISSIONS_MESSAGE })
  @ArrayUnique({ message: 'Une permission figure deux fois' })
  @IsIn(PERMISSION_NAMES, { each: true, message: UNKNOWN_PERMISSION })
  permissions?: Permission[];
}

export class AssignRoleDto {
  @ApiProperty({
    description: 'Identifiant du rôle à donner',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  @IsUUID(undefined, { message: 'Identifiant de rôle invalide' })
  roleId: string;
}

export class RoleView {
  @ApiProperty({
    description: 'Identifiant du rôle',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  id: string;

  @ApiProperty({ description: 'Nom', example: 'Administrateur' })
  name: string;

  @ApiProperty({
    description: 'Permissions',
    enum: PERMISSION_NAMES,
    isArray: true,
  })
  permissions: Permission[];

  @ApiProperty({ description: 'Nombre d’administrateurs du rôle', example: 3 })
  adminCount: number;
}

export class PermissionView {
  @ApiProperty({ description: 'Nom', example: 'stores.read' })
  name: Permission;

  @ApiProperty({
    description: 'Ce qu’elle permet',
    example: 'Voir les quincailleries',
  })
  label: string;
}
