export const EXPERIMENT_VERSION = "sdf-local-warp-v1";
export type Alignment = "centered" | "aligned";
export type ControlPoint = {
  id: string; x: number; y: number;
  kind: "endpoint" | "junction" | "bend" | "extreme" | "manual";
  movable: boolean;
};
export type AugmentationSettings = {
  strength: number; radius: number; count: number; seed: number;
  direction: "free" | "up" | "down" | "left" | "right" | "horizontal" | "vertical";
};
export type ExperimentConfig = { threshold: number; points: ControlPoint[]; augmentation: AugmentationSettings };
export type GlyphVariant = { image: string; seed: number; targets: { id: string; x: number; y: number }[] };
export type GlyphExperiment = {
  algorithm: string; analysisKey: string; sourceVersion: number; latex: string; alignment: Alignment;
  revision: number; width: number; height: number; config: ExperimentConfig;
  thresholdImage: string; shapeImage: string; autoPoints: ControlPoint[];
  variants: GlyphVariant[]; generatedWith?: ExperimentConfig; updatedAt?: string;
};
export const defaultAugmentation: AugmentationSettings = { strength: 6, radius: 40, count: 4, seed: 1, direction: "free" };
