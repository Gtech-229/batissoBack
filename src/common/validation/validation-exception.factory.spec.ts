import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import {
  toValidationDetails,
  validationExceptionFactory,
} from './validation-exception.factory.js';

const body = { phone: '', pin: '1234' };

function error(partial: Partial<ValidationError>): ValidationError {
  return {
    target: body,
    value: undefined,
    children: [],
    ...partial,
  } as ValidationError;
}

describe('toValidationDetails', () => {
  it('keeps only field names and messages', () => {
    const details = toValidationDetails([
      error({
        property: 'phone',
        value: '',
        constraints: {
          isNotEmpty: 'Le numéro de téléphone est requis',
          isPhoneNumber: 'Le numéro de téléphone est invalide',
        },
      }),
    ]);

    expect(details).toEqual([
      {
        field: 'phone',
        errors: [
          'Le numéro de téléphone est requis',
          'Le numéro de téléphone est invalide',
        ],
      },
    ]);
  });

  it('never exposes the submitted body or rejected values', () => {
    const details = toValidationDetails([
      error({
        property: 'pin',
        value: '1234',
        constraints: { length: 'PIN invalide' },
      }),
    ]);

    expect(JSON.stringify(details)).not.toContain('1234');
  });

  it('flattens nested errors into dotted paths, including array indexes', () => {
    const details = toValidationDetails([
      error({
        property: 'lines',
        children: [
          error({
            property: '0',
            children: [
              error({
                property: 'quantity',
                constraints: { min: 'La quantité doit être positive' },
              }),
            ],
          }),
        ],
      }),
    ]);

    expect(details).toEqual([
      { field: 'lines.0.quantity', errors: ['La quantité doit être positive'] },
    ]);
  });

  it('translates the forbidden-property message to French', () => {
    const details = toValidationDetails([
      error({
        property: 'role',
        constraints: { whitelistValidation: 'property role should not exist' },
      }),
    ]);

    expect(details).toEqual([
      { field: 'role', errors: ["Ce champ n'est pas autorisé"] },
    ]);
  });

  it('lists a message shared by two constraints only once', () => {
    const details = toValidationDetails([
      error({
        property: 'settings',
        constraints: {
          isObject: 'Paramètres requis, sous forme d’objet',
          nestedValidation: 'Paramètres requis, sous forme d’objet',
        },
      }),
    ]);

    expect(details).toEqual([
      { field: 'settings', errors: ['Paramètres requis, sous forme d’objet'] },
    ]);
  });
});

describe('validationExceptionFactory', () => {
  it('returns a BadRequestException carrying the French message and details', () => {
    const exception = validationExceptionFactory([
      error({ property: 'phone', constraints: { isNotEmpty: 'Requis' } }),
    ]);

    expect(exception).toBeInstanceOf(BadRequestException);
    expect(exception.getResponse()).toEqual({
      message: 'Données invalides',
      details: [{ field: 'phone', errors: ['Requis'] }],
    });
  });
});
