import { randomUUID } from 'node:crypto';

export function appendEvent(state, type, detail) {
  const event = { id: randomUUID(), type, detail, projectId: state.project.id,
    branchId: state.currentBranchId, createdAt: new Date().toISOString() };
  state.audit.push(event);
  state.outbox.push({ ...event, deliveredAt: null });
}
