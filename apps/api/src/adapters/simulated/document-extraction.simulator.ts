import { createHash } from "node:crypto";
import type {
  BundleExtractionRequest,
  DocumentExtraction,
  DocumentExtractionRequest,
  DocumentReading,
  ExtractedBundle,
  ExtractedRow,
  StatementAnalysis,
} from "@loan/contracts";
import { type IntakeSource, Money, ProviderMode, ServiceName } from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { applyFailureMode, requireFields } from "./failure";
import { SimulationModesService } from "./simulation-modes.service";
import { SIMULATION_OPTIONS, type SimulationOptions } from "./simulation-options";

const PROVIDER = "OCR and statement analysis (simulated)";

interface SyntheticRow {
  sourceDetail: string;
  fullName: string;
  birthDate: string;
  governmentIdLast4: string | null;
  employer: string;
  declaredMonthlyIncome: string;
  documentMonthlyIncome: string | null;
  amount: string;
  tenorMonths: number;
  purpose: string;
}

/**
 * The synthetic files an officer can "upload" (no file exists: the simulator holds what OCR
 * would read from each). Every person is invented; each row matches a seeded synthetic
 * applicant except where a field is missing on purpose (Elmer Santos's ID number), as in the
 * prototype's Email and file intake screen.
 */
const SYNTHETIC_FILES: Record<
  IntakeSource,
  { fileName: string; fingerprint: string; rows: SyntheticRow[] }
> = {
  PARTNER_SPREADSHEET: {
    fileName: "Cordillera Foods HR – salary loan requests Nov 2026.xlsx",
    fingerprint: "SYN-SHEET-CORDILLERA-2026-11",
    rows: [
      {
        sourceDetail: "Partner spreadsheet, row 2",
        fullName: "Ramil Ocampo",
        birthDate: "1997-02-14",
        governmentIdLast4: "5521",
        employer: "Cordillera Foods Inc.",
        declaredMonthlyIncome: "32000.00",
        documentMonthlyIncome: null,
        amount: "50000.00",
        tenorMonths: 12,
        purpose: "Tuition",
      },
      {
        sourceDetail: "Partner spreadsheet, row 3",
        fullName: "Joy Fernandez",
        birthDate: "1990-08-03",
        governmentIdLast4: "6034",
        employer: "Cordillera Foods Inc.",
        declaredMonthlyIncome: "41000.00",
        documentMonthlyIncome: null,
        amount: "90000.00",
        tenorMonths: 18,
        purpose: "Home repairs",
      },
      {
        sourceDetail: "Partner spreadsheet, row 4",
        fullName: "Elmer Santos",
        birthDate: "1982-11-21",
        governmentIdLast4: null,
        employer: "Cordillera Foods Inc.",
        declaredMonthlyIncome: "35500.00",
        documentMonthlyIncome: null,
        amount: "70000.00",
        tenorMonths: 12,
        purpose: "Medical expenses",
      },
    ],
  },
  EMAIL_BUNDLE: {
    fileName: "Email from g.villamor@example.invalid with 3 attachments",
    fingerprint: "SYN-EMAIL-VILLAMOR-2026-11",
    rows: [
      {
        sourceDetail: "Email bundle: application form, government ID, payslip",
        fullName: "Grace Villamor",
        birthDate: "1993-01-27",
        governmentIdLast4: "7342",
        employer: "Pasig Digital Studio",
        declaredMonthlyIncome: "56000.00",
        documentMonthlyIncome: "56000.00",
        amount: "120000.00",
        tenorMonths: 24,
        purpose: "Home renovation",
      },
    ],
  },
};

/** What each synthetic applicant's documents show, seeded in `sim.document_profile`. */
interface StoredDocumentProfile {
  monthlyIncome: string;
  employer: string;
  statement: {
    salaryCredit: string;
    monthsWithSalary: number;
    monthsCovered: number;
    recurringObligations: string;
    averageDailyBalance: string;
    returnedItems: number;
    riskyMerchants: boolean;
  };
}

/** A reference derived from the key, so a retry gets the same one (no state to keep). */
function referenceFor(prefix: string, key: string): string {
  return `${prefix}-${createHash("sha256").update(key).digest("hex").slice(0, 8).toUpperCase()}`;
}

