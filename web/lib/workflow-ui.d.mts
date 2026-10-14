export const stageLabels: Record<string, string>;
export const primaryStages: string[];
export const primaryCallCodes: string[];
export function stageLabel(value: string | null | undefined): string;
export function pageFromHash(hash: string): "campaigns" | "prospects" | "dialer" | "settings";
export function startBlockReason(input: { available: boolean; busy: boolean; selected: number; templateA: string; templateB: string }): string;
