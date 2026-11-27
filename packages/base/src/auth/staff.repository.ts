import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { EntityManager, Repository } from "typeorm";
import { StaffEntity } from "./staff.entity";

@Injectable()
export class StaffRepository {
  constructor(@InjectRepository(StaffEntity) private readonly repo: Repository<StaffEntity>) {}

  /** The member with this username, including the password hash (selected only here). */
  findForSignIn(username: string): Promise<StaffEntity | null> {
    return this.repo
      .createQueryBuilder("s")
      .addSelect("s.passwordHash")
      .where("s.username = :username", { username })
      .getOne();
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
