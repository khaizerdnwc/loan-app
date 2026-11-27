import { EscalationStatus, type ScreeningStage } from "@loan/core";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager, Not } from "typeorm";
import { AmlEscalationEntity } from "./entities/aml-escalation.entity";

/** Storage for AML escalations. Raw access stays here (house/no-datasource-outside-repository). */
@Injectable()
export class ComplianceRepository {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  private repo(m?: EntityManager) {
    return (m ?? this.ds.manager).getRepository(AmlEscalationEntity);
  }

  async list(openOnly: boolean): Promise<AmlEscalationEntity[]> {
    return this.repo().find({
      where: openOnly ? { status: Not(EscalationStatus.Closed) } : {},
      relations: { loanCase: { applicant: true } },
      order: { openedAt: "DESC", id: "ASC" },
      take: 500,
    });
  }

  async find(id: string): Promise<AmlEscalationEntity | null> {
    return this.repo().findOne({ where: { id }, relations: { loanCase: { applicant: true } } });
  }

  /** The escalation, locked for the rest of the caller's transaction. */
  async lock(m: EntityManager, id: string): Promise<AmlEscalationEntity | null> {
    return this.repo(m)
      .createQueryBuilder("e")
      .setLock("pessimistic_write")
      .where("e.id = :id", { id })
      .getOne();
  }

  /** A case's escalations at one stage, newest first. */
  async forCase(
    caseId: string,
    stage: ScreeningStage,
    m?: EntityManager,
  ): Promise<AmlEscalationEntity[]> {
    return this.repo(m).find({
      where: { caseId, stage },
      order: { openedAt: "DESC", id: "ASC" },
    });
  }

  async save(m: EntityManager, e: AmlEscalationEntity): Promise<AmlEscalationEntity> {
    return this.repo(m).save(e);
  }
}
