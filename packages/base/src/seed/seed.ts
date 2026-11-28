import { identityKey } from "@loan/contracts";
import { Money } from "@loan/core";
import type { DataSource } from "typeorm";
import { hashPassword } from "../auth/password";
import { StaffEntity } from "../auth/staff.entity";
import { ApplicantEntity } from "../cases/entities/applicant.entity";
import { BusinessHolidayEntity } from "../sla/entities/business-holiday.entity";
import { BusinessHolidayChangeEntity } from "../sla/entities/business-holiday-change.entity";

/**
 * Synthetic demo data only (mechanics: "use synthetic data only, and create it yourself").
 * Every name, ID and number here is invented. Running it twice changes nothing: rows are
 * upserted by id. docs/ASSUMPTIONS.md lists each persona's expected outcome.
 */
interface StaffSeed {
  id: string;
  /** Test sign-in name; every account's test password is SEED_TEST_PASSWORD. */
  username: string;
  fullName: string;
  role: StaffEntity["role"];
  title: string;
  /** Approvers only: their level in the approval matrix (migration 1764300001002). */
  approvalLevelCode: string | null;
}

/**
 * The one TEST password every seeded staff member signs in with: synthetic demo accounts
 * only, published in docs/TEST-ACCOUNTS.md, never a real credential. Stored only as a scrypt
 * hash.
 */
export const SEED_TEST_PASSWORD = "Password123!";

export const SEED_STAFF: StaffSeed[] = [
  {
    id: "STF-PAOLO",
    username: "paolo",
    fullName: "Paolo Tan",
    role: "LOAN_OFFICER",
    title: "Loan officer / credit analyst",
    approvalLevelCode: null,
  },
  // A second loan officer, so a case can be picked from the team queue and reassigned (WF-002).
  {
    id: "STF-JOY",
    username: "joy",
    fullName: "Joy Dela Cruz",
    role: "LOAN_OFFICER",
    title: "Loan officer / credit analyst",
    approvalLevelCode: null,
  },
  {
    id: "STF-RINA",
    username: "rina",
    fullName: "Rina Aquino",
    role: "APPROVER",
    title: "Approver · ₱1,000,000 · grades A–C",
    approvalLevelCode: "L2",
  },
  {
    id: "STF-BEN",
    username: "ben",
    fullName: "Ben Castro",
    role: "APPROVER",
    title: "Approver · ₱100,000 · grades A–B",
    approvalLevelCode: "L1",
  },
  // The head of credit: level L3 of the approval matrix (larger amounts, grade D, policy
  // exceptions and related-party loans).
  {
    id: "STF-TEO",
    username: "teo",
    fullName: "Teodoro Lim",
    role: "APPROVER",
    title: "Head of credit",
    approvalLevelCode: "L3",
  },
  {
    id: "STF-MARCO",
    username: "marco",
    fullName: "Marco Bautista",
    role: "LOAN_OPERATIONS",
    title: "Loan operations (booking maker)",
    approvalLevelCode: null,
  },
  {
    id: "STF-ELLA",
    username: "ella",
    fullName: "Ella Reyes",
    role: "LOAN_OPERATIONS_SUPERVISOR",
    title: "Loan operations supervisor (checker)",
    approvalLevelCode: null,
  },
  {
    id: "STF-LITO",
    username: "lito",
    fullName: "Lito Garcia",
    role: "LOAN_OPERATIONS_SUPERVISOR",
    title: "Loan operations supervisor (checker)",
    approvalLevelCode: null,
  },
  {
    id: "STF-DIANE",
    username: "diane",
    fullName: "Diane Yu",
    role: "COMPLIANCE",
    title: "Compliance / audit (read-only)",
    approvalLevelCode: null,
  },
  {
    id: "STF-LEO",
    username: "leo",
    fullName: "Leo Santiago",
    role: "ADMIN",
    title: "Administrator (simulation controls)",
    approvalLevelCode: null,
  },
  // The second administrator: an automation change needs one to draft it and another to approve.
  {
    id: "STF-CELIA",
    username: "celia",
    fullName: "Celia Ortiz",
    role: "ADMIN",
    title: "Credit risk manager (administrator)",
    approvalLevelCode: null,
  },
];

