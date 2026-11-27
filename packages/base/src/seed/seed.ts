import { Money } from "@loan/core";
import type { DataSource } from "typeorm";
import { hashPassword } from "../auth/password";
import { StaffEntity } from "../auth/staff.entity";
import { ApplicantEntity } from "../cases/entities/applicant.entity";

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
  approvalLimit: string | null;
  approvalGrades: StaffEntity["approvalGrades"];
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
    approvalLimit: null,
    approvalGrades: null,
  },
  {
    id: "STF-RINA",
    username: "rina",
    fullName: "Rina Aquino",
    role: "APPROVER",
    title: "Approver · ₱1,000,000 · grades A–C",
    approvalLimit: "1000000.00",
    approvalGrades: ["A", "B", "C"],
  },
  {
    id: "STF-BEN",
    username: "ben",
    fullName: "Ben Castro",
    role: "APPROVER",
    title: "Approver · ₱100,000 · grades A–B",
    approvalLimit: "100000.00",
    approvalGrades: ["A", "B"],
  },
  {
    id: "STF-MARCO",
    username: "marco",
    fullName: "Marco Bautista",
    role: "LOAN_OPERATIONS",
    title: "Loan operations (booking maker)",
    approvalLimit: null,
    approvalGrades: null,
  },
  {
    id: "STF-ELLA",
    username: "ella",
    fullName: "Ella Reyes",
    role: "LOAN_OPERATIONS_SUPERVISOR",
    title: "Loan operations supervisor (checker)",
    approvalLimit: null,
    approvalGrades: null,
  },
  {
    id: "STF-LITO",
    username: "lito",
    fullName: "Lito Garcia",
    role: "LOAN_OPERATIONS_SUPERVISOR",
    title: "Loan operations supervisor (checker)",
    approvalLimit: null,
    approvalGrades: null,
  },
  {
    id: "STF-DIANE",
    username: "diane",
    fullName: "Diane Yu",
    role: "COMPLIANCE",
    title: "Compliance / audit (read-only)",
    approvalLimit: null,
    approvalGrades: null,
  },
  {
    id: "STF-LEO",
    username: "leo",
    fullName: "Leo Santiago",
    role: "ADMIN",
    title: "Administrator (simulation controls)",
    approvalLimit: null,
    approvalGrades: null,
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
  };
}

const CLEAR = {
  kycVerified: true,
  sanctionsMatch: false,
  matchedList: null,
  politicallyExposed: false,
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
];

/** Upsert the demo staff, applicants and the simulators' persona profiles. */
export async function seed(ds: DataSource): Promise<{ staff: number; applicants: number }> {
  await ds.transaction(async (m) => {
    const staff = [];
    for (const s of SEED_STAFF) {
      staff.push({
        ...s,
        passwordHash: await hashPassword(SEED_TEST_PASSWORD),
        approvalLimit: s.approvalLimit ? Money.of(s.approvalLimit) : null,
      });
    }
    await m.getRepository(StaffEntity).upsert(staff, ["id"]);
    await m.getRepository(ApplicantEntity).upsert(
      SEED_APPLICANTS.map(({ bureau: _b, screening: _s, ...a }) => ({
        ...a,
        monthlyIncome: Money.of(a.monthlyIncome),
        monthlyObligations: Money.of(a.monthlyObligations),
      })),
      ["id"],
    );
    for (const a of SEED_APPLICANTS) {
      await m.query(
        `INSERT INTO sim.persona_profile (applicant_id, bureau, screening) VALUES ($1, $2, $3)
         ON CONFLICT (applicant_id) DO UPDATE SET bureau = $2, screening = $3`,
        [a.id, a.bureau, a.screening],
      );
    }
  });
  return { staff: SEED_STAFF.length, applicants: SEED_APPLICANTS.length };
}
