export function operatorLabel(subject: string, currentOperatorId?: string | null): string {
  if (subject === currentOperatorId) return "You";
  if (subject === "user_local_founder") return "Founder";
  if (subject === "user_local_ryanny") return "Ryanny";
  return subject;
}
