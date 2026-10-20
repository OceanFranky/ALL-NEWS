import type { CompetitionResourceStage } from "@aihot/contracts/learning-resources";

let stage: CompetitionResourceStage | undefined;
/** The site composes this optional resource stage; the competition module stays independent. */
export function installCompetitionResourceStage(next: CompetitionResourceStage): void { stage = next; }
export function competitionResourceStage(): CompetitionResourceStage | undefined { return stage; }
