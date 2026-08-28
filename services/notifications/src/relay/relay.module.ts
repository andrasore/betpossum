import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RelayGateway } from "./relay.gateway";
import { RelayService } from "./relay.service";

@Module({
  imports: [AuthModule],
  providers: [RelayGateway, RelayService],
})
export class RelayModule {}
