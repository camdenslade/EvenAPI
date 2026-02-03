//********************************************************************
//
// SecretsModule Class
//
// Module that provides the SecretsService for fetching secrets from
// AWS Secrets Manager with fallback to environment variables.
//
//*******************************************************************

import { Module, Global } from "@nestjs/common";
import { SecretsService } from "./secrets.service";

@Global()
@Module({
  providers: [SecretsService],
  exports: [SecretsService],
})
export class SecretsModule {}
