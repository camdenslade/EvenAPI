import { Body, Controller, Post } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { Public } from "../auth/decorators/public.decorator";
import { AdminLoginDto } from "./dto/admin-login.dto";

@Controller("admin")
export class AdminAuthController {
  constructor(private readonly adminService: AdminService) {}

  @Public()
  @Post("login")
  async login(@Body() dto: AdminLoginDto) {
    return this.adminService.adminLoginWithPassword(dto);
  }
}