const money = (s: string | null): Money | null => (s === null ? null : Money.of(s));

/**
 * Simulated OCR and bank statement analysis (PRD §9.5: "open-source OCR on synthetic IDs and
 * payslips", "rule-based parser over synthetic statements"). Bundles come from the synthetic
 * catalogue above; a document's figures from the applicant's seeded profile (an applicant with
 * none gives a reading with no figures). Deterministic, so it is idempotent on the key. No real
 * file is read and no real OCR service is called.
 */
@Injectable()
export class SimulatedDocumentExtraction implements DocumentExtraction {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly modes: SimulationModesService,
    @Inject(SIMULATION_OPTIONS) private readonly options: SimulationOptions,
  ) {}

  async extractBundle(request: BundleExtractionRequest): Promise<ExtractedBundle> {
    const mode = await applyFailureMode(ServiceName.DocumentExtraction, this.modes, this.options);
    const file = SYNTHETIC_FILES[request.source];
    const rows: ExtractedRow[] = file.rows.map((r, i) => ({
      rowNumber: request.source === "PARTNER_SPREADSHEET" ? i + 2 : 1,
      sourceDetail: r.sourceDetail,
      fullName: r.fullName,
      birthDate: r.birthDate,
      governmentIdLast4: r.governmentIdLast4,
      employer: r.employer,
      declaredMonthlyIncome: money(r.declaredMonthlyIncome),
      documentMonthlyIncome: money(r.documentMonthlyIncome),
      amount: money(r.amount),
      tenorMonths: r.tenorMonths,
      purpose: r.purpose,
    }));
    const reply: Partial<ExtractedBundle> = {
      provider: PROVIDER,
      mode: ProviderMode.Simulated,
      idempotencyKey: request.idempotencyKey,
      reference: referenceFor("OCR-B", request.idempotencyKey),
      fileName: file.fileName,
      fingerprint: file.fingerprint,
      rows,
      extractedAt: new Date().toISOString(),
    };
    if (mode === "MALFORMED") reply.rows = undefined;
    return requireFields<ExtractedBundle>(ServiceName.DocumentExtraction, reply, [
      "reference",
      "fileName",
      "fingerprint",
      "rows",
    ]);
  }

  async readDocument(request: DocumentExtractionRequest): Promise<DocumentReading> {
    const mode = await applyFailureMode(ServiceName.DocumentExtraction, this.modes, this.options);
    const rows: { payload: StoredDocumentProfile }[] = await this.ds.query(
      "SELECT payload FROM sim.document_profile WHERE applicant_id = $1",
      [request.applicantId],
    );
    const profile = rows[0]?.payload ?? null;
    const statement: StatementAnalysis | null =
      profile && request.documentType === "BANK_STATEMENTS_3M"
        ? {
            salaryCredit: Money.of(profile.statement.salaryCredit),
            monthsWithSalary: profile.statement.monthsWithSalary,
            monthsCovered: profile.statement.monthsCovered,
            recurringObligations: Money.of(profile.statement.recurringObligations),
            averageDailyBalance: Money.of(profile.statement.averageDailyBalance),
            returnedItems: profile.statement.returnedItems,
            riskyMerchants: profile.statement.riskyMerchants,
          }
        : null;
    // Statements show the salary credits; a certificate of employment and a tax return the
    // declared pay. The employer's name appears on all three.
    const income = statement ? statement.salaryCredit : money(profile?.monthlyIncome ?? null);
    const reply: Partial<DocumentReading> = {
      provider: PROVIDER,
      mode: ProviderMode.Simulated,
      idempotencyKey: request.idempotencyKey,
      reference: referenceFor("OCR-D", request.idempotencyKey),
      documentType: request.documentType,
      monthlyIncome: income,
      employer: profile?.employer ?? null,
      statement,
      extractedAt: new Date().toISOString(),
    };
    if (mode === "MALFORMED") reply.reference = undefined;
    return requireFields<DocumentReading>(ServiceName.DocumentExtraction, reply, [
      "reference",
      "documentType",
    ]);
  }
}
