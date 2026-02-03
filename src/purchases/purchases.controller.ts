//********************************************************************
//
// PurchasesController Class
//
// Controller for in-app purchase endpoints. Handles receipt verification
// and purchase restoration. All endpoints require authentication.
//
// Return Value
// ------------
// None (NestJS controller class)
//
// Value Parameters
// ----------------
// None
//
// Reference Parameters
// --------------------
// None
//
// Local Variables
// ---------------
// purchases    PurchasesService    Injected purchases service
//
//*******************************************************************

import { Controller, Post, Body } from "@nestjs/common";
import { AuthUser } from "../auth/auth-user.decorator";
import { PurchasesService } from "./purchases.service";
import { IsString, IsNotEmpty } from "class-validator";
import { UsersService } from "../users/users.service";
import { Public } from "../auth/decorators/public.decorator";

class VerifyPurchaseDto {
  @IsString()
  @IsNotEmpty()
  platform: "ios" | "android";

  @IsString()
  @IsNotEmpty()
  receipt: string;
}

class AppleServerNotificationDto {
  @IsString()
  @IsNotEmpty()
  signedPayload: string;
}

@Controller("purchases")
export class PurchasesController {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly users: UsersService,
  ) {}

  //********************************************************************
  //
  // verifyPurchase Method
  //
  // POST /purchases/verify endpoint. Validates receipt and grants tokens.
  //
  // Return Value
  // ------------
  // Promise<Purchase>    Saved purchase entity
  //
  // Value Parameters
  // ----------------
  // user    Object          Authenticated Firebase user
  //   uid     string            Firebase UID
  // body    VerifyPurchaseDto Receipt data
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // userEntity    User|null    User entity from database
  //
  //*******************************************************************
  @Post("verify")
  async verifyPurchase(
    @AuthUser() user: { uid: string },
    @Body() body: VerifyPurchaseDto,
  ) {
    const userEntity = await this.users.getByUid(user.uid);
    if (!userEntity) throw new Error("User not found");

    return this.purchases.verifyPurchase(
      userEntity.id,
      body.platform,
      body.receipt,
    );
  }

  //********************************************************************
  //
  // restorePurchases Method
  //
  // POST /purchases/restore endpoint. Restores active subscriptions
  // and unused consumables based on store account (Apple or Google).
  // Queries purchases by store + storePurchaseIdentifier to support
  // restoration after account deletion. Required for Apple App Store compliance.
  //
  // Return Value
  // ------------
  // Promise<Purchase[]>    Array of restored purchases
  //
  // Value Parameters
  // ----------------
  // user    Object          Authenticated Firebase user
  //   uid     string            Firebase UID
  // body    RestorePurchaseDto Receipt data to identify store account
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // userEntity    User|null    User entity from database
  //
  //*******************************************************************
  @Post("restore")
  async restorePurchases(
    @AuthUser() user: { uid: string },
    @Body() body: VerifyPurchaseDto,
  ) {
    const userEntity = await this.users.getByUid(user.uid);
    if (!userEntity) throw new Error("User not found");

    return this.purchases.restorePurchases(
      userEntity.id,
      body.platform,
      body.receipt,
    );
  }

  //********************************************************************
  //
  // appleServerNotification Method
  //
  // POST /purchases/webhook/apple endpoint. Handles App Store
  // Server Notifications v2. Verifies signedPayload and revokes
  // entitlements on refund/revoke events.
  //
  //*******************************************************************
  @Public()
  @Post("webhook/apple")
  async appleServerNotification(@Body() body: AppleServerNotificationDto) {
    await this.purchases.handleAppleServerNotification(body.signedPayload);
    return { ok: true };
  }
}
