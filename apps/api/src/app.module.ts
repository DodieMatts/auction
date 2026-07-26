import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { environmentValidationSchema } from "./config/environment.validation";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
