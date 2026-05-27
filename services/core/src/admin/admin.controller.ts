import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from "@nestjs/common";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { AdminService } from "./admin.service";
import { SetBalanceDto } from "./dto/set-balance.dto";

@Controller("admin")
@UseGuards(RolesGuard)
@Roles("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("users")
  listUsers() {
    return this.admin.listUsers();
  }

  @Put("users/:userId/balance")
  async setBalance(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() dto: SetBalanceDto,
  ) {
    await this.admin.setUserBalance(userId, dto.amount);
    return { status: "ok" };
  }
}
