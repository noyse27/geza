import { filmdienst } from './filmdienst';
import { wortvogel } from './wortvogel';
import type { ReviewModule } from './types';
export const reviewModules: ReviewModule[] = [filmdienst, wortvogel];
export const reviewModule = (id: string) => reviewModules.find((module) => module.id === id);
