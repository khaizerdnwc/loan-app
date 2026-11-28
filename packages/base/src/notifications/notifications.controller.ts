import {
  type BorrowerMessageView,
  Role,
  type StaffNotificationList,
  type StaffNotificationView,
} from "@loan/core";
import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser, Roles } from "../auth/auth.decorators";
import type { SessionUser } from "../auth/session";
import { NotificationReadsService } from "./notification-reads.service";

/** The roles that read cases (cases.controller.ts); each sees only the cases it can see. */
const CASE_READERS = [
  Role.LoanOfficer,
  Role.Approver,
  Role.LoanOperations,
  Role.LoanOperationsSupervisor,
  Role.Compliance,
];

/** Staff alerts (PRD NTF-002) and a case's borrower-message log (NTF-001, NTF-003). */
@ApiTags("notifications")
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly reads: NotificationReadsService) {}

  /** The caller's alerts (addressed to them, or to their role), newest first. */
  @Get()
  @Roles(...Object.values(Role))
  list(@CurrentUser() user: SessionUser): Promise<StaffNotificationList> {
    return this.reads.list(user);
  }

  @Post(":id/read")
  @Roles(...Object.values(Role))
  @HttpCode(200)
  markRead(
    @CurrentUser() user: SessionUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<StaffNotificationView> {
    return this.reads.markRead(user, id);
  }

  /** The messages sent (or waiting) to a case's borrower, newest first. */
  @Get("cases/:id")
  @Roles(...CASE_READERS)
  messages(
    @CurrentUser() user: SessionUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<BorrowerMessageView[]> {
    return this.reads.messages(user, id);
  }
}
