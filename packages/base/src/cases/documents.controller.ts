import { type CaseDetail, DocumentType, Role } from "@loan/core";
import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser, Roles } from "../auth/auth.decorators";
import type { SessionUser } from "../auth/session";
import { DocumentsService } from "./documents.service";
import { DocumentReviewDto, InfoRequestDto } from "./dto";

/**
 * Requests for information and the document checklist (PRD WF-007, DOC-003). Only the loan
 * officer acts here; the service checks the case's state under its lock.
 */
@ApiTags("cases")
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post("cases/:id/info-request")
  @Roles(Role.LoanOfficer)
  @HttpCode(200)
  requestInfo(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: InfoRequestDto,
  ): Promise<CaseDetail> {
    return this.documents.requestInfo(user, id, body);
  }

  /** The borrower's upload, simulated: synthetic metadata only, labelled simulated. */
  @Post("cases/:id/documents/:type/upload")
  @Roles(Role.LoanOfficer)
  @HttpCode(200)
  simulateUpload(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("type", new ParseEnumPipe(DocumentType)) type: DocumentType,
  ): Promise<CaseDetail> {
    return this.documents.simulateUpload(user, id, type);
  }

  @Post("cases/:id/documents/:type/review")
  @Roles(Role.LoanOfficer)
  @HttpCode(200)
  review(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("type", new ParseEnumPipe(DocumentType)) type: DocumentType,
    @Body() body: DocumentReviewDto,
  ): Promise<CaseDetail> {
    return this.documents.review(user, id, type, body);
  }
}
