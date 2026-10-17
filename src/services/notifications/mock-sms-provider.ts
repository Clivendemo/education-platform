import crypto from 'node:crypto';
import type {
  NotificationDeliveryProvider,
  SendDeliveryInput,
  SendDeliveryResult,
} from './notification-provider.interface.js';

export interface MockSmsOptions {
  alwaysFail?: boolean;
}

export class MockSmsDeliveryProvider implements NotificationDeliveryProvider {
  readonly channel = 'SMS' as const;
  readonly providerName = 'MOCK_SMS';

  private options: MockSmsOptions;

  constructor(options: MockSmsOptions = {}) {
    this.options = options;
  }

  setOptions(options: MockSmsOptions) {
    this.options = options;
  }

  async send(_input: SendDeliveryInput): Promise<SendDeliveryResult> {
    if (this.options.alwaysFail) {
      return {
        success: false,
        provider: this.providerName,
        errorMessage: 'Simulated telecom network unreachable',
        isRetryable: true,
      };
    }

    const ref = `mock-sms-${crypto.randomUUID()}`;
    return {
      success: true,
      provider: this.providerName,
      providerReference: ref,
    };
  }
}
