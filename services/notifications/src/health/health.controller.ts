import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  // Unauthenticated on purpose: this is the container healthcheck endpoint.
  @Get()
  health(): { status: string } {
    return { status: "ok" };
  }
}
