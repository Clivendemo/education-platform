import type { DeliveryChannel } from '../../db/schemas.js';

export interface SendDeliveryInput {
  deliveryId: string;
  notificationId: string;
  userId: string;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  deduplicationKey?: string | null;
}

export interface SendDeliveryResult {
  success: boolean;
  provider: string;
  providerReference?: string;
  errorMessage?: string;
  isRetryable?: boolean;
}

export interface NotificationDeliveryProvider {
  readonly channel: DeliveryChannel;
  readonly providerName: string;
  send(input: SendDeliveryInput): Promise<SendDeliveryResult>;
}
