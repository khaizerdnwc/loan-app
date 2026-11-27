import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { EntityManager, Repository } from "typeorm";
import { StaffEntity } from "./staff.entity";

@Injectable()
export class StaffRepository {
  constructor(@InjectRepository(StaffEntity) private readonly repo: Repository<StaffEntity>) {}

  list(): Promise<StaffEntity[]> {
    return this.repo.find({ order: { role: "ASC", fullName: "ASC" } });
  }

  findById(id: string, manager?: EntityManager): Promise<StaffEntity | null> {
    return (manager?.getRepository(StaffEntity) ?? this.repo).findOne({ where: { id } });
  }

  async namesById(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.repo.find({ order: { id: "ASC" } });
    return new Map(rows.filter((r) => ids.includes(r.id)).map((r) => [r.id, r.fullName]));
  }
}