interface ApplicantSeed {
  id: string;
  fullName: string;
  birthDate: string;
  governmentIdLast4: string;
  employer: string;
  employmentMonths: number;
  relationshipMonths: number;
  monthlyIncome: string;
  monthlyObligations: string;
  /** Declared income recorded apart from the verified `monthlyIncome` (RS-PL-2 mismatch rule). */
  declaredMonthlyIncome?: string;
  /** A WhiteBank insider or a relative of one (CMP-006). */
  relatedParty?: boolean;
  depositAccount: string;
  bureau: {
    fileDepth: "FULL" | "THIN" | "NO_HIT";
    bureauScore: number | null;
    tradeLines: number;
    utilisationPct: number;
    delinquencies12m: number;
    existingDefault: boolean;
    monthsOnFile: number;
  };
  screening: {
    kycVerified: boolean;
    sanctionsMatch: boolean;
    matchedList: string | null;
    politicallyExposed: boolean;
    /** The simulated watchlist adds them after onboarding (matched before disbursement). */
    listedBeforeDisbursement?: { matchedList: string };
  };
  /** The simulated fraud check's answer; absent means no signals. */
  fraud?: { flagged: boolean; signals: string[] };
  /**
   * What the simulated OCR reads from this person's documents (PRD DOC-002, DOC-007), where it
   * differs from the default (their income on record as salary credits, their obligations).
   */
  documents?: { salaryCredit?: string; recurringObligations?: string };
}

const CLEAR = {
  kycVerified: true,
  sanctionsMatch: false,
  matchedList: null,
  politicallyExposed: false,
};

/** Maria's bureau report (742, grade A with her income and obligations). */
const GOOD_BUREAU: ApplicantSeed["bureau"] = {
  fileDepth: "FULL",
  bureauScore: 748,
  tradeLines: 6,
  utilisationPct: 35,
  delinquencies12m: 0,
  existingDefault: false,
  monthsOnFile: 96,
};

