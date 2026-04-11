import type { Provider } from '@nestjs/common';
import { createBackTestResultRepository } from '@app/db';

export const BACK_TEST_RESULT_REPOSITORY = Symbol('BACK_TEST_RESULT_REPOSITORY');

export const BackTestProviders: Provider[] = [
  {
    provide: BACK_TEST_RESULT_REPOSITORY,
    useFactory: () => createBackTestResultRepository()
  }
];
