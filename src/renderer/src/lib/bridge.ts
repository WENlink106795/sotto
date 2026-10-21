import type { MurmurApi } from '@shared/api';
import { createMockApi } from './mock';


export const bridgeMode: 'electron' | 'mock' = typeof window !== 'undefined' && window.murmur ? 'electron' : 'mock';

export const api: MurmurApi = (typeof window !== 'undefined' && window.murmur) || createMockApi();