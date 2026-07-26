import { Controller, Get } from "@nestjs/common";

import { HealthService } from "./health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get("live")
  checkLiveness() {
    return this.healthService.checkLiveness();
  }

  @Get("ready")
  checkReadiness() {
    return this.healthService.checkReadiness();
  }
}
