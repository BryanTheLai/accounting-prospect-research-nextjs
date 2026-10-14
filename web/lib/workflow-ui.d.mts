export const stageLabels: Record<string, string>;
export const primaryStages: string[];
export function stageLabel(value: string | null | undefined): string;
export function pageFromHash(hash: string): "campaigns" | "prospects" | "settings";
export function startBlockReason(input: { available: boolean; busy: boolean; selected: number; templateA: string; templateB: string }): string;
