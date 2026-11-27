import type { DocumentIntake, DocumentUploadRequest, ReceivedDocument } from "@loan/contracts";
import { type DocumentType, ProviderMode, ServiceName } from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { applyFailureMode, requireFields } from "./failure";
import { SimulationModesService } from "./simulation-modes.service";
import { SIMULATION_OPTIONS, type SimulationOptions } from "./simulation-options";

/** The synthetic "file" the simulated borrower uploads for each document type. */
const SYNTHETIC_FILE: Record<DocumentType, { fileName: string; sizeBytes: number; pages: number }> =
  {
    BANK_STATEMENTS_3M: { fileName: "bank-statements-3-months.pdf", sizeBytes: 184_320, pages: 6 },
    CERTIFICATE_OF_EMPLOYMENT: {
      fileName: "certificate-of-employment.pdf",
      sizeBytes: 61_440,
      pages: 1,
    },
    INCOME_TAX_RETURN: { fileName: "income-tax-return.pdf", sizeBytes: 122_880, pages: 4 },
  };

interface StoredUpload {
  documentType: DocumentType;
  fileName: string;
  sizeBytes: number;
  pages: number;
  receivedAt: string;
}

/**
 * Simulated document intake: the borrower's upload in the WhiteBank app is simulated, so a
 * synthetic PDF's metadata is recorded (no file content exists anywhere) and reported as
 * scanned clean. Idempotent on the key: the upload is stored in `sim.document_upload`, in
 * the simulator's own statement, so a retry after a timeout returns the same reference.
 */
@Injectable()
export class SimulatedDocumentIntake implements DocumentIntake {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly modes: SimulationModesService,
    @Inject(SIMULATION_OPTIONS) private readonly options: SimulationOptions,
  ) {}

  async receive(request: DocumentUploadRequest): Promise<ReceivedDocument> {
    const mode = await applyFailureMode(ServiceName.DocumentIntake, this.modes, this.options);
    const file = SYNTHETIC_FILE[request.documentType];
    const [{ n }] = (await this.ds.query("SELECT nextval('sim.document_seq') AS n")) as [
      { n: string },
    ];
    const payload: StoredUpload = {
      documentType: request.documentType,
      ...file,
      receivedAt: new Date().toISOString(),
    };
    await this.ds.query(
      `INSERT INTO sim.document_upload (idempotency_key, reference, application_id, payload)
       VALUES ($1, $2, $3, $4) ON CONFLICT (idempotency_key) DO NOTHING`,
      [request.idempotencyKey, `DOC-${n.padStart(8, "0")}`, request.applicationId, payload],
    );
    const rows: { reference: string; payload: StoredUpload }[] = await this.ds.query(
      "SELECT reference, payload FROM sim.document_upload WHERE idempotency_key = $1",
      [request.idempotencyKey],
    );
    const row = rows[0];
    const reply: Partial<ReceivedDocument> = {
      provider: "Document intake (simulated)",
      mode: ProviderMode.Simulated,
      idempotencyKey: request.idempotencyKey,
      reference: row?.reference,
      fileName: row?.payload.fileName,
      contentType: "application/pdf",
      sizeBytes: row?.payload.sizeBytes,
      pages: row?.payload.pages,
      virusScan: "CLEAN",
      receivedAt: row?.payload.receivedAt,
    };
    if (mode === "MALFORMED") reply.reference = undefined;
    return requireFields<ReceivedDocument>(ServiceName.DocumentIntake, reply, [
      "reference",
      "fileName",
      "sizeBytes",
      "receivedAt",
    ]);
  }
}