export const SEED_APPLICANTS: ApplicantSeed[] = [
  {
    id: "APL-MARIA",
    fullName: "Maria Santos",
    birthDate: "1995-05-10",
    governmentIdLast4: "4821",
    employer: "Luzon Freight Services Inc.",
    employmentMonths: 30,
    relationshipMonths: 18,
    monthlyIncome: "78000.00",
    monthlyObligations: "9000.00",
    depositAccount: "WB-SAV-0021-4410",
    bureau: {
      fileDepth: "FULL",
      bureauScore: 748,
      tradeLines: 6,
      utilisationPct: 35,
      delinquencies12m: 0,
      existingDefault: false,
      monthsOnFile: 96,
    },
    screening: CLEAR,
  },
  {
    id: "APL-JOEL",
    fullName: "Joel Reyes",
    birthDate: "1999-04-02",
    governmentIdLast4: "7730",
    employer: "Pasig Digital Studio",
    employmentMonths: 40,
    relationshipMonths: 0,
    monthlyIncome: "56000.00",
    monthlyObligations: "11000.00",
    depositAccount: "WB-SAV-0087-1192",
    bureau: {
      fileDepth: "THIN",
      bureauScore: 640,
      tradeLines: 1,
      utilisationPct: 42,
      delinquencies12m: 0,
      existingDefault: false,
      monthsOnFile: 7,
    },
    screening: CLEAR,
  },
  {
    id: "APL-RAMON",
    fullName: "Ramon Cruz",
    birthDate: "1974-06-20",
    governmentIdLast4: "1188",
    employer: "Cebu Trading Co.",
    employmentMonths: 30,
    relationshipMonths: 18,
    monthlyIncome: "78000.00",
    monthlyObligations: "9000.00",
    depositAccount: "WB-SAV-0102-3307",
    bureau: {
      fileDepth: "FULL",
      bureauScore: 748,
      tradeLines: 6,
      utilisationPct: 35,
      delinquencies12m: 0,
      existingDefault: false,
      monthsOnFile: 96,
    },
    screening: {
      kycVerified: true,
      sanctionsMatch: true,
      matchedList: "Simulated watchlist",
      politicallyExposed: false,
    },
  },
  {
    id: "APL-NICO",
    fullName: "Nico Villareal",
    birthDate: "1991-03-11",
    governmentIdLast4: "5502",
    employer: "Makati Logistics Hub",
    employmentMonths: 60,
    relationshipMonths: 30,
    monthlyIncome: "70000.00",
    monthlyObligations: "30100.00",
    depositAccount: "WB-SAV-0119-8821",
    bureau: {
      fileDepth: "FULL",
      bureauScore: 671,
      tradeLines: 5,
      utilisationPct: 45,
      delinquencies12m: 0,
      existingDefault: false,
      monthsOnFile: 80,
    },
    screening: CLEAR,
  },
  {
    id: "APL-RAFAEL",
    fullName: "Rafael Gomez",
    birthDate: "1982-08-30",
    governmentIdLast4: "9014",
    employer: "Bonifacio Engineering Group",
    employmentMonths: 120,
    relationshipMonths: 60,
    monthlyIncome: "180000.00",
    monthlyObligations: "20000.00",
    depositAccount: "WB-SAV-0133-2075",
    bureau: {
      fileDepth: "FULL",
      bureauScore: 711,
      tradeLines: 9,
      utilisationPct: 25,
      delinquencies12m: 0,
      existingDefault: false,
      monthsOnFile: 150,
    },
    screening: CLEAR,
  },
  {
    id: "APL-CARMEN",
    fullName: "Carmen Diaz",
    birthDate: "1997-04-09",
    governmentIdLast4: "3349",
    employer: "Quezon City Retail Outlet",
    employmentMonths: 8,
    relationshipMonths: 0,
    monthlyIncome: "40000.00",
    monthlyObligations: "14000.00",
    depositAccount: "WB-SAV-0148-6650",
    bureau: {
      fileDepth: "FULL",
      bureauScore: 540,
      tradeLines: 4,
      utilisationPct: 85,
      delinquencies12m: 2,
      existingDefault: false,
      monthsOnFile: 40,
    },
    screening: CLEAR,
  },
  {
    id: "APL-KEVIN",
    fullName: "Kevin Lim",
    birthDate: "2008-12-15",
    governmentIdLast4: "6271",
    employer: "Taguig Coffee Bar",
    employmentMonths: 14,
    relationshipMonths: 10,
    monthlyIncome: "32000.00",
    monthlyObligations: "2000.00",
    depositAccount: "WB-SAV-0151-7781",
    bureau: {
      fileDepth: "THIN",
      bureauScore: 610,
      tradeLines: 1,
      utilisationPct: 20,
      delinquencies12m: 0,
      existingDefault: false,
      monthsOnFile: 10,
    },
    screening: CLEAR,
  },
  {
    id: "APL-NINA",
    fullName: "Nina Cruz",
    birthDate: "2003-07-21",
    governmentIdLast4: "8456",
    employer: "Ortigas Call Centre",
    employmentMonths: 14,
    relationshipMonths: 10,
    monthlyIncome: "42000.00",
    monthlyObligations: "4000.00",
    depositAccount: "WB-SAV-0164-0912",
    bureau: {
      fileDepth: "NO_HIT",
      bureauScore: null,
      tradeLines: 0,
      utilisationPct: 0,
      delinquencies12m: 0,
      existingDefault: false,
      monthsOnFile: 0,
    },
    screening: CLEAR,
  },
  // Same profile as Maria (742, grade A): one each for browser journeys that must not share an
  // applicant now that one applicant has at most one open application per product (INT-007).
  {
    id: "APL-ANA",
    fullName: "Ana Mendoza",
    birthDate: "1995-05-10",
    governmentIdLast4: "5132",
    employer: "Luzon Freight Services Inc.",
    employmentMonths: 30,
    relationshipMonths: 18,
    monthlyIncome: "78000.00",
    monthlyObligations: "9000.00",
    depositAccount: "WB-SAV-0021-5520",
    bureau: {
      fileDepth: "FULL",
      bureauScore: 748,
      tradeLines: 6,
      utilisationPct: 35,
      delinquencies12m: 0,
      existingDefault: false,
      monthsOnFile: 96,
    },
    screening: CLEAR,
  },
  {
    id: "APL-LIZA",
    fullName: "Liza Ramos",
    birthDate: "1995-05-10",
    governmentIdLast4: "6243",
    employer: "Luzon Freight Services Inc.",
    employmentMonths: 30,
    relationshipMonths: 18,
    monthlyIncome: "78000.00",
    monthlyObligations: "9000.00",
    depositAccount: "WB-SAV-0021-6631",
    bureau: {
      fileDepth: "FULL",
      bureauScore: 748,
      tradeLines: 6,
      utilisationPct: 35,
      delinquencies12m: 0,
      existingDefault: false,
      monthsOnFile: 96,
    },
    screening: CLEAR,
  },
  {
    id: "APL-GRACE",
    fullName: "Grace Villanueva",
    birthDate: "1995-05-10",
    governmentIdLast4: "7354",
    employer: "Luzon Freight Services Inc.",
    employmentMonths: 30,
    relationshipMonths: 18,
    monthlyIncome: "78000.00",
    monthlyObligations: "9000.00",
    depositAccount: "WB-SAV-0021-7742",
    bureau: {
      fileDepth: "FULL",
      bureauScore: 748,
      tradeLines: 6,
      utilisationPct: 35,
      delinquencies12m: 0,
      existingDefault: false,
      monthsOnFile: 96,
    },
    screening: CLEAR,
  },
  {
    id: "APL-ROSA",
    fullName: "Rosa Dizon",
    birthDate: "1995-05-10",
    governmentIdLast4: "8465",
    employer: "Luzon Freight Services Inc.",
    employmentMonths: 30,
    relationshipMonths: 18,
    monthlyIncome: "78000.00",
    monthlyObligations: "9000.00",
    depositAccount: "WB-SAV-0021-8853",
    bureau: {
      fileDepth: "FULL",
      bureauScore: 748,
      tradeLines: 6,
      utilisationPct: 35,
      delinquencies12m: 0,
      existingDefault: false,
      monthsOnFile: 96,
    },
    screening: CLEAR,
  },
  // Maria's profile again, for the pre-booking checklist and indicative repayment journey (BK-1, IR-1).
  {
    id: "APL-TERESA",
    fullName: "Teresa Lopez",
    birthDate: "1995-05-10",
    governmentIdLast4: "9576",
    employer: "Luzon Freight Services Inc.",
    employmentMonths: 30,
    relationshipMonths: 18,
    monthlyIncome: "78000.00",
    monthlyObligations: "9000.00",
    depositAccount: "WB-SAV-0021-9964",
    bureau: {
      fileDepth: "FULL",
      bureauScore: 748,
      tradeLines: 6,
      utilisationPct: 35,
      delinquencies12m: 0,
      existingDefault: false,
      monthsOnFile: 96,
    },
    screening: CLEAR,
  },
  // Maria's profile, but salary goes to another bank's account: the checklist's disbursement
  // account item fails, so the booking cannot be submitted (BK-1).
  {
    id: "APL-PAZ",
    fullName: "Paz Ocampo",
    birthDate: "1995-05-10",
    governmentIdLast4: "0687",
    employer: "Luzon Freight Services Inc.",
    employmentMonths: 30,
    relationshipMonths: 18,
    monthlyIncome: "78000.00",
    monthlyObligations: "9000.00",
    depositAccount: "EXT-BANK-0042-1180",
    bureau: {
      fileDepth: "FULL",
      bureauScore: 748,
      tradeLines: 6,
      utilisationPct: 35,
      delinquencies12m: 0,
      existingDefault: false,
      monthsOnFile: 96,
    },
    screening: CLEAR,
  },
  // RS-PL-2 referral triggers and the automation journey: Maria's profile (742, grade A) with one
  // difference each, so that difference is the only reason the case goes to a person.
  {
    id: "APL-DANTE",
    fullName: "Dante Flores",
    birthDate: "1993-02-14",
    governmentIdLast4: "2468",
    employer: "Marikina Shoe Works",
    employmentMonths: 30,
    relationshipMonths: 18,
    monthlyIncome: "50000.00",
    monthlyObligations: "9000.00",
    declaredMonthlyIncome: "65000.00",
    depositAccount: "WB-SAV-0172-3391",
    bureau: GOOD_BUREAU,
    screening: CLEAR,
  },
  {
    id: "APL-PAULA",
    fullName: "Paula Mercado",
    birthDate: "1994-09-03",
    governmentIdLast4: "1357",
    employer: "Luzon Freight Services Inc.",
    employmentMonths: 30,
    relationshipMonths: 18,
    monthlyIncome: "78000.00",
    monthlyObligations: "9000.00",
    depositAccount: "WB-SAV-0180-4402",
    bureau: GOOD_BUREAU,
    screening: CLEAR,
    fraud: { flagged: true, signals: ["DUPLICATE_IDENTITY"] },
  },
  {
    id: "APL-NAVARRO",
    fullName: "Teresa Navarro",
    birthDate: "1990-11-22",
    governmentIdLast4: "8642",
    employer: "WhiteBank (branch operations)",
    employmentMonths: 30,
    relationshipMonths: 18,
    monthlyIncome: "78000.00",
    monthlyObligations: "9000.00",
    relatedParty: true,
    depositAccount: "WB-SAV-0195-5513",
    bureau: GOOD_BUREAU,
    screening: CLEAR,
  },
  {
    id: "APL-OSCAR",
    fullName: "Oscar Belmonte",
    birthDate: "1995-05-10",
    governmentIdLast4: "9753",
    employer: "Luzon Freight Services Inc.",
    employmentMonths: 30,
    relationshipMonths: 18,
    monthlyIncome: "78000.00",
    monthlyObligations: "9000.00",
    depositAccount: "WB-SAV-0021-0175",
    bureau: GOOD_BUREAU,
    screening: CLEAR,
  },
  {
    // Same profile as Ramon (sanctions match at application): the compliance browser journey.
    id: "APL-ERNESTO",
    fullName: "Ernesto Lacson",
    birthDate: "1972-02-14",
    governmentIdLast4: "6620",
    employer: "Visayas Agri Supply",
    employmentMonths: 30,
    relationshipMonths: 18,
    monthlyIncome: "78000.00",
    monthlyObligations: "9000.00",
    depositAccount: "WB-SAV-0102-5521",
    bureau: {
      fileDepth: "FULL",
      bureauScore: 748,
      tradeLines: 6,
      utilisationPct: 35,
      delinquencies12m: 0,
      existingDefault: false,
      monthsOnFile: 96,
    },
    screening: {
      kycVerified: true,
      sanctionsMatch: true,
      matchedList: "Simulated watchlist",
      politicallyExposed: false,
    },
  },
  {
    // Same profile as Maria (742, A) at application; the simulated watchlist adds him before
    // disbursement, so the screening the booking runs again matches (PRD CMP-005).
    id: "APL-DARIO",
    fullName: "Dario Mercado",
    birthDate: "1993-08-22",
    governmentIdLast4: "4418",
    employer: "Pasig Logistics Corp.",
    employmentMonths: 30,
    relationshipMonths: 18,
    monthlyIncome: "78000.00",
    monthlyObligations: "9000.00",
    depositAccount: "WB-SAV-0021-9035",
    bureau: {
      fileDepth: "FULL",
      bureauScore: 748,
      tradeLines: 6,
      utilisationPct: 35,
      delinquencies12m: 0,
      existingDefault: false,
      monthsOnFile: 96,
    },
    screening: {
      ...CLEAR,
      listedBeforeDisbursement: { matchedList: "Simulated watchlist (updated list)" },
    },
  },
  // Joel's thin-file profile (Refer, 612 C), for the request-information journey (DC-1..DC-3).
  {
    id: "APL-IGNACIO",
    fullName: "Ignacio Velasco",
    birthDate: "1999-04-02",
    governmentIdLast4: "3164",
    employer: "Pasig Digital Studio",
    employmentMonths: 40,
    relationshipMonths: 0,
    monthlyIncome: "56000.00",
    monthlyObligations: "11000.00",
    depositAccount: "WB-SAV-0087-2203",
    bureau: {
      fileDepth: "THIN",
      bureauScore: 640,
      tradeLines: 1,
      utilisationPct: 42,
      delinquencies12m: 0,
      existingDefault: false,
      monthsOnFile: 7,
    },
    screening: CLEAR,
  },
  // Joel's thin-file profile (Refer, 612 C), for the SLA and turnaround journey.
  {
    id: "APL-RENATO",
    fullName: "Renato Navarro",
    birthDate: "1999-04-02",
    governmentIdLast4: "5836",
    employer: "Pasig Digital Studio",
    employmentMonths: 40,
    relationshipMonths: 0,
    monthlyIncome: "56000.00",
    monthlyObligations: "11000.00",
    depositAccount: "WB-SAV-0087-5836",
    bureau: {
      fileDepth: "THIN",
      bureauScore: 640,
      tradeLines: 1,
      utilisationPct: 42,
      delinquencies12m: 0,
      existingDefault: false,
      monthsOnFile: 7,
    },
    screening: CLEAR,
  },
  // Maria's profile again (742, A), for the booking-exceptions and reconciliation journey.
  {
    id: "APL-HERNAN",
    fullName: "Hernan Salazar",
    birthDate: "1994-03-15",
    governmentIdLast4: "2791",
    employer: "Luzon Freight Services Inc.",
    employmentMonths: 30,
    relationshipMonths: 18,
    monthlyIncome: "78000.00",
    monthlyObligations: "9000.00",
    depositAccount: "WB-SAV-0021-2791",
    bureau: {
      fileDepth: "FULL",
      bureauScore: 748,
      tradeLines: 6,
      utilisationPct: 35,
      delinquencies12m: 0,
      existingDefault: false,
      monthsOnFile: 96,
    },
    screening: CLEAR,
  },
  // Email and file intake (PRD INT-010, F4): the people in the simulated OCR's synthetic files.
  // The partner spreadsheet's three rows (Cordillera Foods HR); Elmer's ID number is missing
  // from the sheet on purpose. Maria's bureau profile with their own incomes.
  {
    id: "APL-RAMIL",
    fullName: "Ramil Ocampo",
    birthDate: "1997-02-14",
    governmentIdLast4: "5521",
    employer: "Cordillera Foods Inc.",
    employmentMonths: 30,
    relationshipMonths: 18,
    monthlyIncome: "32000.00",
    monthlyObligations: "3000.00",
    depositAccount: "WB-SAV-0310-5521",
    bureau: GOOD_BUREAU,
    screening: CLEAR,
  },
  {
    id: "APL-JOY",
    fullName: "Joy Fernandez",
    birthDate: "1990-08-03",
    governmentIdLast4: "6034",
    employer: "Cordillera Foods Inc.",
    employmentMonths: 60,
    relationshipMonths: 36,
    monthlyIncome: "41000.00",
    monthlyObligations: "4000.00",
    depositAccount: "WB-SAV-0310-6034",
    bureau: GOOD_BUREAU,
    screening: CLEAR,
  },
  {
    id: "APL-ELMER",
    fullName: "Elmer Santos",
    birthDate: "1982-11-21",
    governmentIdLast4: "6619",
    employer: "Cordillera Foods Inc.",
    employmentMonths: 96,
    relationshipMonths: 48,
    monthlyIncome: "35500.00",
    monthlyObligations: "5000.00",
    depositAccount: "WB-SAV-0310-6619",
    bureau: GOOD_BUREAU,
    screening: CLEAR,
  },
  // The email bundle's applicant, used only by the intake browser journey: Joel's thin-file
  // profile (Refer, 612 C), so the officer requests her statements and OCR analyses them
  // (salary credits of 54,800 a month, within 15% of the 56,000 declared).
  {
    id: "APL-GRACE-VILLAMOR",
    fullName: "Grace Villamor",
    birthDate: "1993-01-27",
    governmentIdLast4: "7342",
    employer: "Pasig Digital Studio",
    employmentMonths: 40,
    relationshipMonths: 0,
    monthlyIncome: "56000.00",
    monthlyObligations: "11000.00",
    depositAccount: "WB-SAV-0087-7342",
    bureau: {
      fileDepth: "THIN",
      bureauScore: 640,
      tradeLines: 1,
      utilisationPct: 42,
      delinquencies12m: 0,
      existingDefault: false,
      monthsOnFile: 7,
    },
    screening: CLEAR,
    documents: { salaryCredit: "54800.00" },
  },
  // The second email bundle's applicant (intake batch 2): on record with the income she
  // declares, ₱52,000; the payslip in her bundle shows ₱41,000, so OCR flags the draft.
  {
    id: "APL-LORNA-ABAD",
    fullName: "Lorna Abad",
    birthDate: "1986-03-18",
    governmentIdLast4: "2950",
    employer: "Quezon City Medical Center",
    employmentMonths: 72,
    relationshipMonths: 30,
    monthlyIncome: "52000.00",
    monthlyObligations: "8000.00",
    depositAccount: "WB-SAV-0412-2950",
    bureau: GOOD_BUREAU,
    screening: CLEAR,
    documents: { salaryCredit: "41000.00" },
  },
];

