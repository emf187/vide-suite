/**
 * Clean-SaaS vocabulary: Custos serves ANY business that runs on tasks — a
 * kitchen, an IT shop, a cleaning crew. Industry drives later template seeds
 * and report vocabulary; the loop itself stays industry-neutral.
 */
export const INDUSTRIES = [
  { id: "food_beverage", label: "Kitchen / food business" },
  { id: "field_services", label: "Field services / repairs" },
  { id: "software_it", label: "Software / IT business" },
  { id: "cleaning", label: "Cleaning services" },
  { id: "retail", label: "Retail / shops" },
  { id: "other", label: "Other" },
] as const;

export type Industry = (typeof INDUSTRIES)[number]["id"];

export function industryLabel(id: string): string {
  return INDUSTRIES.find((i) => i.id === id)?.label ?? "Other";
}

export function isIndustry(id: string): boolean {
  return INDUSTRIES.some((i) => i.id === id);
}

/** Evidence-spec vocabulary — WhatsApp-capable proof kinds (brief §4.3). */
export type EvidenceSpecKind = "media" | "signature";

/** Any photo/video/audio/document, served by one file picker. */
export function kindForMime(mime: string): "photo" | "video" | "audio" | "document" {
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

export const EVIDENCE_KIND_LABEL: Record<string, string> = {
  photo: "PHOTO",
  video: "VIDEO",
  audio: "AUDIO",
  document: "PDF",
  signature: "SIGNED",
  number: "NUMBER",
  text: "TEXT",
};
