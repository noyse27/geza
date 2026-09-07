import { filmdienst } from './filmdienst';
import type { ReviewModule } from './types';
export const reviewModules: ReviewModule[] = [filmdienst];
export const reviewModule = (id: string) => reviewModules.find((module) => module.id === id);
