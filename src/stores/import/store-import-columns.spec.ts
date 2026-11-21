import { getMetadataStorage } from 'class-validator';
import {
  RegisterStoreDto,
  StoreManagerInput,
  StoreSettingsInput,
} from '../dto/register-store.dto.js';
import { STORE_IMPORT_COLUMNS } from './store-import-columns.js';

/** Every validated property of a DTO class, and whether it is optional. */
function fieldsOf(target: new () => object, prefix = '') {
  const metadata = getMetadataStorage().getTargetValidationMetadatas(
    target,
    '',
    false,
    false,
  );
  const fields = new Map<string, boolean>();
  for (const entry of metadata) {
    // @IsOptional and the "omitted keeps the default" @ValidateIf.
    const optional = entry.type === 'conditionalValidation';
    const name = `${prefix}${entry.propertyName}`;
    fields.set(name, (fields.get(name) ?? false) || optional);
  }
  return fields;
}

describe('STORE_IMPORT_COLUMNS', () => {
  it('has one column per RegisterStoreDto field, nested objects flattened', () => {
    const fields = new Map([
      ...fieldsOf(RegisterStoreDto),
      ...fieldsOf(StoreSettingsInput, 'settings.'),
      ...fieldsOf(StoreManagerInput, 'manager.'),
    ]);
    // The two nested objects are columns' prefixes, not columns.
    fields.delete('settings');
    fields.delete('manager');

    expect(STORE_IMPORT_COLUMNS.map((column) => column.name).sort()).toEqual(
      [...fields.keys()].sort(),
    );
    for (const column of STORE_IMPORT_COLUMNS) {
      expect({ name: column.name, required: column.required }).toEqual({
        name: column.name,
        required: !fields.get(column.name),
      });
    }
  });

  it('lists every column once', () => {
    const names = STORE_IMPORT_COLUMNS.map((column) => column.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