/**
 * A small Philippine holiday calendar for the business clock (PRD PLT-005): the regular and
 * special non-working days of late 2026 and early 2027, as commonly proclaimed. Synthetic
 * demo data: a deployment would load the official proclamation each year. Written only into an
 * empty calendar (see seed()): after that the calendar is the administrators'.
 */
export const SEED_HOLIDAYS: { date: string; name: string }[] = [
  { date: "2026-08-21", name: "Ninoy Aquino Day" },
  { date: "2026-08-31", name: "National Heroes Day" },
  { date: "2026-11-01", name: "All Saints' Day" },
  { date: "2026-11-02", name: "All Souls' Day" },
  { date: "2026-11-30", name: "Bonifacio Day" },
  { date: "2026-12-08", name: "Feast of the Immaculate Conception" },
  { date: "2026-12-24", name: "Christmas Eve" },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2026-12-30", name: "Rizal Day" },
  { date: "2026-12-31", name: "Last day of the year" },
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-02-25", name: "EDSA People Power Revolution Anniversary" },
  { date: "2027-03-25", name: "Maundy Thursday" },
  { date: "2027-03-26", name: "Good Friday" },
  { date: "2027-04-09", name: "Araw ng Kagitingan" },
  { date: "2027-05-01", name: "Labor Day" },
  { date: "2027-06-12", name: "Independence Day" },
];

