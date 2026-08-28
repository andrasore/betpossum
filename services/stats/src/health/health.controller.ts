import { Controller, Get } from "@nestjs/common";
import { Public } from "../common/public.decorator";

@Controller("health")
export class HealthController {
  // Public: this is the container healthcheck endpoint, which carries no token.
  @Public()
  @Get()
  health(): { status: string } {
    return { status: "ok" };
  }
}
