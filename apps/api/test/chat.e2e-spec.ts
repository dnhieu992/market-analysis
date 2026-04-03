import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { ChatController } from '../src/modules/chat/chat.controller';
import { ChatProvider } from '../src/modules/chat/contracts/chat-provider';
import { ChatToolRegistry } from '../src/modules/chat/contracts/chat-tool-registry';
import { ChatRequestDto } from '../src/modules/chat/dto/chat-request.dto';

describe('chat endpoint', () => {
  let app: INestApplication;
  let validationPipe: ValidationPipe;

  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      imports: [AppModule]
    });

    moduleBuilder
      .overrideProvider(ChatProvider)
      .useValue({
        chat: jest.fn().mockResolvedValue({
          reply: 'Hello there.',
          model: 'gpt-4o-mini'
        })
      })
      .overrideProvider(ChatToolRegistry)
      .useValue({
        listTools: jest.fn().mockReturnValue([]),
        getTool: jest.fn()
      });

    const moduleRef = await moduleBuilder.compile();

    app = moduleRef.createNestApplication();
    validationPipe = new ValidationPipe({ whitelist: true, transform: true });
    app.useGlobalPipes(validationPipe);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a JSON reply for a valid message list', async () => {
    const controller = app.get(ChatController);
    const body = await validationPipe.transform(
      {
        messages: [
          {
            role: 'user',
            content: 'Hello'
          }
        ]
      },
      {
        type: 'body',
        metatype: ChatRequestDto
      }
    );

    await expect(controller.chat(body)).resolves.toEqual({
      reply: 'Hello there.',
      model: 'gpt-4o-mini'
    });
  });

  it('rejects blank message content through DTO validation', async () => {
    await expect(
      validationPipe.transform(
        {
          messages: [
            {
              role: 'user',
              content: ''
            }
          ]
        },
        {
          type: 'body',
          metatype: ChatRequestDto
        }
      )
    ).rejects.toMatchObject({
      response: {
        message: expect.arrayContaining([expect.stringContaining('content should not be empty')])
      }
    });
  });
});
