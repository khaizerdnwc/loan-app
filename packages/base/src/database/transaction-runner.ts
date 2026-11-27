import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager } from "typeorm";

/**
 * One unit of work in one database transaction. Services pass the manager it hands them to
 * repositories, so a state change, its activity events and everything it creates commit
 * together or not at all (AGENTS.md non-negotiable 5).
 */
@Injectable()
export class TransactionRunner {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  run<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction("READ COMMITTED", work);
  }

  /** The non-transactional manager, for reads. */
  get manager(): EntityManager {
    return this.dataSource.manager;
  }
}
