/// <reference types="vite/client" />

import type { MurmurApi } from '../../shared/api';

declare global {
  interface Window {
    murmur?: MurmurApi;
  }
}

export {};
