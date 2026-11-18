import type { ModelObject } from "@datamine/contracts";

export type ProjectType = "building" | "civil";

export const PROJECT_TYPE_LABELS: Readonly<Record<ProjectType, string>> = Object.freeze({
  building: "Pozemní stavba",
  civil: "Inženýrská stavba",
});

export function isProjectType(value: string | null): value is ProjectType {
  return value === "building" || value === "civil";
}

export function projectTypeFromLocation(location: Pick<Location, "search">): ProjectType {
  const candidate = new URLSearchParams(location.search).get("projectType");
  return isProjectType(candidate) ? candidate : "building";
}

export function objectBelongsToProjectType(object: ModelObject, projectType: ProjectType): boolean {
  if (projectType === "building") {
    return object.type === "rooms.room" || object.type.startsWith("building.");
  }
  return object.type.startsWith("civil.") || object.type.startsWith("stakeout.");
}

export function inferProjectType(objects: readonly ModelObject[], fallback: ProjectType): ProjectType {
  const hasBuildingObjects = objects.some((object) => object.type === "rooms.room" || object.type.startsWith("building."));
  const hasCivilObjects = objects.some((object) => object.type.startsWith("civil.") || object.type.startsWith("stakeout."));
  if (hasBuildingObjects && !hasCivilObjects) return "building";
  if (hasCivilObjects && !hasBuildingObjects) return "civil";
  return fallback;
}

export function modelMatchesProjectType(objects: readonly ModelObject[], projectType: ProjectType): boolean {
  return objects.every((object) => objectBelongsToProjectType(object, projectType));
}
