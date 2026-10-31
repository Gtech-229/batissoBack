import { applyDecorators, Header, StreamableFile } from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiProduces,
} from '@nestjs/swagger';

/** The multipart body of an upload: one image in the field `photo`. */
export function ApiProofUpload(): MethodDecorator {
  return applyDecorators(
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: ['photo'],
        properties: {
          photo: {
            type: 'string',
            format: 'binary',
            description: 'Image JPEG ou PNG, au plus 5 Mo',
          },
        },
      },
    }),
  );
}

/** The answer of a file route: never cached, never sniffed as another type. */
export function ProofFileResponse(): MethodDecorator {
  return applyDecorators(
    Header('Cache-Control', 'no-store'),
    Header('X-Content-Type-Options', 'nosniff'),
    ApiProduces('image/jpeg', 'image/png'),
    ApiOkResponse({
      description: 'L’image',
      content: {
        'image/jpeg': { schema: { type: 'string', format: 'binary' } },
        'image/png': { schema: { type: 'string', format: 'binary' } },
      },
    }),
  );
}

/** Bytes already in memory: nothing can fail once the answer has started. */
export function toProofFile(file: {
  content: Buffer;
  contentType: string;
}): StreamableFile {
  return new StreamableFile(file.content, {
    type: file.contentType,
    disposition: 'inline',
  });
}
