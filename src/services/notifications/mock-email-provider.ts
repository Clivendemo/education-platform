import crypto from 'node:crypto';
import type {
  NotificationDeliveryProvider,
  SendDeliveryInput,
  SendDeliveryResult,
} from './notification-provider.interface.js';

export interface MockEmailOptions {
  simulatedFailuresCount?: number;
  alwaysFail?: boolean;
  failNonRetryable?: boolean;
}

export class MockEmailDeliveryProvider implements NotificationDeliveryProvider {
  readonly channel = 'EMAIL' as const;
  readonly providerName = 'MOCK_EMAIL';

  private failureCounters = new Map<string, number>();
  private failureOptions: MockEmailOptions;

  constructor(options: MockEmailOptions = {}) {
    this.failureOptions = options;
  }

  setFailureOptions(options: MockEmailOptions) {
    this.failureOptions = options;
  }

  resetFailures() {
    this.failureCounters.clear();
    this.failureOptions = {};
  }

  async send(input: SendDeliveryInput): Promise<SendDeliveryResult> {
    if (this.failureOptions.alwaysFail) {
      return {
        success: false,
        provider: this.providerName,
        errorMessage: 'Simulated permanent SMTP failure (connection refused)',
        isRetryable: !this.failureOptions.failNonRetryable,
      };
    }

    if (this.failureOptions.simulatedFailuresCount) {
      const currentFailures = this.failureCounters.get(input.deliveryId) ?? 0;
      if (currentFailures < this.failureOptions.simulatedFailuresCount) {
        this.failureCounters.set(input.deliveryId, currentFailures + 1);
        return {
          success: false,
          provider: this.providerName,
          errorMessage: `Simulated transient SMTP timeout (attempt ${currentFailures + 1} of ${this.failureOptions.simulatedFailuresCount})`,
          isRetryable: true,
        };
      }
    }

    // Success simulation
    const ref = `mock-email-${crypto.randomUUID()}`;
    return {
      success: true,
      provider: this.providerName,
      providerReference: ref,
    };
  }
}
