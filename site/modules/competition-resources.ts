// Site-owned composition; neither feature module imports the other's implementation.
import { installCompetitionResourceStage } from "@aihot/competition/backend/resource-stage";
import { maintainCompetitionResources } from "@aihot/learning-resources/backend/competition";

installCompetitionResourceStage(maintainCompetitionResources);
