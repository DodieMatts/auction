import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";

import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const host = configService.getOrThrow<string>("HOST");
  const port = configService.getOrThrow<number>("PORT");

  app.setGlobalPrefix("api");
  app.enableShutdownHooks();

  await app.listen(port, host);
  console.log(`Auction API listening on http://${host}:${port}/api`);
}

void bootstrap().catch((error: unknown) => {
  if (
    error instanceof Error &&
    error.message.includes("Config validation error")
  ) {
    console.error("Auction API failed to start due to configuration validation");
  } else {
    console.error("Auction API failed to start");
  }

  process.exit(1);
});
