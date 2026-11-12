import { defineConfig } from 'vite';
import { rendererConfig } from './vite.renderer.shared';

export default defineConfig(rendererConfig('participant'));
