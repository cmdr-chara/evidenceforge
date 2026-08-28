import { OperationRecord, OperationSettlement, SessionState } from "../../domain/src";
import { EvidenceStore } from "../../evidence/src";
import {
  appendOperationIntent,
  markEffectStarted,
  markEffectUncertain,
  settleOperation,
} from "../../workflow/src/operation-protocol";
import { RuntimeCheckpointStore } from "./checkpoint-store";

export class OperationEffectUncertainError extends Error {
  public constructor(
    public readonly operationId: string,
    options: { cause: unknown },
  ) {
    super(`operation ${operationId} ended without a durable settlement`, options);
    this.name = "OperationEffectUncertainError";
  }
}

export class DurableOperationRunner {
  public constructor(
    private readonly store: RuntimeCheckpointStore,
    private readonly evidenceStore: EvidenceStore,
  ) {}

  public async run(
    state: SessionState,
    intent: OperationRecord,
    effect: () => Promise<OperationSettlement>,
  ): Promise<OperationSettlement> {
    appendOperationIntent(state, intent);
    await this.store.saveCheckpoint(state, this.evidenceStore);

    markEffectStarted(state, intent.id);
    await this.store.saveCheckpoint(state, this.evidenceStore);
    try {
      const settlement = await effect();
      settleOperation(state, intent.id, settlement);
      await this.store.saveCheckpoint(state, this.evidenceStore);
      return structuredClone(settlement);
    } catch (error) {
      markEffectUncertain(state, intent.id);
      await this.store.saveCheckpoint(state, this.evidenceStore);
      throw new OperationEffectUncertainError(intent.id, { cause: error });
    }
  }
}
