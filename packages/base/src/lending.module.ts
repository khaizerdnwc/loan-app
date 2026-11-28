import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditController } from "./audit/audit.controller";
import { AuditRepository } from "./audit/audit.repository";
import { AuditService } from "./audit/audit.service";
import { AuthController } from "./auth/auth.controller";
import { SessionGuard } from "./auth/session.guard";
import { StaffEntity } from "./auth/staff.entity";
import { StaffRepository } from "./auth/staff.repository";
import { AutomationController } from "./automation/automation.controller";
import { ProductAutomationEntity } from "./automation/automation.entities";
import { AutomationRepository } from "./automation/automation.repository";
import { AutomationService } from "./automation/automation.service";
import { ActivityService } from "./cases/activity.service";
import { ApplicantsService } from "./cases/applicants.service";
import { BookingService } from "./cases/booking.service";
import { CaseViews } from "./cases/case-views";
import { CasesController } from "./cases/cases.controller";
import { CasesRepository } from "./cases/cases.repository";
import { CasesService } from "./cases/cases.service";
import { DecisionService } from "./cases/decision.service";
import { DocumentsController } from "./cases/documents.controller";
import { DocumentsService } from "./cases/documents.service";
import { ApplicantEntity } from "./cases/entities/applicant.entity";
import { LoanCaseEntity } from "./cases/entities/loan-case.entity";
import { ExpiryService } from "./cases/expiry.service";
import { RoutingController } from "./cases/routing.controller";
import { RoutingService } from "./cases/routing.service";
import { ComplianceController } from "./compliance/compliance.controller";
import { ComplianceRepository } from "./compliance/compliance.repository";
import { ComplianceService } from "./compliance/compliance.service";
import { TransactionRunner } from "./database/transaction-runner";
import { LENDING_OPTIONS, type LendingModuleOptions } from "./lending.options";
import { OperationsController } from "./operations/operations.controller";
import { OperationsRepository } from "./operations/operations.repository";
import { OperationsService } from "./operations/operations.service";
import { ProviderGateway } from "./providers/provider-gateway.service";
import { ProvidersController } from "./providers/providers.controller";
import { ProvidersRepository } from "./providers/providers.repository";
import { ReportsController } from "./reports/reports.controller";
import { ReportsRepository } from "./reports/reports.repository";
import { ReportsService } from "./reports/reports.service";
import { SimulationController } from "./simulation/simulation.controller";
import { SlaController, TurnaroundController } from "./sla/sla.controller";
import { SlaRepository } from "./sla/sla.repository";
import { SlaService } from "./sla/sla.service";

export type { LendingModuleOptions };

/**
 * The lending domain as one Nest module: auth, cases (capture, decision, review, approval,
 * booking, history) and the simulation controls. The ports it needs (bureau, KYC/AML, core
 * banking, disbursement, e-signature, simulation control) are provided by whoever imports
 * it — the API's composition root binds the simulated providers.
 */
@Module({})
export class LendingModule {
  static register(options: LendingModuleOptions) {
    return {
      module: LendingModule,
      imports: [
        TypeOrmModule.forFeature([
          StaffEntity,
          ApplicantEntity,
          LoanCaseEntity,
          ProductAutomationEntity,
        ]),
        JwtModule.register({ secret: options.jwtSecret, signOptions: { algorithm: "HS256" } }),
      ],
      controllers: [
        AuthController,
        CasesController,
        DocumentsController,
        RoutingController,
        SimulationController,
        AuditController,
        ComplianceController,
        AutomationController,
        OperationsController,
        ReportsController,
        SlaController,
        TurnaroundController,
        ProvidersController,
      ],
      providers: [
        { provide: LENDING_OPTIONS, useValue: options },
        TransactionRunner,
        StaffRepository,
        CasesRepository,
        ActivityService,
        DecisionService,
        CaseViews,
        CasesService,
        ExpiryService,
        BookingService,
        DocumentsService,
        RoutingService,
        ApplicantsService,
        SessionGuard,
        AuditRepository,
        AuditService,
        ComplianceRepository,
        ComplianceService,
        AutomationRepository,
        AutomationService,
        OperationsRepository,
        OperationsService,
        ReportsRepository,
        ReportsService,
        SlaRepository,
        SlaService,
        ProvidersRepository,
        ProviderGateway,
      ],
      // ExpiryService: the API's composition root schedules the expiry sweep (expireStale).
      exports: [SessionGuard, JwtModule, ExpiryService],
    };
  }
}
