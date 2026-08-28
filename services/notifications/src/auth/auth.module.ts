import { Module } from "@nestjs/common";
import { TokenVerifierService } from "./token-verifier.service";

@Module({
  providers: [TokenVerifierService],
  exports: [TokenVerifierService],
})
export class AuthModule {}
