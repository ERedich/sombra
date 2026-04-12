import type { WorkInstructionDto, WorkOrderDetail } from './cmmsTypes';

export function mergePatchedInstruction(
  wo: WorkOrderDetail,
  wi: WorkInstructionDto,
): WorkOrderDetail {
  const work_instructions = (wo.work_instructions ?? []).map((w) =>
    w.id === wi.id ? wi : w,
  );
  const work_instruction_done_count = work_instructions.filter(
    (w) => w.done,
  ).length;
  return {
    ...wo,
    work_instructions,
    work_instruction_count: work_instructions.length,
    work_instruction_done_count,
  };
}