/** Upsert the demo staff, applicants and the simulators' persona profiles. */
export async function seed(ds: DataSource): Promise<{ staff: number; applicants: number }> {
  await ds.transaction(async (m) => {
    const staff = [];
    for (const s of SEED_STAFF) {
      staff.push({
        ...s,
        passwordHash: await hashPassword(SEED_TEST_PASSWORD),
      });
    }
    await m.getRepository(StaffEntity).upsert(staff, ["id"]);
    await m.getRepository(ApplicantEntity).upsert(
      SEED_APPLICANTS.map(({ bureau: _b, screening: _s, fraud: _f, documents: _d, ...a }) => ({
        ...a,
        monthlyIncome: Money.of(a.monthlyIncome),
        monthlyObligations: Money.of(a.monthlyObligations),
        declaredMonthlyIncome: a.declaredMonthlyIncome ? Money.of(a.declaredMonthlyIncome) : null,
        relatedParty: a.relatedParty ?? false,
      })),
      ["id"],
    );
    for (const a of SEED_APPLICANTS) {
      await m.query(
        `INSERT INTO sim.persona_profile (applicant_id, bureau, screening, fraud, identity_key)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (applicant_id) DO UPDATE SET bureau = $2, screening = $3, fraud = $4, identity_key = $5`,
        [a.id, a.bureau, a.screening, a.fraud ?? null, identityKey(a)],
      );
      await m.query(
        `INSERT INTO sim.document_profile (applicant_id, payload) VALUES ($1, $2)
         ON CONFLICT (applicant_id) DO UPDATE SET payload = $2`,
        [a.id, documentProfile(a)],
      );
    }
    // The demo calendar is a starting point, not seed data to keep in step. Administrators
    // change business_holiday from the Business calendar screen (PLT-005), and the image seeds
    // on every boot, so the demo days are written only into a fresh environment: no holiday
    // and no approved calendar change (a calendar emptied by administrators stays empty). A
    // restart never undoes an approved removal or addition. Replicas seeding at once both
    // pass the check; ON CONFLICT DO NOTHING lets the second insert find the rows and go on.
    const holidays = m.getRepository(BusinessHolidayEntity);
    const fresh =
      (await holidays.count()) === 0 &&
      (await m
        .getRepository(BusinessHolidayChangeEntity)
        .count({ where: { status: "APPROVED" } })) === 0;
    if (fresh) {
      await holidays.createQueryBuilder().insert().values(SEED_HOLIDAYS).orIgnore().execute();
    }
  });
  return { staff: SEED_STAFF.length, applicants: SEED_APPLICANTS.length };
}

/**
 * What the simulated OCR reads from an applicant's documents: by default their income on
 * record as salary credits in each of the 3 months, their obligations as recurring debits, an
 * average daily balance of 60% of the salary, no returned items and no gambling or lending apps.
 */
function documentProfile(a: ApplicantSeed) {
  const salary = a.documents?.salaryCredit ?? a.monthlyIncome;
  return {
    monthlyIncome: a.monthlyIncome,
    employer: a.employer,
    statement: {
      salaryCredit: salary,
      monthsWithSalary: 3,
      monthsCovered: 3,
      recurringObligations: a.documents?.recurringObligations ?? a.monthlyObligations,
      averageDailyBalance: Money.of(salary).times("0.6").round("HALF_UP").toString(),
      returnedItems: 0,
      riskyMerchants: false,
    },
  };
}
