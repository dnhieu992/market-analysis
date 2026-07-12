import { Global, Module } from '@nestjs/common';

import { StorageService } from './storage.service';
import { R2UploadController } from './upload.controller';

// Global so any feature module can inject StorageService without re-importing.
@Global()
@Module({
  providers: [StorageService],
  controllers: [R2UploadController],
  exports: [StorageService]
})
export class StorageModule {}
