import {
  type ServiceModeChange,
  SIMULATION_CONTROL,
  type SimulationControl,
} from "@loan/contracts";
import { ProblemCode, Role, ServiceName, type SimulationServiceView } from "@loan/core";
import { Body, Controller, Get, Inject, Param, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuditService } from "../audit/audit.service";
import { CurrentUser, Roles } from "../auth/auth.decorators";
import type { SessionUser } from "../auth/session";
import { DomainError, validation } from "../cases/domain-error";
import { SetSimulationModeDto } from "../cases/dto";

/**
 * The failure switches for the simulated providers (Engineering Standard 9). Everyone
 * signed in can see the modes (the shell shows a banner when one is not OK); only the
 * admin persona can change them, and a mode a service does not support is refused.
 */
@ApiTags("simulation")
@Controller("simulation/services")
export class SimulationController {
  constructor(
    @Inject(SIMULATION_CONTROL) private readonly control: SimulationControl,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles(...Object.values(Role))
  async list(): Promise<SimulationServiceView[]> {
    return (await this.control.list()) as SimulationServiceView[];
  }

  @Put(":service")
  @Roles(Role.Admin)
  async set(
    @CurrentUser() user: SessionUser,
    @Param("service") service: string,
    @Body() body: SetSimulationModeDto,
  ): Promise<SimulationServiceView> {
    if (!(Object.values(ServiceName) as string[]).includes(service)) {
      throw new DomainError(404, ProblemCode.NotFound, `No simulated service called ${service}.`);
    }
    if (body.mode === "LOST_REPLY" && service !== ServiceName.CoreBanking) {
      throw validation("Only core banking can lose a reply.", [
        { field: "mode", message: `${service} does not support LOST_REPLY.` },
      ]);
    }
    const change = { service, mode: body.mode } as ServiceModeChange;
    const previous = (await this.control.list()).find((s) => s.service === service)?.mode ?? null;
    const state = await this.control.set(change, user.fullName);
    // The switch lives in the simulators' own schema and commits on its own; the audit entry
    // follows it (PRD PLT-004), so the log never records a change that did not happen.
    await this.audit.record({
      actor: user,
      action: "SIMULATION_MODE_CHANGED",
      summary: `Set ${state.label} from ${previous ?? "OK"} to ${state.mode}.`,
      details: { service, from: previous, to: state.mode, resetsAt: state.resetsAt },
    });
    return state as SimulationServiceView;
  }
}
