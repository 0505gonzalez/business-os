export function canApprove(
  task: { assignee_id: string; revision: number; status: string },
  userId: string,
  revision: number,
) {
  return (
    task.assignee_id === userId &&
    task.revision === revision &&
    task.status === "ready"
  );
}
export type Question = {
  id: string;
  kind: "research" | "prototype" | "conversation" | "chore";
  blockedBy: string[];
};
export function validateQuestions(questions: Question[]) {
  const nodes = new Map(questions.map((q) => [q.id, q]));
  if (nodes.size !== questions.length) throw new Error("Duplicate question");
  const active = new Set<string>(),
    done = new Set<string>();
  function visit(id: string) {
    if (active.has(id)) throw new Error("Dependency cycle");
    if (done.has(id)) return;
    const node = nodes.get(id);
    if (!node) throw new Error("Unknown dependency");
    active.add(id);
    node.blockedBy.forEach(visit);
    active.delete(id);
    done.add(id);
  }
  questions.forEach((q) => visit(q.id));
}
