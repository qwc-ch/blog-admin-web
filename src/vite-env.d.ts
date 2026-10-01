/// <reference types="vite/client" />

import type { WindowApiSubset } from './lib/api';

declare global {
	interface Window {
		api: WindowApiSubset;
	}
}

interface ImportMetaEnv {
	readonly VITE_API_URL?: string;
}
interface ImportMeta {
	readonly env: ImportMetaEnv;
}

export {};
