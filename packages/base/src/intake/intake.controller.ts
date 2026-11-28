import {
  type CaseExtractionsView,
  DocumentType,
  type IntakeDraftView,
  type IntakeUploadView,
  Role,
} from "@loan/core";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser, Roles } from "../auth/auth.decorators";
import type { SessionUser } from "../auth/session";
import { ExtractionService } from "./extraction.service";
import {
  ConfirmIntakeDraftDto,
  DiscardIntakeDraftDto,
  IntakeListQueryDto,
  IntakeUploadDto,
} from "./intake.dto";
import { IntakeService } from "./intake.service";

/** Compliance reads intake drafts; only the loan officer acts on them. */
const INTAKE_READERS = [Role.LoanOfficer, Role.Compliance];
/** Who reviews a case's documents and may read their OCR readings. */
const READING_READERS = [Role.LoanOfficer, Role.Approver, Role.Compliance];

/**
 * Email and file intake with OCR (PRD INT-010, F4) and OCR and statement analysis on a case's
 * documents (PRD DOC-002, DOC-007). Every extraction is simulated; nothing here submits an
 * application or changes a decision. The services check the role again and the state under
 * a lock.
 */
@ApiTags("intake")
@Controller()
export class IntakeController {
  constructor(
    private readonly intake: IntakeService,
    private readonly extraction: ExtractionService,
  ) {}

  @Get("intake/drafts")
  @Roles(...INTAKE_READERS)
  list(
    @CurrentUser() user: SessionUser,
    @Query() q: IntakeListQueryDto,
  ): Promise<IntakeDraftView[]> {
    return this.intake.list(user, q.view ?? "pending");
  }

  @Get("intake/drafts/:id")
  @Roles(...INTAKE_READERS)
  get(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<IntakeDraftView> {
    return this.intake.get(user, id);
  }

  /** Upload a synthetic file (simulated) and read it with OCR into drafts for review. */
  @Post("intake/uploads")
  @Roles(Role.LoanOfficer)
  @HttpCode(201)
  upload(
    @CurrentUser() user: SessionUser,
    @Body() body: IntakeUploadDto,
  ): Promise<IntakeUploadView> {
    return this.intake.upload(user, body.source);
  }

  @Post("intake/drafts/:id/confirm")
  @Roles(Role.LoanOfficer)
  @HttpCode(200)
  confirm(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: ConfirmIntakeDraftDto,
  ): Promise<IntakeDraftView> {
    return this.intake.confirm(user, id, body);
  }

  @Post("intake/drafts/:id/discard")
  @Roles(Role.LoanOfficer)
  @HttpCode(200)
  discard(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: DiscardIntakeDraftDto,
  ): Promise<IntakeDraftView> {
    return this.intake.discard(user, id, body);
  }

  @Get("cases/:id/extractions")
  @Roles(...READING_READERS)
  readings(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<CaseExtractionsView> {
    return this.extraction.forCase(user, id);
  }

  /** Read a received document with OCR (simulated): figures, statement analysis, flags. */
  @Post("cases/:id/documents/:type/extract")
  @Roles(Role.LoanOfficer)
  @HttpCode(200)
  extract(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("type", new ParseEnumPipe(DocumentType)) type: DocumentType,
  ): Promise<CaseExtractionsView> {
    return this.extraction.extract(user, id, type);
  }
}
