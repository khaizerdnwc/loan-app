import type { FeatureFlag } from "@loan/core";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { EntityManager, Repository } from "typeorm";
import { FeatureFlagChangeEntity, FeatureFlagEntity } from "./features.entities";

/** All SQL for feature flags. Writes, and reads a change depends on, use the caller's manager. */
@Injectable()
export class FeaturesRepository {
  constructor(
    @InjectRepository(FeatureFlagEntity)
    private readonly flags: Repository<FeatureFlagEntity>,
  ) {}

  list(): Promise<FeatureFlagEntity[]> {
    return this.flags.find({ order: { key: "ASC" } });
  }

  find(key: FeatureFlag): Promise<FeatureFlagEntity | null> {
    return this.flags.findOne({ where: { key } });
  }

  /** The flag's row under an update lock: changes to one flag are serialised here. */
  lockFlag(m: EntityManager, key: FeatureFlag): Promise<FeatureFlagEntity | null> {
    return m
      .getRepository(FeatureFlagEntity)
      .createQueryBuilder("f")
      .setLock("pessimistic_write")
      .where("f.key = :key", { key })
      .getOne();
  }

  saveFlag(m: EntityManager, flag: FeatureFlagEntity): Promise<FeatureFlagEntity> {
    return m.getRepository(FeatureFlagEntity).save(flag);
  }

  pendingChanges(): Promise<FeatureFlagChangeEntity[]> {
    return this.flags.manager
      .getRepository(FeatureFlagChangeEntity)
      .find({ where: { status: "PENDING" }, order: { requestedAt: "ASC" } });
  }

  findPending(m: EntityManager, key: FeatureFlag): Promise<FeatureFlagChangeEntity | null> {
    return m
      .getRepository(FeatureFlagChangeEntity)
      .findOne({ where: { flagKey: key, status: "PENDING" } });
  }

  /** A change under an update lock, so two decisions on one request serialise. */
  lockChange(m: EntityManager, id: string): Promise<FeatureFlagChangeEntity | null> {
    return m
      .getRepository(FeatureFlagChangeEntity)
      .createQueryBuilder("c")
      .setLock("pessimistic_write")
      .where("c.id = :id", { id })
      .getOne();
  }

  newChange(m: EntityManager): FeatureFlagChangeEntity {
    return m.getRepository(FeatureFlagChangeEntity).create();
  }

  saveChange(m: EntityManager, change: FeatureFlagChangeEntity): Promise<FeatureFlagChangeEntity> {
    return m.getRepository(FeatureFlagChangeEntity).save(change);
  }
}
