import { Controller, Get } from "@nestjs/common";

import { Public } from "../auth/decorators/public.decorator";
import { HealthService } from "./health.service";

@Public()
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
