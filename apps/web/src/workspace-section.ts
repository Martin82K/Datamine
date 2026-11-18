export type WorkspaceSection = "files" | "data" | "model";

export const WORKSPACE_SECTION_LABELS: Readonly<Record<WorkspaceSection, string>> = Object.freeze({
  files: "Soubory",
  data: "Vytěžená data",
  model: "Model",
});

export const WORKSPACE_SECTIONS: readonly WorkspaceSection[] = Object.freeze(["files", "data", "model"]);

export const adjacentWorkspaceSection = (
  section: WorkspaceSection,
  direction: -1 | 1,
): WorkspaceSection => {
  const index = WORKSPACE_SECTIONS.indexOf(section);
  return WORKSPACE_SECTIONS[(index + direction + WORKSPACE_SECTIONS.length) % WORKSPACE_SECTIONS.length] ?? section;
};

export const workspaceSectionMessage = (section: WorkspaceSection): string => (
  `Zobrazena sekce ${WORKSPACE_SECTION_LABELS[section]}.`
);
