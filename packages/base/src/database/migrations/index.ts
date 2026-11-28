import { LendingSchema1764300000000 } from "./1764300000000-LendingSchema";
import { SimulatorsSchema1764300000001 } from "./1764300000001-SimulatorsSchema";
import { InsertOnlyRecords1764300000002 } from "./1764300000002-InsertOnlyRecords";
import { StaffSignIn1764300000003 } from "./1764300000003-StaffSignIn";
import { ConsentRecords1764300000004 } from "./1764300000004-ConsentRecords";
import { OneOpenApplication1764300000005 } from "./1764300000005-OneOpenApplication";
import { WithdrawAndExpiry1764300000006 } from "./1764300000006-WithdrawAndExpiry";
import { InfoRequestAndDocuments1764300001000 } from "./1764300001000-InfoRequestAndDocuments";
import { RoutingAndWalkIns1764300001001 } from "./1764300001001-RoutingAndWalkIns";
import { AuditLogAndAmlEscalations1764300002000 } from "./1764300002000-AuditLogAndAmlEscalations";
import { ReconciliationRuns1764300002001 } from "./1764300002001-ReconciliationRuns";
import { BusinessHolidays1764300002002 } from "./1764300002002-BusinessHolidays";
import { AutomationAndTriggers1764300003000 } from "./1764300003000-AutomationAndTriggers";
import { ProviderResilienceAndEstimates1764300003001 } from "./1764300003001-ProviderResilienceAndEstimates";
import { ForeignKeysAndTruncateGuards1764300009000 } from "./1764300009000-ForeignKeysAndTruncateGuards";

/**
 * Every migration, in order. Listed explicitly so the same list runs from src (tests) and
 * dist (deployments). A new migration is generated (`pnpm --filter @loan/api
 * db:migration:generate ../../packages/base/src/database/migrations/<Name>`), renamed to
 * the next timestamp in this list, and added here.
 */
export const MIGRATIONS = [
  LendingSchema1764300000000,
  SimulatorsSchema1764300000001,
  InsertOnlyRecords1764300000002,
  StaffSignIn1764300000003,
  ConsentRecords1764300000004,
  OneOpenApplication1764300000005,
  WithdrawAndExpiry1764300000006,
  InfoRequestAndDocuments1764300001000,
  RoutingAndWalkIns1764300001001,
  AuditLogAndAmlEscalations1764300002000,
  ReconciliationRuns1764300002001,
  BusinessHolidays1764300002002,
  AutomationAndTriggers1764300003000,
  ProviderResilienceAndEstimates1764300003001,
  ForeignKeysAndTruncateGuards1764300009000,
];
