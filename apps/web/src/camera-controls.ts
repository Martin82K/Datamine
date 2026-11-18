export type ViewportCameraCommand = "fit" | "level" | "iso";

export function cameraCommandForKey(key: string): ViewportCameraCommand | null {
  if (key === "Home" || key.toLowerCase() === "h") return "level";
  if (key.toLowerCase() === "f") return "fit";
  if (key === "0") return "iso";
  return null;
}
