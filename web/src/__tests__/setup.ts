import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

class InMemoryBroadcastChannel {
  private static readonly channels = new Map<string, Set<InMemoryBroadcastChannel>>();

  public readonly name: string;
  public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  public onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  private readonly eventListeners = new Set<(event: MessageEvent<unknown>) => void>();
  private closed = false;

  constructor(name: string) {
    this.name = name;
    let peers = InMemoryBroadcastChannel.channels.get(name);
    if (!peers) {
      peers = new Set();
      InMemoryBroadcastChannel.channels.set(name, peers);
    }
    peers.add(this);
  }

  public postMessage(message: unknown): void {
    if (this.closed) {
      throw new DOMException('BroadcastChannel is closed', 'InvalidStateError');
    }
    const cloned = structuredClone(message);
    const peers = InMemoryBroadcastChannel.channels.get(this.name);
    if (!peers) return;

    for (const peer of peers) {
      if (peer === this || peer.closed) continue;
      const event = new MessageEvent('message', { data: cloned });
      peer.onmessage?.(event);
      for (const listener of peer.eventListeners) {
        listener(event);
      }
    }
  }

  public addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    if (type !== 'message') return;
    const fn =
      typeof listener === 'function'
        ? (listener as (event: MessageEvent<unknown>) => void)
        : (event: MessageEvent<unknown>) => listener.handleEvent(event);
    this.eventListeners.add(fn);
  }

  public removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    if (type !== 'message' || typeof listener !== 'function') return;
    this.eventListeners.delete(listener as (event: MessageEvent<unknown>) => void);
  }

  public dispatchEvent(): boolean {
    return true;
  }

  public close(): void {
    this.closed = true;
    this.eventListeners.clear();
    const peers = InMemoryBroadcastChannel.channels.get(this.name);
    if (peers) {
      peers.delete(this);
      if (peers.size === 0) {
        InMemoryBroadcastChannel.channels.delete(this.name);
      }
    }
  }

  public static resetAll(): void {
    for (const peers of InMemoryBroadcastChannel.channels.values()) {
      for (const ch of peers) {
        ch.closed = true;
        ch.eventListeners.clear();
      }
    }
    InMemoryBroadcastChannel.channels.clear();
  }
}

Object.defineProperty(globalThis, 'BroadcastChannel', {
  writable: true,
  configurable: true,
  value: InMemoryBroadcastChannel,
});

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  cleanup();
  InMemoryBroadcastChannel.resetAll();
  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove('dark');
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.clear();
    } catch {
      // Ignore storage errors
    }
  }
});
