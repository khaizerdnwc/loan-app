import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { EntityManager, Repository } from "typeorm";
import {
  AutomationChangeEntity,
  AutomationEventEntity,
  ProductAutomationEntity,
} from "./automation.entities";

/**
 * All SQL for product automation. Reads use the default manager; every write, and every read
 * that a decision or a change depends on, takes the manager of the caller's transaction.
 */
@Injectable()
export class AutomationRepository {
  constructor(
    @InjectRepository(ProductAutomationEntity)
    private readonly products: Repository<ProductAutomationEntity>,
  ) {}

  list(): Promise<ProductAutomationEntity[]> {
    return this.products.find({ order: { productCode: "ASC" } });
  }

  find(productCode: string): Promise<ProductAutomationEntity | null> {
    return this.products.findOne({ where: { productCode } });
  }

  /** The product's row under an update lock: changes to one product are serialised here. */
  lockForChange(m: EntityManager, productCode: string): Promise<ProductAutomationEntity | null> {
    return m
      .getRepository(ProductAutomationEntity)
      .createQueryBuilder("p")
      .setLock("pessimistic_write")
      .where("p.product_code = :productCode", { productCode })
      .getOne();
  }

  /**
   * The product's row under a share lock, for a decision: a mode change or the kill switch
   * waits for the decision to commit, and the decision waits for a change in flight, so a
   * decision is never recorded under a mode that had already been replaced.
   */
  readForDecision(m: EntityManager, productCode: string): Promise<ProductAutomationEntity | null> {
    return m
      .getRepository(ProductAutomationEntity)
      .createQueryBuilder("p")
      .setLock("pessimistic_read")
      .where("p.product_code = :productCode", { productCode })
      .getOne();
  }

  save(m: EntityManager, row: ProductAutomationEntity): Promise<ProductAutomationEntity> {
    return m.getRepository(ProductAutomationEntity).save(row);
  }

  pendingChanges(): Promise<AutomationChangeEntity[]> {
    return this.products.manager
      .getRepository(AutomationChangeEntity)
      .find({ where: { status: "PENDING" }, order: { requestedAt: "ASC" } });
  }

  findPending(m: EntityManager, productCode: string): Promise<AutomationChangeEntity | null> {
    return m
      .getRepository(AutomationChangeEntity)
      .findOne({ where: { productCode, status: "PENDING" } });
  }

  /** A change request under an update lock, so two approvals of one request serialise. */
  lockChange(m: EntityManager, id: string): Promise<AutomationChangeEntity | null> {
    return m
      .getRepository(AutomationChangeEntity)
      .createQueryBuilder("c")
      .setLock("pessimistic_write")
      .where("c.id = :id", { id })
      .getOne();
  }

  saveChange(m: EntityManager, change: AutomationChangeEntity): Promise<AutomationChangeEntity> {
    return m.getRepository(AutomationChangeEntity).save(change);
  }

  newChange(m: EntityManager): AutomationChangeEntity {
    return m.getRepository(AutomationChangeEntity).create();
  }

  async insertEvent(m: EntityManager, event: Partial<AutomationEventEntity>): Promise<void> {
    const repo = m.getRepository(AutomationEventEntity);
    await repo.save(repo.create(event));
  }

  /** The most recent events first. */
  events(productCode: string, limit = 100): Promise<AutomationEventEntity[]> {
    return this.products.manager.getRepository(AutomationEventEntity).find({
      where: { productCode },
      order: { createdAt: "DESC", id: "DESC" },
      take: limit,
    });
  }
}
