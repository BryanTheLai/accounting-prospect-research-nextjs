type Mailbox = {
  status: string; health: string; manualLimits?: boolean;
  credentialConfigured?: boolean;
  dailyLimit: number; hourlyLimit: number; sendsToday: number; sendsThisHour: number;
};
export type MailboxPacingCapacity = { mailboxId: number; effectiveDailyLimit: number; effectiveHourlyLimit: number };

export function mailboxCapacity(mailbox: Mailbox, pacing?: MailboxPacingCapacity) {
  const dailyLimit = mailbox.manualLimits ? mailbox.dailyLimit : pacing?.effectiveDailyLimit ?? null;
  const hourlyLimit = mailbox.manualLimits ? mailbox.hourlyLimit : pacing?.effectiveHourlyLimit ?? null;
  let health = mailbox.health;
  if (mailbox.status === "ACTIVE") {
    health = mailbox.credentialConfigured === false ? "Credential missing" : dailyLimit === null || hourlyLimit === null ? "Unknown"
      : mailbox.sendsToday >= dailyLimit || mailbox.sendsThisHour >= hourlyLimit ? "At quota" : "Available";
  }
  return { dailyLimit, hourlyLimit, health };
}
